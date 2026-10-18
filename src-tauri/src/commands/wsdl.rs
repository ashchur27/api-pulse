use super::workspace::{with_ws, Created};
use crate::error::AppResult;
use crate::model::{RequestDef, RequestKind, SoapConfig};
use crate::secrets::KeyringStore;
use crate::state::AppState;
use crate::storage::environments;
use crate::vars::{Resolver, VarScope};
use crate::wsdl::{self, WsdlInfo};
use serde_json::json;
use std::collections::BTreeMap;
use tauri::State;

fn resolve_source(state: &AppState, source: &str, environment_id: Option<&str>) -> AppResult<String> {
    with_ws(state, |ws| {
        let layers = environments::scope_layers(ws.root(), environment_id, &KeyringStore::new(ws.id()))?;
        let scope = VarScope::new(layers);
        Resolver::new(&scope).resolve(source.trim())
    })
}

#[tauri::command]
pub async fn wsdl_inspect(
    state: State<'_, AppState>,
    source: String,
    environment_id: Option<String>,
    verify_tls: Option<bool>,
) -> AppResult<WsdlInfo> {
    let resolved = resolve_source(&state, &source, environment_id.as_deref())?;
    let mut info = wsdl::inspect(&resolved, verify_tls.unwrap_or(true)).await?;
    info.source = source;
    Ok(info)
}

#[tauri::command]
pub async fn wsdl_import(
    state: State<'_, AppState>,
    source: String,
    environment_id: Option<String>,
    verify_tls: Option<bool>,
) -> AppResult<Created> {
    let resolved = resolve_source(&state, &source, environment_id.as_deref())?;
    let info = wsdl::inspect(&resolved, verify_tls.unwrap_or(true)).await?;
    let port_count: usize = info.services.iter().map(|s| s.ports.len()).sum();
    let mut groups = Vec::new();
    for service in &info.services {
        for port in &service.ports {
            let folder = (port_count > 1).then(|| {
                if service.name == info.name {
                    format!("{} (SOAP {})", port.name, port.soap_version)
                } else {
                    format!("{} / {}", service.name, port.name)
                }
            });
            let requests = port
                .operations
                .iter()
                .map(|op| {
                    let mut req = RequestDef::new(op.name.clone(), RequestKind::Soap, 0);
                    req.url = port.address.clone();
                    req.soap = Some(SoapConfig {
                        version: port.soap_version.clone(),
                        action: op.action.clone(),
                        operation: op.name.clone(),
                        wsdl: Some(json!({ "source": source, "service": service.name, "port": port.name })),
                        namespaces: BTreeMap::new(),
                    });
                    req.envelope = Some(op.envelope.clone());
                    req
                })
                .collect::<Vec<_>>();
            groups.push((folder, requests));
        }
    }
    with_ws(&state, |ws| {
        let id = ws.import_collection(&info.name, groups)?;
        Ok(Created { id, tree: ws.tree()? })
    })
}
