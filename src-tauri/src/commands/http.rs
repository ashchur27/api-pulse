use super::workspace::with_ws;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::http::{ancestor_layers, prepare, HttpResponse, PreparedRequest};
use crate::model::{ContainerMeta, RequestDef};
use crate::secrets::KeyringStore;
use crate::state::AppState;
use crate::storage::history::{self, HistoryEntry};
use crate::storage::{environments, Workspace};
use crate::vars::{Layer, Resolver, ScopeVar, VarScope};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use tauri::State;
use tokio_util::sync::CancellationToken;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub request: PreparedRequest,
    pub response: HttpResponse,
    pub warnings: Vec<String>,
}

fn lock_err() -> AppError {
    AppError::internal("State lock poisoned")
}

fn runtime_layer(state: &AppState) -> AppResult<Layer> {
    let values = state.runtime_vars.lock().map_err(|_| lock_err())?.clone();
    Ok(Layer {
        source: "runtime".into(),
        values,
        ..Layer::default()
    })
}

fn build_scope(
    ws: &Workspace,
    runtime: Layer,
    ancestors: &[ContainerMeta],
    environment_id: Option<&str>,
) -> AppResult<VarScope> {
    let secrets = KeyringStore::new(ws.id());
    let mut layers = vec![runtime];
    layers.extend(ancestor_layers(ancestors));
    layers.extend(environments::scope_layers(ws.root(), environment_id, &secrets)?);
    Ok(VarScope::new(layers))
}

#[tauri::command]
pub async fn variables_scope(
    state: State<'_, AppState>,
    request_id: Option<String>,
    environment_id: Option<String>,
) -> AppResult<Vec<ScopeVar>> {
    let runtime = runtime_layer(&state)?;
    with_ws(&state, |ws| {
        let ancestors = request_id.as_deref().map(|id| ws.ancestors(id)).unwrap_or_default();
        Ok(build_scope(ws, runtime, &ancestors, environment_id.as_deref())?.entries())
    })
}

#[tauri::command]
pub async fn request_send(
    state: State<'_, AppState>,
    exec_id: String,
    request: RequestDef,
    environment_id: Option<String>,
) -> AppResult<SendResult> {
    let runtime = runtime_layer(&state)?;
    let (prepared, warnings, secrets, root) = with_ws(&state, |ws| {
        let ancestors = ws.ancestors(&request.id);
        let scope = build_scope(ws, runtime, &ancestors, environment_id.as_deref())?;
        let resolver = Resolver::new(&scope);
        let prepared = prepare(&request, &ancestors, &resolver, ws.defaults())?;
        Ok((
            prepared,
            resolver.warnings(),
            scope.secret_values(),
            ws.root().to_path_buf(),
        ))
    })?;

    let token = CancellationToken::new();
    state
        .inflight
        .lock()
        .map_err(|_| lock_err())?
        .insert(exec_id.clone(), token.clone());
    let result = state.http.send(&prepared, token).await;
    state.inflight.lock().map_err(|_| lock_err())?.remove(&exec_id);

    let shown = prepared.redacted(&secrets);
    if !matches!(&result, Err(e) if e.code == ErrorCode::Cancelled) {
        record_history(&root, &request, &shown, &result, &warnings);
    }

    Ok(SendResult {
        request: shown,
        response: result?,
        warnings,
    })
}

fn record_history(
    root: &Path,
    request: &RequestDef,
    prepared: &PreparedRequest,
    result: &AppResult<HttpResponse>,
    warnings: &[String],
) {
    let entry = HistoryEntry {
        id: uuid::Uuid::now_v7().to_string(),
        ts: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        request_id: Some(request.id.clone()),
        name: request.name.clone(),
        method: prepared.method.clone(),
        url: prepared.url.clone(),
        status: result.as_ref().ok().map(|r| r.status),
        total_ms: result.as_ref().ok().map(|r| r.timings.total_ms),
        error: result.as_ref().err().map(|e| e.message.clone()),
    };
    let snapshot = json!({
        "entry": entry,
        "request": request,
        "prepared": prepared,
        "response": result.as_ref().ok().map(|r| r.for_snapshot()),
        "error": result.as_ref().err(),
        "warnings": warnings,
    });
    if let Err(e) = history::record(root, &entry, &snapshot) {
        tracing::warn!("could not write history: {}", e.message);
    }
}

#[tauri::command]
pub async fn history_list(state: State<'_, AppState>, limit: Option<usize>) -> AppResult<Vec<HistoryEntry>> {
    with_ws(&state, |ws| {
        history::list(ws.root(), limit.unwrap_or(history::MAX_ENTRIES))
    })
}

#[tauri::command]
pub async fn history_get(state: State<'_, AppState>, id: String) -> AppResult<Value> {
    with_ws(&state, |ws| history::get(ws.root(), &id))
}

#[tauri::command]
pub async fn history_clear(state: State<'_, AppState>) -> AppResult<()> {
    with_ws(&state, |ws| history::clear(ws.root()))
}

#[tauri::command]
pub async fn request_cancel(state: State<'_, AppState>, exec_id: String) -> AppResult<()> {
    if let Some(token) = state.inflight.lock().map_err(|_| lock_err())?.get(&exec_id) {
        token.cancel();
    }
    Ok(())
}
