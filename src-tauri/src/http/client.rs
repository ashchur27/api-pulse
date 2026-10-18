use super::prepare::{PreparedBody, PreparedRequest};
use crate::error::{AppError, AppResult, ErrorCode};
use base64::Engine;
use reqwest::cookie::Jar;
use reqwest::redirect::Policy;
use reqwest::{Client, Method};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

const MAX_BODY_BYTES: usize = 50 * 1024 * 1024;
const MAX_DISPLAY_BYTES: usize = 10 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cookie {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<String>,
    pub http_only: bool,
    pub secure: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResponseBody {
    Text { text: String, truncated: bool },
    Binary { base64: String, truncated: bool },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sizes {
    pub headers: usize,
    pub body: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub ttfb_ms: f64,
    pub download_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_addr: Option<String>,
    pub headers: Vec<(String, String)>,
    pub cookies: Vec<Cookie>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub body: ResponseBody,
    pub size: Sizes,
    pub timings: Timings,
}

pub struct HttpEngine {
    jar: Arc<Jar>,
    clients: Mutex<HashMap<(bool, bool), Client>>,
}

const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024;

impl HttpResponse {
    pub fn for_snapshot(&self) -> Self {
        let mut copy = self.clone();
        copy.body = match &self.body {
            ResponseBody::Text { text, .. } if text.len() > MAX_SNAPSHOT_BYTES => {
                let mut end = MAX_SNAPSHOT_BYTES;
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                ResponseBody::Text {
                    text: text[..end].to_string(),
                    truncated: true,
                }
            }
            ResponseBody::Binary { base64, .. } if base64.len() > MAX_SNAPSHOT_BYTES => ResponseBody::Binary {
                base64: String::new(),
                truncated: true,
            },
            other => other.clone(),
        };
        copy
    }
}

impl Default for HttpEngine {
    fn default() -> Self {
        Self {
            jar: Arc::new(Jar::default()),
            clients: Mutex::default(),
        }
    }
}

fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "Request cancelled")
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut source = e.source();
    while let Some(s) = source {
        let text = s.to_string();
        if !parts.contains(&text) {
            parts.push(text);
        }
        source = s.source();
    }
    parts.join(": ")
}

fn map_error(e: reqwest::Error, timeout_ms: u64) -> AppError {
    let err = if e.is_timeout() {
        AppError::new(ErrorCode::Timeout, format!("Request timed out after {timeout_ms} ms"))
    } else if e.is_connect() {
        AppError::new(ErrorCode::Http, "Could not connect to the server")
    } else if e.is_redirect() {
        AppError::new(ErrorCode::Http, format!("Too many redirects (limit {MAX_REDIRECTS})"))
    } else if e.is_builder() {
        AppError::validation("Invalid request")
    } else {
        AppError::new(ErrorCode::Http, "Request failed")
    };
    err.with_details(error_chain(&e))
}

impl HttpEngine {
    fn client(&self, verify_tls: bool, follow_redirects: bool) -> AppResult<Client> {
        let mut clients = self
            .clients
            .lock()
            .map_err(|_| AppError::internal("HTTP client lock poisoned"))?;
        if let Some(c) = clients.get(&(verify_tls, follow_redirects)) {
            return Ok(c.clone());
        }
        let client = Client::builder()
            .cookie_provider(self.jar.clone())
            .redirect(if follow_redirects {
                Policy::limited(MAX_REDIRECTS)
            } else {
                Policy::none()
            })
            .danger_accept_invalid_certs(!verify_tls)
            .build()
            .map_err(|e| AppError::internal("Could not create HTTP client").with_details(e))?;
        clients.insert((verify_tls, follow_redirects), client.clone());
        Ok(client)
    }

