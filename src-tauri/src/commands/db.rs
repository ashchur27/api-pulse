use super::workspace::with_ws;
use crate::db::{guard, ExecResult, Resolved, SchemaTable, ServerInfo};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::model::{DbDriver, DbProfile, PasswordMode};
use crate::secrets::{KeyringStore, SecretStore};
use crate::state::AppState;
use crate::storage::databases::{self, DbProfiles};
use crate::storage::{environments, Workspace};
use crate::vars::{Layer, Resolver, VarScope};
use serde::Serialize;
use std::time::Duration;
use tauri::State;
use tokio_util::sync::CancellationToken;

const DEFAULT_MAX_ROWS: usize = 1000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileCreated {
    pub id: String,
    pub profiles: DbProfiles,
}

fn lock_err() -> AppError {
    AppError::internal("State lock poisoned")
}

fn resolve(
    ws: &Workspace,
    runtime: Layer,
    profile: &DbProfile,
    password: Option<&str>,
    environment_id: Option<&str>,
) -> AppResult<Resolved> {
    let secrets = KeyringStore::new(ws.id());
    let mut layers = vec![runtime];
    layers.extend(environments::scope_layers(ws.root(), environment_id, &secrets)?);
    let scope = VarScope::new(layers);
    let r = Resolver::new(&scope);
    let opt = |v: &Option<String>| v.as_deref().map(|s| r.resolve(s)).transpose();
    let password = match profile.password_mode {
        PasswordMode::Keychain => match password.filter(|p| !p.is_empty()) {
            Some(p) => p.to_string(),
            None => match &profile.secret_ref {
                Some(key) => secrets.get(key)?.unwrap_or_default(),
                None => String::new(),
            },
        },
        PasswordMode::Variable => r.resolve(profile.password_variable.as_deref().unwrap_or_default())?,
        PasswordMode::None => String::new(),
    };
    Ok(Resolved {
        driver: profile.driver,
        host: r.resolve(profile.host.trim())?,
        port: profile.port,
        instance: opt(&profile.instance)?,
        database: r.resolve(profile.database.trim())?,
        file: opt(&profile.file)?,
        auth: profile.auth,
        username: r.resolve(&profile.username)?,
        password,
        tls_mode: profile.tls.mode,
        trust_server_certificate: profile.tls.trust_server_certificate,
        protected: profile.protected,
        connect_timeout: Duration::from_millis(profile.connect_timeout_ms.unwrap_or(10_000)),
        statement_timeout: Duration::from_millis(profile.statement_timeout_ms.unwrap_or(60_000)),
    })
}

fn runtime_layer(state: &AppState) -> AppResult<Layer> {
    let values = state.runtime_vars.lock().map_err(|_| lock_err())?.clone();
    Ok(Layer {
        source: "runtime".into(),
        values,
        ..Layer::default()
    })
}

fn resolve_by_id(state: &AppState, profile_id: &str, environment_id: Option<&str>) -> AppResult<Resolved> {
    let runtime = runtime_layer(state)?;
    with_ws(state, |ws| {
        let profile = databases::find(ws.root(), profile_id)?;
        resolve(ws, runtime, &profile, None, environment_id)
    })
}

#[tauri::command]
pub async fn db_profiles_list(state: State<'_, AppState>) -> AppResult<DbProfiles> {
    with_ws(&state, |ws| databases::list(ws.root()))
}

#[tauri::command]
pub async fn db_profile_create(
    state: State<'_, AppState>,
    name: String,
    driver: DbDriver,
) -> AppResult<ProfileCreated> {
    with_ws(&state, |ws| {
        let profile = databases::create(ws.root(), &name, driver)?;
        Ok(ProfileCreated {
            id: profile.id,
            profiles: databases::list(ws.root())?,
        })
    })
}

#[tauri::command]
pub async fn db_profile_save(
    state: State<'_, AppState>,
    profile: DbProfile,
    password: Option<String>,
) -> AppResult<DbProfiles> {
    with_ws(&state, |ws| {
        databases::save(ws.root(), profile, password.as_deref(), &KeyringStore::new(ws.id()))?;
        databases::list(ws.root())
    })
}

#[tauri::command]
pub async fn db_profile_delete(state: State<'_, AppState>, id: String) -> AppResult<DbProfiles> {
    with_ws(&state, |ws| {
        databases::delete(ws.root(), &id, &KeyringStore::new(ws.id()))?;
        databases::list(ws.root())
    })
}

#[tauri::command]
pub async fn db_test(
    state: State<'_, AppState>,
    profile: DbProfile,
    password: Option<String>,
    environment_id: Option<String>,
) -> AppResult<ServerInfo> {
    let runtime = runtime_layer(&state)?;
    let resolved = with_ws(&state, |ws| {
        resolve(ws, runtime, &profile, password.as_deref(), environment_id.as_deref())
    })?;
    state.db.test(&resolved).await
}

#[tauri::command]
pub async fn db_execute(
    state: State<'_, AppState>,
    exec_id: String,
    profile_id: String,
    sql: String,
    environment_id: Option<String>,
    max_rows: Option<usize>,
    allow_destructive: Option<bool>,
) -> AppResult<ExecResult> {
    let resolved = resolve_by_id(&state, &profile_id, environment_id.as_deref())?;
    let analysis = guard::analyze(&sql);
    if resolved.protected && !analysis.read_only {
        return Err(AppError::validation(
            "This connection is protected: only read queries (SELECT, WITH, SHOW, EXPLAIN) are allowed",
        ));
    }
    if !analysis.destructive.is_empty() && !allow_destructive.unwrap_or(false) {
        return Err(AppError::new(ErrorCode::Confirm, analysis.destructive.join(", ")));
    }
    let token = CancellationToken::new();
    state
        .inflight
        .lock()
        .map_err(|_| lock_err())?
        .insert(exec_id.clone(), token.clone());
    let result = state
        .db
        .execute(&resolved, &sql, max_rows.unwrap_or(DEFAULT_MAX_ROWS), token)
        .await;
    state.inflight.lock().map_err(|_| lock_err())?.remove(&exec_id);
    result
}

#[tauri::command]
pub async fn db_schema(
    state: State<'_, AppState>,
    profile_id: String,
    environment_id: Option<String>,
) -> AppResult<Vec<SchemaTable>> {
    let resolved = resolve_by_id(&state, &profile_id, environment_id.as_deref())?;
    state.db.schema(&resolved).await
}
