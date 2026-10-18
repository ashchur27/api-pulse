use super::{new_id, SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DbDriver {
    Mssql,
    Postgres,
    Mysql,
    Sqlite,
    Cosmos,
}

impl DbDriver {
    pub fn default_port(self) -> Option<u16> {
        match self {
            DbDriver::Mssql => Some(1433),
            DbDriver::Postgres => Some(5432),
            DbDriver::Mysql => Some(3306),
            DbDriver::Sqlite | DbDriver::Cosmos => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DbAuth {
    #[default]
    Sql,
    Windows,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum PasswordMode {
    #[default]
    Keychain,
    Variable,
    None,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum TlsMode {
    Disable,
    #[default]
    Prefer,
    Require,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DbTls {
    #[serde(default)]
    pub mode: TlsMode,
    #[serde(default)]
    pub trust_server_certificate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DbProfile {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub driver: DbDriver,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub database: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default)]
    pub auth: DbAuth,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub username: String,
    #[serde(default)]
    pub password_mode: PasswordMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_variable: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_ref: Option<String>,
    #[serde(default)]
    pub tls: DbTls,
    #[serde(default)]
    pub protected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connect_timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub statement_timeout_ms: Option<u64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl DbProfile {
    pub fn new(name: impl Into<String>, driver: DbDriver) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            id: new_id(),
            name: name.into(),
            driver,
            host: if driver == DbDriver::Sqlite {
                String::new()
            } else {
                "localhost".into()
            },
            port: driver.default_port(),
            instance: None,
            database: String::new(),
            file: None,
            auth: DbAuth::Sql,
            username: String::new(),
            password_mode: PasswordMode::Keychain,
            password_variable: None,
            secret_ref: None,
            tls: DbTls::default(),
            protected: false,
            connect_timeout_ms: None,
            statement_timeout_ms: None,
            extra: BTreeMap::new(),
        }
    }
}
