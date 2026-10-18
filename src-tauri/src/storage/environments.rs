use super::fsutil::{read_yaml, slugify, unique_path, write_yaml};
use super::Problem;
use crate::error::{AppError, AppResult};
use crate::model::{Environment, VarKind};
use crate::secrets::SecretStore;
use crate::vars::Layer;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const ENV_DIR: &str = "environments";
const GLOBALS_FILE: &str = "_globals.yaml";
const ENV_SUFFIX: &str = ".env.yaml";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environments {
    pub globals: Environment,
    pub environments: Vec<Environment>,
    pub problems: Vec<Problem>,
}

fn env_dir(root: &Path) -> AppResult<PathBuf> {
    let dir = root.join(ENV_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn load_globals(root: &Path) -> AppResult<(PathBuf, Environment)> {
    let path = env_dir(root)?.join(GLOBALS_FILE);
    if path.is_file() {
        return Ok((path.clone(), read_yaml(&path)?));
    }
    let globals = Environment::new("Globals");
    write_yaml(&path, &globals)?;
    Ok((path, globals))
}

type Located = Vec<(PathBuf, Environment)>;

fn scan(root: &Path) -> AppResult<(Located, Vec<Problem>)> {
    let dir = env_dir(root)?;
    let mut envs = Vec::new();
    let mut problems = Vec::new();
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for path in paths {
        let is_env = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(ENV_SUFFIX));
        if !is_env {
            continue;
        }
        match read_yaml::<Environment>(&path) {
            Ok(env) => envs.push((path, env)),
            Err(e) => problems.push(Problem {
                path: path.strip_prefix(root).unwrap_or(&path).display().to_string(),
                message: e.details.unwrap_or(e.message),
            }),
        }
    }
    envs.sort_by_key(|(_, e)| e.name.to_lowercase());
    Ok((envs, problems))
}

fn find(root: &Path, id: &str) -> AppResult<Option<(PathBuf, Environment)>> {
    let (path, globals) = load_globals(root)?;
    if globals.id == id {
        return Ok(Some((path, globals)));
    }
    Ok(scan(root)?.0.into_iter().find(|(_, e)| e.id == id))
}

fn reveal(env: &mut Environment, secrets: &dyn SecretStore) -> AppResult<()> {
    for var in env.variables.iter_mut().filter(|v| v.kind == VarKind::Secret) {
        if let Some(r) = &var.secret_ref {
            var.value = secrets.get(r)?.unwrap_or_default();
        }
    }
    Ok(())
}

pub fn load_all(root: &Path, secrets: &dyn SecretStore) -> AppResult<Environments> {
    let (_, mut globals) = load_globals(root)?;
    reveal(&mut globals, secrets)?;
    let (envs, problems) = scan(root)?;
    let mut environments = Vec::with_capacity(envs.len());
    for (_, mut env) in envs {
        reveal(&mut env, secrets)?;
        environments.push(env);
    }
    Ok(Environments {
        globals,
        environments,
        problems,
    })
}

pub fn create(root: &Path, name: &str) -> AppResult<Environment> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Name must not be empty"));
    }
    let env = Environment::new(name);
    let path = unique_path(&env_dir(root)?, &slugify(name), ENV_SUFFIX);
    write_yaml(&path, &env)?;
    Ok(env)
}

pub fn save(root: &Path, mut env: Environment, secrets: &dyn SecretStore) -> AppResult<()> {
    if env.name.trim().is_empty() {
        return Err(AppError::validation("Name must not be empty"));
    }
    let (path, previous) = find(root, &env.id)?.ok_or_else(|| AppError::not_found("Environment not found"))?;

    for var in env.variables.iter_mut() {
        match var.kind {
            VarKind::Secret => {
                let key = var
                    .secret_ref
                    .get_or_insert_with(|| format!("env/{}/{}", env.id, var.key))
                    .clone();
                if !var.value.is_empty() {
                    secrets.set(&key, &var.value)?;
                }
                var.value.clear();
            }
            VarKind::Default => {
                if let Some(r) = var.secret_ref.take() {
                    secrets.delete(&r)?;
                }
            }
        }
    }
    let kept: Vec<&str> = env.variables.iter().filter_map(|v| v.secret_ref.as_deref()).collect();
    for old in previous.variables.iter().filter_map(|v| v.secret_ref.as_deref()) {
        if !kept.contains(&old) {
            secrets.delete(old)?;
        }
    }
    write_yaml(&path, &env)
}

