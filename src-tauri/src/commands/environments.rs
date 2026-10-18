use super::workspace::with_ws;
use crate::error::AppResult;
use crate::model::Environment;
use crate::secrets::KeyringStore;
use crate::state::AppState;
use crate::storage::environments::{self, Environments};
use tauri::State;

#[tauri::command]
pub async fn environments_list(state: State<'_, AppState>) -> AppResult<Environments> {
    with_ws(&state, |ws| {
        environments::load_all(ws.root(), &KeyringStore::new(ws.id()))
    })
}

#[tauri::command]
pub async fn environment_create(state: State<'_, AppState>, name: String) -> AppResult<Environments> {
    with_ws(&state, |ws| {
        environments::create(ws.root(), &name)?;
        environments::load_all(ws.root(), &KeyringStore::new(ws.id()))
    })
}

#[tauri::command]
pub async fn environment_save(state: State<'_, AppState>, environment: Environment) -> AppResult<Environments> {
    with_ws(&state, |ws| {
        let secrets = KeyringStore::new(ws.id());
        environments::save(ws.root(), environment, &secrets)?;
        environments::load_all(ws.root(), &secrets)
    })
}

#[tauri::command]
pub async fn environment_delete(state: State<'_, AppState>, id: String) -> AppResult<Environments> {
    with_ws(&state, |ws| {
        let secrets = KeyringStore::new(ws.id());
        environments::delete(ws.root(), &id, &secrets)?;
        environments::load_all(ws.root(), &secrets)
    })
}
