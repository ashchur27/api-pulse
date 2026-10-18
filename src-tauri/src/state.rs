use crate::db::DbManager;
use crate::http::HttpEngine;
use crate::storage::Workspace;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct AppState {
    pub workspace: Mutex<Option<Workspace>>,
    pub http: HttpEngine,
    pub db: DbManager,
    pub inflight: Mutex<HashMap<String, CancellationToken>>,
    pub runtime_vars: Mutex<HashMap<String, Value>>,
}