pub fn delete(root: &Path, id: &str, secrets: &dyn SecretStore) -> AppResult<()> {
    let (path, env) = find(root, id)?.ok_or_else(|| AppError::not_found("Environment not found"))?;
    if path.file_name().is_some_and(|n| n == GLOBALS_FILE) {
        return Err(AppError::validation("Globals cannot be deleted"));
    }
    for r in env.variables.iter().filter_map(|v| v.secret_ref.as_deref()) {
        secrets.delete(r)?;
    }
    fs::remove_file(path)?;
    Ok(())
}

pub fn layer(env: &Environment, source: &str, secrets: &dyn SecretStore) -> AppResult<Layer> {
    let mut layer = Layer::new(source);
    for var in env.variables.iter().filter(|v| v.enabled && !v.key.is_empty()) {
        let value = match (&var.kind, &var.secret_ref) {
            (VarKind::Secret, Some(r)) => secrets.get(r)?.unwrap_or_default(),
            _ => var.value.clone(),
        };
        if var.kind == VarKind::Secret {
            layer.secrets.insert(var.key.clone());
        }
        layer.values.insert(var.key.clone(), Value::String(value));
    }
    Ok(layer)
}

pub fn scope_layers(root: &Path, environment_id: Option<&str>, secrets: &dyn SecretStore) -> AppResult<Vec<Layer>> {
    let mut layers = Vec::new();
    if let Some(id) = environment_id {
        if let Some((_, env)) = scan(root)?.0.into_iter().find(|(_, e)| e.id == id) {
            layers.push(layer(&env, "environment", secrets)?);
        }
    }
    let (_, globals) = load_globals(root)?;
    layers.push(layer(&globals, "globals", secrets)?);
    Ok(layers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::EnvVar;
    use crate::secrets::MemoryStore;

    fn secret_var(key: &str, value: &str) -> EnvVar {
        EnvVar {
            key: key.into(),
            value: value.into(),
            enabled: true,
            kind: VarKind::Secret,
            secret_ref: None,
            description: String::new(),
        }
    }

    fn plain(key: &str, value: &str) -> EnvVar {
        EnvVar {
            kind: VarKind::Default,
            ..secret_var(key, value)
        }
    }

    #[test]
    fn globals_are_created_and_envs_listed() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        create(dir.path(), "Staging").unwrap();
        create(dir.path(), "dev").unwrap();
        let all = load_all(dir.path(), &store).unwrap();
        assert_eq!(all.globals.name, "Globals");
        assert_eq!(
            all.environments.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            ["dev", "Staging"]
        );
        assert!(dir.path().join("environments/_globals.yaml").is_file());
        assert!(dir.path().join("environments/staging.env.yaml").is_file());
    }

    #[test]
    fn secrets_never_reach_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let mut env = create(dir.path(), "dev").unwrap();
        env.variables = vec![plain("baseUrl", "https://x"), secret_var("token", "s3cr3t")];
        save(dir.path(), env.clone(), &store).unwrap();

        let text = fs::read_to_string(dir.path().join("environments/dev.env.yaml")).unwrap();
        assert!(!text.contains("s3cr3t"), "{text}");
        assert!(text.contains("secretRef"));

        let loaded = load_all(dir.path(), &store).unwrap().environments.remove(0);
        assert_eq!(loaded.variables[1].value, "s3cr3t");
        let layers = scope_layers(dir.path(), Some(&env.id), &store).unwrap();
        assert_eq!(layers[0].values["token"], "s3cr3t");

        let mut changed = loaded.clone();
        changed.variables.truncate(1);
        save(dir.path(), changed, &store).unwrap();
        assert_eq!(store.get(&format!("env/{}/token", env.id)).unwrap(), None);
    }

    #[test]
    fn globals_cannot_be_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let globals = load_all(dir.path(), &store).unwrap().globals;
        assert!(delete(dir.path(), &globals.id, &store).is_err());
    }
}