    pub async fn send(&self, req: &PreparedRequest, cancel: CancellationToken) -> AppResult<HttpResponse> {
        let client = self.client(req.verify_tls, req.follow_redirects)?;
        let method = Method::from_bytes(req.method.as_bytes())
            .map_err(|_| AppError::validation(format!("Invalid HTTP method '{}'", req.method)))?;
        let mut builder = client
            .request(method, &req.url)
            .timeout(Duration::from_millis(req.timeout_ms));
        for (k, v) in &req.headers {
            builder = builder.header(k, v);
        }
        builder = match &req.body {
            None => builder,
            Some(PreparedBody::Text { text }) => builder.body(text.clone()),
            Some(PreparedBody::Form { fields }) => builder.form(fields),
            Some(PreparedBody::File { path }) => builder.body(read_file(path).await?),
            Some(PreparedBody::Multipart { parts }) => {
                let mut form = reqwest::multipart::Form::new();
                for part in parts {
                    let mut p = match &part.file_path {
                        Some(path) => reqwest::multipart::Part::file(path)
                            .await
                            .map_err(|e| AppError::validation(format!("Cannot read file {path}")).with_details(e))?,
                        None => reqwest::multipart::Part::text(part.value.clone().unwrap_or_default()),
                    };
                    if let Some(ct) = &part.content_type {
                        p = p
                            .mime_str(ct)
                            .map_err(|e| AppError::validation("Invalid part content type").with_details(e))?;
                    }
                    form = form.part(part.name.clone(), p);
                }
                builder.multipart(form)
            }
        };

        let started = Instant::now();
        let mut response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(cancelled()),
            r = builder.send() => r.map_err(|e| map_error(e, req.timeout_ms))?,
        };
        let ttfb = started.elapsed();

        let status = response.status();
        let http_version = format!("{:?}", response.version());
        let url = response.url().to_string();
        let remote_addr = response.remote_addr().map(|a| a.to_string());
        let headers: Vec<(String, String)> = response
            .headers()
            .iter()
            .map(|(k, v)| {
                (
                    k.as_str().to_string(),
                    String::from_utf8_lossy(v.as_bytes()).into_owned(),
                )
            })
            .collect();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        let mut bytes: Vec<u8> = Vec::new();
        let mut truncated = false;
        loop {
            let chunk = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Err(cancelled()),
                c = response.chunk() => c.map_err(|e| map_error(e, req.timeout_ms))?,
            };
            let Some(chunk) = chunk else { break };
            if bytes.len() + chunk.len() > MAX_BODY_BYTES {
                bytes.extend_from_slice(&chunk[..MAX_BODY_BYTES - bytes.len()]);
                truncated = true;
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        let total = started.elapsed();

        Ok(HttpResponse {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or_default().to_string(),
            http_version,
            url,
            remote_addr,
            cookies: headers
                .iter()
                .filter(|(k, _)| k.eq_ignore_ascii_case("set-cookie"))
                .filter_map(|(_, v)| parse_set_cookie(v))
                .collect(),
            size: Sizes {
                headers: headers.iter().map(|(k, v)| k.len() + v.len() + 4).sum(),
                body: bytes.len(),
            },
            body: decode_body(&bytes, content_type.as_deref(), truncated),
            headers,
            content_type,
            timings: Timings {
                ttfb_ms: ms(ttfb),
                download_ms: ms(total.saturating_sub(ttfb)),
                total_ms: ms(total),
            },
        })
    }
}

async fn read_file(path: &str) -> AppResult<Vec<u8>> {
    tokio::fs::read(path)
        .await
        .map_err(|e| AppError::validation(format!("Cannot read file {path}")).with_details(e))
}

fn ms(d: Duration) -> f64 {
    (d.as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

fn is_textual(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.starts_with("text/")
        || [
            "json",
            "xml",
            "javascript",
            "html",
            "x-www-form-urlencoded",
            "yaml",
            "csv",
            "graphql",
        ]
        .iter()
        .any(|t| ct.contains(t))
}

fn charset(content_type: &str) -> Option<&str> {
    content_type.split(';').skip(1).find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.trim()
            .eq_ignore_ascii_case("charset")
            .then(|| v.trim().trim_matches('"'))
    })
}

pub fn decode_body(bytes: &[u8], content_type: Option<&str>, truncated: bool) -> ResponseBody {
    let textual = match content_type {
        Some(ct) => is_textual(ct),
        None => std::str::from_utf8(bytes).is_ok(),
    };
    let display = &bytes[..bytes.len().min(MAX_DISPLAY_BYTES)];
    let truncated = truncated || display.len() < bytes.len();
    if textual {
        let encoding = content_type
            .and_then(charset)
            .and_then(|c| encoding_rs::Encoding::for_label(c.as_bytes()))
            .unwrap_or(encoding_rs::UTF_8);
        let (text, _, _) = encoding.decode(display);
        ResponseBody::Text {
            text: text.into_owned(),
            truncated,
        }
    } else {
        ResponseBody::Binary {
            base64: base64::engine::general_purpose::STANDARD.encode(display),
            truncated,
        }
    }
}

