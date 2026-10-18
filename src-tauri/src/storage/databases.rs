use super::fsutil::{read_yaml, slugify, unique_path, write_yaml};
use super::Problem;
use crate::error::{AppError, AppResult};
use crate::model::{DbDriver, DbProfile, PasswordMode};
use crate::secrets::SecretStore;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const DB_DIR: &str = "databases";
const DB_SUFFIX: &str = ".db.yaml";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbProfiles {
    pub profiles: Vec<DbProfile>,
    pub problems: Vec<Problem>,
}

type Located = Vec<(PathBuf, DbProfile)>;

fn dir(root: &Path) -> AppResult<PathBuf> {
    let dir = root.join(DB_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn scan(root: &Path) -> AppResult<(Located, Vec<Problem>)> {
    let mut found = Vec::new();
    let mut problems = Vec::new();
    let mut paths: Vec<PathBuf> = fs::read_dir(dir(root)?)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    paths.sort();
    for path in paths {
        if !path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(DB_SUFFIX))
        {
            continue;
        }
        match read_yaml::<DbProfile>(&path) {
            Ok(p) => found.push((path, p)),
            Err(e) => problems.push(Problem {
                path: path.strip_prefix(root).unwrap_or(&path).display().to_string(),
                message: e.details.unwrap_or(e.message),
            }),
        }
    }
    found.sort_by_key(|(_, p)| p.name.to_lowercase());
    Ok((found, problems))
}

pub fn list(root: &Path) -> AppResult<DbProfiles> {
    let (found, problems) = scan(root)?;
    Ok(DbProfiles {
        profiles: found.into_iter().map(|(_, p)| p).collect(),
        problems,
    })
}

pub fn find(root: &Path, id: &str) -> AppResult<DbProfile> {
    scan(root)?
        .0
        .into_iter()
        .find(|(_, p)| p.id == id)
        .map(|(_, p)| p)
        .ok_or_else(|| AppError::not_found("Database connection not found"))
}

pub fn create(root: &Path, name: &str, driver: DbDriver) -> AppResult<DbProfile> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Name must not be empty"));
    }
    let profile = DbProfile::new(name, driver);
    write_yaml(&unique_path(&dir(root)?, &slugify(name), DB_SUFFIX), &profile)?;
    Ok(profile)
}

pub fn save(root: &Path, mut profile: DbProfile, password: Option<&str>, secrets: &dyn SecretStore) -> AppResult<()> {
    if profile.name.trim().is_empty() {
        return Err(AppError::validation("Name must not be empty"));
    }
    let (path, previous) = scan(root)?
        .0
        .into_iter()
        .find(|(_, p)| p.id == profile.id)
        .ok_or_else(|| AppError::not_found("Database connection not found"))?;
    match profile.password_mode {
        PasswordMode::Keychain => {
            let key = profile
                .secret_ref
                .get_or_insert_with(|| format!("db/{}/password", profile.id))
                .clone();
            if let Some(pw) = password.filter(|p| !p.is_empty()) {
                secrets.set(&key, pw)?;
            }
        }
        PasswordMode::Variable | PasswordMode::None => {
            if let Some(r) = profile.secret_ref.take().or(previous.secret_ref) {
                secrets.delete(&r)?;
            }
        }
    }
    write_yaml(&path, &profile)
}

pub fn delete(root: &Path, id: &str, secrets: &dyn SecretStore) -> AppResult<()> {
    let (path, profile) = scan(root)?
        .0
        .into_iter()
        .find(|(_, p)| p.id == id)
        .ok_or_else(|| AppError::not_found("Database connection not found"))?;
    if let Some(r) = &profile.secret_ref {
        secrets.delete(r)?;
    }
    fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    #[test]
    fn crud_and_password_in_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::default();
        let mut p = create(dir.path(), "Billing MSSQL", DbDriver::Mssql).unwrap();
        assert_eq!(p.port, Some(1433));
        p.username = "qa".into();
        save(dir.path(), p.clone(), Some("Pa55"), &store).unwrap();

        let text = fs::read_to_string(dir.path().join("databases/billing-mssql.db.yaml")).unwrap();
        assert!(!text.contains("Pa55"));
        let loaded = find(dir.path(), &p.id).unwrap();
        assert_eq!(
            store.get(loaded.secret_ref.as_deref().unwrap()).unwrap().as_deref(),
            Some("Pa55")
        );

        save(dir.path(), loaded.clone(), None, &store).unwrap();
        assert_eq!(
            store.get(loaded.secret_ref.as_deref().unwrap()).unwrap().as_deref(),
            Some("Pa55")
        );

        delete(dir.path(), &p.id, &store).unwrap();
        assert!(list(dir.path()).unwrap().profiles.is_empty());
        assert_eq!(store.get(loaded.secret_ref.as_deref().unwrap()).unwrap(), None);
    }
}
