use crate::error::{AppError, AppResult};
use crate::model::{
    ApiKeyLocation, Auth, Body, ContainerMeta, KeyValue, MultipartKind, RequestDef, RequestKind, WorkspaceDefaults,
};
use crate::vars::{Layer, Resolver};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;

pub const USER_AGENT: &str = concat!("API-Pulse/", env!("CARGO_PKG_VERSION"));
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const SENSITIVE_HEADERS: &[&str] = &["authorization", "proxy-authorization", "cookie", "x-api-key", "api-key"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPart {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PreparedBody {
    Text { text: String },
    Form { fields: Vec<(String, String)> },
    Multipart { parts: Vec<PreparedPart> },
    File { path: String },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreparedRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<PreparedBody>,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub verify_tls: bool,
}

impl PreparedRequest {
    #[cfg(test)]
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    pub fn masked(&self) -> Self {
        let mut copy = self.clone();
        for (k, v) in copy.headers.iter_mut() {
            if SENSITIVE_HEADERS.iter().any(|s| k.eq_ignore_ascii_case(s)) {
                *v = mask(v);
            }
        }
        copy
    }

    pub fn redacted(&self, secrets: &[String]) -> Self {
        let hide = |s: &str| {
            secrets
                .iter()
                .fold(s.to_string(), |acc, secret| acc.replace(secret.as_str(), "••••••"))
        };
        let mut copy = self.masked();
        copy.url = hide(&copy.url);
        for (_, v) in copy.headers.iter_mut() {
            *v = hide(v);
        }
        copy.body = match copy.body.take() {
            Some(PreparedBody::Text { text }) => Some(PreparedBody::Text { text: hide(&text) }),
            Some(PreparedBody::Form { fields }) => Some(PreparedBody::Form {
                fields: fields.into_iter().map(|(k, v)| (k, hide(&v))).collect(),
            }),
            Some(PreparedBody::Multipart { parts }) => Some(PreparedBody::Multipart {
                parts: parts
                    .into_iter()
                    .map(|p| PreparedPart {
                        value: p.value.map(|v| hide(&v)),
                        ..p
                    })
                    .collect(),
            }),
            other => other,
        };
        copy
    }
}

fn mask(value: &str) -> String {
    match value.split_once(' ') {
        Some((scheme, _)) if matches!(scheme.to_ascii_lowercase().as_str(), "basic" | "bearer") => {
            format!("{scheme} ••••••")
        }
        _ => "••••••".into(),
    }
}

pub fn ancestor_layers(ancestors: &[ContainerMeta]) -> Vec<Layer> {
    ancestors
        .iter()
        .map(|meta| {
            let mut layer = Layer::new(meta.name.clone());
            for kv in meta.variables.iter().filter(|kv| kv.enabled && !kv.key.is_empty()) {
                layer.values.insert(kv.key.clone(), Value::String(kv.value.clone()));
            }
            layer
        })
        .collect()
}

pub fn prepare(
    req: &RequestDef,
    ancestors: &[ContainerMeta],
    resolver: &Resolver,
    defaults: &WorkspaceDefaults,
) -> AppResult<PreparedRequest> {
    let r = |s: &str| resolver.resolve(s);

    let method = match req.kind {
        RequestKind::Soap => "POST".to_string(),
        RequestKind::Http => req.method.as_deref().unwrap_or("GET").trim().to_ascii_uppercase(),
    };
    if method.is_empty() || !method.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(AppError::validation(format!("Invalid HTTP method '{method}'")));
    }

    let mut url = r(&req.url)?.trim().to_string();
    if url.is_empty() {
        return Err(AppError::validation("URL is empty"));
    }
    for p in req.params.path.iter().filter(|p| p.enabled && !p.key.is_empty()) {
        url = replace_path_param(&url, &p.key, &r(&p.value)?);
    }
    if !url.contains("://") {
        url = format!("http://{url}");
    }
    let mut parsed =
        reqwest::Url::parse(&url).map_err(|e| AppError::validation(format!("Invalid URL: {url}")).with_details(e))?;

    let mut headers: Vec<(String, String)> = Vec::new();
    for meta in ancestors.iter().rev() {
        merge_headers(&mut headers, &meta.headers, &r)?;
    }
    merge_headers(&mut headers, &req.headers, &r)?;

    match effective_auth(&req.auth, ancestors) {
        Auth::Basic { username, password } => {
            let token = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", r(username)?, r(password)?));
            set_default(&mut headers, "Authorization", format!("Basic {token}"));
        }
        Auth::Bearer { token } => set_default(&mut headers, "Authorization", format!("Bearer {}", r(token)?)),
        Auth::ApiKey { key, value, location } => {
            let (key, value) = (r(key)?, r(value)?);
            if !key.is_empty() {
                match location {
                    ApiKeyLocation::Header => set_default(&mut headers, &key, value),
                    ApiKeyLocation::Query => {
                        parsed.query_pairs_mut().append_pair(&key, &value);
                    }
                }
            }
        }
        Auth::Inherit | Auth::None => {}
    }

    let body = match req.kind {
        RequestKind::Http => prepare_http_body(req.body.as_ref(), &mut headers, &r)?,
        RequestKind::Soap => {
            let soap = req.soap.as_ref();
            let version = soap.map(|s| s.version.as_str()).unwrap_or("1.1");
            let action = r(soap.map(|s| s.action.as_str()).unwrap_or_default())?;
            if version == "1.2" {
                let ct = if action.is_empty() {
                    "application/soap+xml; charset=utf-8".to_string()
                } else {
                    format!("application/soap+xml; charset=utf-8; action=\"{action}\"")
                };
                set_default(&mut headers, "Content-Type", ct);
            } else {
                set_default(&mut headers, "Content-Type", "text/xml; charset=utf-8".into());
                set_default(&mut headers, "SOAPAction", format!("\"{action}\""));
            }
            Some(PreparedBody::Text {
                text: r(req.envelope.as_deref().unwrap_or_default())?,
            })
        }
    };
    set_default(&mut headers, "User-Agent", USER_AGENT.into());

    Ok(PreparedRequest {
        method,
        url: parsed.to_string(),
        headers,
        body,
        timeout_ms: req
            .settings
            .timeout_ms
            .or(defaults.timeout_ms)
            .unwrap_or(DEFAULT_TIMEOUT_MS),
        follow_redirects: req
            .settings
            .follow_redirects
            .or(defaults.follow_redirects)
            .unwrap_or(true),
        verify_tls: req.settings.verify_tls.or(defaults.verify_tls).unwrap_or(true),
    })
}

fn prepare_http_body(
    body: Option<&Body>,
    headers: &mut Vec<(String, String)>,
    r: &impl Fn(&str) -> AppResult<String>,
) -> AppResult<Option<PreparedBody>> {
    let mut text = |raw: &str, ct: &str| -> AppResult<Option<PreparedBody>> {
        set_default(headers, "Content-Type", ct.into());
        Ok(Some(PreparedBody::Text { text: r(raw)? }))
    };
    match body {
        None | Some(Body::None) => Ok(None),
        Some(Body::Json { raw }) => text(raw, "application/json"),
        Some(Body::Xml { raw }) => text(raw, "application/xml"),
        Some(Body::Text { raw }) => text(raw, "text/plain"),
        Some(Body::FormUrlEncoded { fields }) => {
            let fields = fields
                .iter()
                .filter(|f| f.enabled && !f.key.is_empty())
                .map(|f| Ok((r(&f.key)?, r(&f.value)?)))
                .collect::<AppResult<Vec<_>>>()?;
            Ok(Some(PreparedBody::Form { fields }))
        }
        Some(Body::Multipart { fields }) => {
            let parts = fields
                .iter()
                .filter(|f| f.enabled && !f.key.is_empty())
                .map(|f| {
                    Ok(PreparedPart {
                        name: r(&f.key)?,
                        value: (f.kind == MultipartKind::Text).then(|| r(&f.value)).transpose()?,
                        file_path: match (&f.kind, &f.file_path) {
                            (MultipartKind::File, Some(p)) => Some(r(p)?),
                            _ => None,
                        },
                        content_type: f.content_type.clone().filter(|c| !c.is_empty()),
                    })
                })
                .collect::<AppResult<Vec<_>>>()?;
            Ok(Some(PreparedBody::Multipart { parts }))
        }
        Some(Body::Binary { file_path }) => {
            set_default(headers, "Content-Type", "application/octet-stream".into());
            Ok(Some(PreparedBody::File { path: r(file_path)? }))
        }
    }
}

fn effective_auth<'a>(own: &'a Auth, ancestors: &'a [ContainerMeta]) -> &'a Auth {
    if !matches!(own, Auth::Inherit) {
        return own;
    }
    ancestors
        .iter()
        .map(|m| &m.auth)
        .find(|a| !matches!(a, Auth::Inherit))
        .unwrap_or(&Auth::None)
}

fn merge_headers(
    headers: &mut Vec<(String, String)>,
    source: &[KeyValue],
    r: &impl Fn(&str) -> AppResult<String>,
) -> AppResult<()> {
    for kv in source.iter().filter(|kv| kv.enabled && !kv.key.trim().is_empty()) {
        let key = r(kv.key.trim())?;
        headers.retain(|(k, _)| !k.eq_ignore_ascii_case(&key));
        headers.push((key, r(&kv.value)?));
    }
    Ok(())
}

fn set_default(headers: &mut Vec<(String, String)>, name: &str, value: String) {
    if !headers.iter().any(|(k, _)| k.eq_ignore_ascii_case(name)) {
        headers.push((name.to_string(), value));
    }
}

pub fn replace_path_param(url: &str, key: &str, value: &str) -> String {
    let needle = format!("/:{key}");
    let mut out = String::with_capacity(url.len());
    let mut rest = url;
    while let Some(pos) = rest.find(&needle) {
        let after = &rest[pos + needle.len()..];
        let boundary = after.is_empty() || after.starts_with(['/', '?', '#']);
        out.push_str(&rest[..pos]);
        if boundary {
            out.push('/');
            out.push_str(value);
        } else {
            out.push_str(&needle);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RequestKind, SoapConfig};
    use crate::vars::VarScope;

    fn kv(key: &str, value: &str) -> KeyValue {
        KeyValue {
            key: key.into(),
            value: value.into(),
            enabled: true,
            description: String::new(),
        }
    }

    fn scope() -> VarScope {
        VarScope::new(vec![Layer::new("env")
            .with("baseUrl", "api.test")
            .with("token", "t0k")
            .with("id", "7")])
    }

    #[test]
    fn redacts_secret_values_everywhere() {
        let mut layer = Layer::new("env").with("pwd", "hunter2");
        layer.secrets.insert("pwd".into());
        let s = VarScope::new(vec![layer]);
        let resolver = Resolver::new(&s);
        let mut req = RequestDef::new("R", RequestKind::Http, 0);
        req.url = "https://h/login?p={{pwd}}".into();
        req.headers = vec![kv("X-Pass", "{{pwd}}")];
        req.body = Some(Body::Json {
            raw: "{\"p\":\"{{pwd}}\"}".into(),
        });
        let p = prepare(&req, &[], &resolver, &WorkspaceDefaults::default()).unwrap();
        let shown = p.redacted(&s.secret_values());
        let text = serde_json::to_string(&shown).unwrap();
        assert!(!text.contains("hunter2"), "{text}");
        assert!(serde_json::to_string(&p).unwrap().contains("hunter2"));
    }

    #[test]
    fn path_params_respect_boundaries() {
        assert_eq!(
            replace_path_param("http://h/users/:id/x", "id", "7"),
            "http://h/users/7/x"
        );
        assert_eq!(replace_path_param("http://h/users/:id", "id", "7"), "http://h/users/7");
        assert_eq!(
            replace_path_param("http://h/users/:idx?q=1", "id", "7"),
            "http://h/users/:idx?q=1"
        );
        assert_eq!(replace_path_param("http://h/:id?q=:id", "id", "7"), "http://h/7?q=:id");
    }

    #[test]
    fn builds_http_request_with_inheritance() {
        let s = scope();
        let resolver = Resolver::new(&s);
        let mut collection = ContainerMeta::new("C", 0, true);
        collection.auth = Auth::Bearer {
            token: "{{token}}".into(),
        };
        collection.headers = vec![kv("X-Client", "pulse"), kv("Accept", "text/plain")];
        let mut req = RequestDef::new("R", RequestKind::Http, 0);
        req.method = Some("post".into());
        req.url = "{{baseUrl}}/users/:id".into();
        req.params.path = vec![kv("id", "{{id}}")];
        req.headers = vec![kv("accept", "application/json")];
        req.body = Some(Body::Json {
            raw: "{\"id\": {{id}}}".into(),
        });

        let p = prepare(&req, &[collection], &resolver, &WorkspaceDefaults::default()).unwrap();
        assert_eq!(p.method, "POST");
        assert_eq!(p.url, "http://api.test/users/7");
        assert_eq!(p.header("authorization"), Some("Bearer t0k"));
        assert_eq!(p.header("Accept"), Some("application/json"));
        assert_eq!(p.header("X-Client"), Some("pulse"));
        assert_eq!(p.header("content-type"), Some("application/json"));
        assert_eq!(
            p.body,
            Some(PreparedBody::Text {
                text: "{\"id\": 7}".into()
            })
        );
        assert_eq!(p.timeout_ms, DEFAULT_TIMEOUT_MS);
        assert_eq!(p.masked().header("authorization"), Some("Bearer ••••••"));
    }

    #[test]
    fn builds_soap_headers() {
        let s = scope();
        let resolver = Resolver::new(&s);
        let mut req = RequestDef::new("S", RequestKind::Soap, 0);
        req.url = "https://svc/Service.svc".into();
        req.soap = Some(SoapConfig {
            action: "urn:Get".into(),
            ..req.soap.unwrap()
        });
        let p = prepare(&req, &[], &resolver, &WorkspaceDefaults::default()).unwrap();
        assert_eq!(p.method, "POST");
        assert_eq!(p.header("Content-Type"), Some("text/xml; charset=utf-8"));
        assert_eq!(p.header("SOAPAction"), Some("\"urn:Get\""));

        req.soap.as_mut().unwrap().version = "1.2".into();
        let p = prepare(&req, &[], &resolver, &WorkspaceDefaults::default()).unwrap();
        assert_eq!(
            p.header("Content-Type"),
            Some("application/soap+xml; charset=utf-8; action=\"urn:Get\"")
        );
        assert_eq!(p.header("SOAPAction"), None);
    }

    #[test]
    fn api_key_in_query_and_invalid_url() {
        let s = scope();
        let resolver = Resolver::new(&s);
        let mut req = RequestDef::new("R", RequestKind::Http, 0);
        req.url = "https://h/x?a=1".into();
        req.auth = Auth::ApiKey {
            key: "api_key".into(),
            value: "{{token}}".into(),
            location: ApiKeyLocation::Query,
        };
        let p = prepare(&req, &[], &resolver, &WorkspaceDefaults::default()).unwrap();
        assert_eq!(p.url, "https://h/x?a=1&api_key=t0k");

        req.url = "http://exa mple.com:99999".into();
        assert!(prepare(&req, &[], &resolver, &WorkspaceDefaults::default()).is_err());
    }
}
