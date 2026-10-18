mod db;
mod environment;
mod request;

pub use db::*;
pub use environment::*;
pub use request::*;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const SCHEMA_VERSION: u32 = 1;

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDefaults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_redirects: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verify_tls: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub defaults: WorkspaceDefaults,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<KeyValue>,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<KeyValue>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl ContainerMeta {
    pub fn new(name: impl Into<String>, order: i64, is_collection: bool) -> Self {
        Self {
            schema_version: is_collection.then_some(SCHEMA_VERSION),
            id: new_id(),
            name: name.into(),
            description: String::new(),
            order,
            variables: Vec::new(),
            auth: if is_collection { Auth::None } else { Auth::Inherit },
            headers: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}
