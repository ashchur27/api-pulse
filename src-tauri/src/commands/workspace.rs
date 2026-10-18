use crate::error::{AppError, AppResult};
use crate::model::{ContainerMeta, RequestDef, RequestKind};
use crate::state::AppState;
use crate::storage::{Workspace, WorkspaceTree};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub id: String,
    pub tree: WorkspaceTree,
}

pub(crate) fn with_ws<T>(state: &AppState, f: impl FnOnce(&mut Workspace) -> AppResult<T>) -> AppResult<T> {
    let mut guard = state
        .workspace
        .lock()
        .map_err(|_| AppError::internal("Workspace lock poisoned"))?;
    let ws = guard
        .as_mut()
        .ok_or_else(|| AppError::validation("No workspace is open"))?;
    f(ws)
}

fn install(state: &AppState, mut ws: Workspace) -> AppResult<WorkspaceTree> {
    let tree = ws.tree()?;
    *state
        .workspace
        .lock()
        .map_err(|_| AppError::internal("Workspace lock poisoned"))? = Some(ws);
    Ok(tree)
}

#[tauri::command]
pub async fn workspace_open(state: State<'_, AppState>, path: String) -> AppResult<WorkspaceTree> {
    install(&state, Workspace::open(Path::new(&path))?)
}

#[tauri::command]
pub async fn workspace_create(state: State<'_, AppState>, path: String, name: String) -> AppResult<WorkspaceTree> {
    install(&state, Workspace::create(Path::new(&path), &name)?)
}

#[tauri::command]
pub async fn workspace_tree(state: State<'_, AppState>) -> AppResult<WorkspaceTree> {
    with_ws(&state, |ws| ws.tree())
}

#[tauri::command]
pub async fn collection_create(state: State<'_, AppState>, name: String) -> AppResult<Created> {
    with_ws(&state, |ws| {
        let id = ws.create_collection(&name)?;
        Ok(Created { id, tree: ws.tree()? })
    })
}

#[tauri::command]
pub async fn folder_create(state: State<'_, AppState>, parent_id: String, name: String) -> AppResult<Created> {
    with_ws(&state, |ws| {
        let id = ws.create_folder(&parent_id, &name)?;
        Ok(Created { id, tree: ws.tree()? })
    })
}

#[tauri::command]
pub async fn request_create(
    state: State<'_, AppState>,
    parent_id: String,
    name: String,
    kind: RequestKind,
) -> AppResult<Created> {
    with_ws(&state, |ws| {
        let id = ws.create_request(&parent_id, &name, kind)?;
        Ok(Created { id, tree: ws.tree()? })
    })
}

#[tauri::command]
pub async fn request_get(state: State<'_, AppState>, id: String) -> AppResult<RequestDef> {
    with_ws(&state, |ws| ws.get_request(&id))
}

#[tauri::command]
pub async fn request_save(state: State<'_, AppState>, request: RequestDef) -> AppResult<WorkspaceTree> {
    with_ws(&state, |ws| {
        ws.save_request(&request)?;
        ws.tree()
    })
}

#[tauri::command]
pub async fn request_duplicate(state: State<'_, AppState>, id: String) -> AppResult<Created> {
    with_ws(&state, |ws| {
        let id = ws.duplicate_request(&id)?;
        Ok(Created { id, tree: ws.tree()? })
    })
}

#[tauri::command]
pub async fn node_rename(state: State<'_, AppState>, id: String, name: String) -> AppResult<WorkspaceTree> {
    with_ws(&state, |ws| {
        ws.rename(&id, &name)?;
        ws.tree()
    })
}

#[tauri::command]
pub async fn node_delete(state: State<'_, AppState>, id: String) -> AppResult<WorkspaceTree> {
    with_ws(&state, |ws| {
        ws.delete(&id)?;
        ws.tree()
    })
}

#[tauri::command]
pub async fn container_get(state: State<'_, AppState>, id: String) -> AppResult<ContainerMeta> {
    with_ws(&state, |ws| ws.get_container(&id))
}

#[tauri::command]
pub async fn container_save(state: State<'_, AppState>, container: ContainerMeta) -> AppResult<WorkspaceTree> {
    with_ws(&state, |ws| {
        ws.save_container(&container)?;
        ws.tree()
    })
}
