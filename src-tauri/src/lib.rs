mod commands;
mod db;
mod error;
mod http;
mod model;
mod secrets;
mod state;
mod storage;
mod vars;
mod wsdl;

use state::AppState;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::workspace::workspace_open,
            commands::workspace::workspace_create,
            commands::workspace::workspace_tree,
            commands::workspace::collection_create,
            commands::workspace::folder_create,
            commands::workspace::request_create,
            commands::workspace::request_get,
            commands::workspace::request_save,
            commands::workspace::request_duplicate,
            commands::workspace::node_rename,
            commands::workspace::node_delete,
            commands::workspace::container_get,
            commands::workspace::container_save,
            commands::environments::environments_list,
            commands::environments::environment_create,
            commands::environments::environment_save,
            commands::environments::environment_delete,
            commands::http::request_send,
            commands::http::request_cancel,
            commands::http::variables_scope,
            commands::http::history_list,
            commands::http::history_get,
            commands::http::history_clear,
            commands::wsdl::wsdl_inspect,
            commands::wsdl::wsdl_import,
            commands::db::db_profiles_list,
            commands::db::db_profile_create,
            commands::db::db_profile_save,
            commands::db::db_profile_delete,
            commands::db::db_test,
            commands::db::db_execute,
            commands::db::db_schema,
        ])
        .run(tauri::generate_context!())
        .expect("error while running API-Pulse");
}