pub fn parse_set_cookie(header: &str) -> Option<Cookie> {
    let mut parts = header.split(';');
    let (name, value) = parts.next()?.split_once('=')?;
    let mut cookie = Cookie {
        name: name.trim().to_string(),
        value: value.trim().to_string(),
        domain: None,
        path: None,
        expires: None,
        http_only: false,
        secure: false,
    };
    for attr in parts {
        let (k, v) = attr
            .split_once('=')
            .map(|(k, v)| (k.trim(), Some(v.trim())))
            .unwrap_or((attr.trim(), None));
        match k.to_ascii_lowercase().as_str() {
            "domain" => cookie.domain = v.map(String::from),
            "path" => cookie.path = v.map(String::from),
            "expires" => cookie.expires = v.map(String::from),
            "max-age" if cookie.expires.is_none() => cookie.expires = v.map(|s| format!("max-age={s}")),
            "httponly" => cookie.http_only = true,
            "secure" => cookie.secure = true,
            _ => {}
        }
    }
    Some(cookie)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_string, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn prepared(method: &str, url: String) -> PreparedRequest {
        PreparedRequest {
            method: method.into(),
            url,
            headers: vec![("X-Test".into(), "1".into())],
            body: None,
            timeout_ms: 5_000,
            follow_redirects: true,
            verify_tls: true,
        }
    }

    #[tokio::test]
    async fn sends_and_reads_json() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/users"))
            .and(header("X-Test", "1"))
            .and(body_string("{\"a\":1}"))
            .respond_with(
                ResponseTemplate::new(201)
                    .insert_header("Set-Cookie", "sid=abc; Path=/; HttpOnly")
                    .set_body_raw("{\"id\":42}", "application/json; charset=utf-8"),
            )
            .mount(&server)
            .await;
        let mut req = prepared("POST", format!("{}/users", server.uri()));
        req.body = Some(PreparedBody::Text {
            text: "{\"a\":1}".into(),
        });

        let res = HttpEngine::default()
            .send(&req, CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(res.status, 201);
        assert_eq!(res.status_text, "Created");
        assert!(matches!(&res.body, ResponseBody::Text { text, truncated: false } if text == "{\"id\":42}"));
        assert_eq!(res.size.body, 9);
        assert_eq!(res.cookies[0].name, "sid");
        assert!(res.cookies[0].http_only);
        assert!(res.timings.total_ms >= res.timings.ttfb_ms);
    }

    #[tokio::test]
    async fn binary_and_timeout_and_cancel() {
        let server = MockServer::start().await;
        Mock::given(path("/bin"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(vec![0u8, 159, 146, 150], "image/png"))
            .mount(&server)
            .await;
        Mock::given(path("/slow"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(3)))
            .mount(&server)
            .await;
        let engine = HttpEngine::default();

        let res = engine
            .send(
                &prepared("GET", format!("{}/bin", server.uri())),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert!(matches!(res.body, ResponseBody::Binary { .. }));

        let mut slow = prepared("GET", format!("{}/slow", server.uri()));
        slow.timeout_ms = 200;
        let err = engine.send(&slow, CancellationToken::new()).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Timeout);

        slow.timeout_ms = 10_000;
        let token = CancellationToken::new();
        let t = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            t.cancel();
        });
        let started = Instant::now();
        let err = engine.send(&slow, token).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[tokio::test]
    async fn connection_errors_are_readable() {
        let err = HttpEngine::default()
            .send(&prepared("GET", "http://127.0.0.1:1/".into()), CancellationToken::new())
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::Http);
        assert!(err.details.is_some());
    }

    #[test]
    fn decodes_charset() {
        let (bytes, _, _) = encoding_rs::WINDOWS_1251.encode("Привіт");
        match decode_body(&bytes, Some("text/plain; charset=windows-1251"), false) {
            ResponseBody::Text { text, .. } => assert_eq!(text, "Привіт"),
            _ => panic!("expected text"),
        }
    }
}
