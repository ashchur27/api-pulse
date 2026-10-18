use super::{new_id, KeyValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RequestKind {
    Http,
    Soap,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Auth {
    #[default]
    Inherit,
    None,
    Basic {
        username: String,
        password: String,
    },
    Bearer {
        token: String,
    },
    ApiKey {
        key: String,
        value: String,
        #[serde(rename = "in")]
        location: ApiKeyLocation,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ApiKeyLocation {
    Header,
    Query,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub key: String,
    pub kind: MultipartKind,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default = "super::default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MultipartKind {
    Text,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Body {
    None,
    Json { raw: String },
    Xml { raw: String },
    Text { raw: String },
    FormUrlEncoded { fields: Vec<KeyValue> },
    Multipart { fields: Vec<MultipartField> },
    Binary { file_path: String },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    #[serde(default)]
    pub query: Vec<KeyValue>,
    #[serde(default)]
    pub path: Vec<KeyValue>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestSettings {
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub follow_redirects: Option<bool>,
    #[serde(default)]
    pub verify_tls: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SoapConfig {
    pub version: String,
    #[serde(default)]
    pub action: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsdl: Option<Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub namespaces: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequestDef {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: RequestKind,
    pub name: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default)]
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soap: Option<SoapConfig>,
    #[serde(default)]
    pub params: Params,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default)]
    pub auth: Auth,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Body>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub envelope: Option<String>,
    #[serde(default)]
    pub settings: RequestSettings,
    #[serde(default)]
    pub extract: Vec<Value>,
    #[serde(default)]
    pub db_checks: Vec<Value>,
    #[serde(default)]
    pub assertions: Vec<Value>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

const SOAP11_TEMPLATE: &str = r#"<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>
  </soapenv:Body>
</soapenv:Envelope>
"#;

impl RequestDef {
    pub fn new(name: impl Into<String>, kind: RequestKind, order: i64) -> Self {
        let (method, soap, body, envelope) = match kind {
            RequestKind::Http => (Some("GET".to_string()), None, Some(Body::None), None),
            RequestKind::Soap => (
                None,
                Some(SoapConfig {
                    version: "1.1".into(),
                    action: String::new(),
                    operation: String::new(),
                    wsdl: None,
                    namespaces: BTreeMap::new(),
                }),
                None,
                Some(SOAP11_TEMPLATE.to_string()),
            ),
        };
        Self {
            id: new_id(),
            kind,
            name: name.into(),
            order,
            method,
            url: String::new(),
            soap,
            params: Params::default(),
            headers: Vec::new(),
            auth: Auth::Inherit,
            body,
            envelope,
            settings: RequestSettings::default(),
            extract: Vec::new(),
            db_checks: Vec::new(),
            assertions: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}
