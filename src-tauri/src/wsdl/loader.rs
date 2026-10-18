use crate::error::{AppError, AppResult, ErrorCode};
use reqwest::Url;
use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::Duration;

const MAX_DOCUMENTS: usize = 50;
const MAX_DOCUMENT_BYTES: usize = 20 * 1024 * 1024;

pub struct SourceDoc {
    pub location: String,
    pub text: String,
}

#[derive(Debug, Clone)]
enum Loc {
    Url(Url),
    File(PathBuf),
}

impl Loc {
    fn parse(s: &str) -> AppResult<Self> {
        let s = s.trim();
        if s.starts_with("http://") || s.starts_with("https://") {
            return Url::parse(s)
                .map(Loc::Url)
                .map_err(|e| AppError::validation(format!("Invalid WSDL URL: {s}")).with_details(e));
        }
        Ok(Loc::File(PathBuf::from(
            s.strip_prefix("file:///")
                .or_else(|| s.strip_prefix("file://"))
                .unwrap_or(s),
        )))
    }

    fn resolve(&self, relative: &str) -> AppResult<Self> {
        if relative.starts_with("http://") || relative.starts_with("https://") {
            return Loc::parse(relative);
        }
        match self {
            Loc::Url(base) => base
                .join(relative)
                .map(Loc::Url)
                .map_err(|e| AppError::validation(format!("Invalid import location: {relative}")).with_details(e)),
            Loc::File(base) => {
                let rel = Path::new(relative);
                Ok(Loc::File(if rel.is_absolute() {
                    rel.to_path_buf()
                } else {
                    base.parent().unwrap_or(Path::new(".")).join(rel)
                }))
            }
        }
    }

    fn key(&self) -> String {
        match self {
            Loc::Url(u) => u.to_string(),
            Loc::File(p) => p.canonicalize().unwrap_or_else(|_| p.clone()).display().to_string(),
        }
    }
}

fn references(text: &str, location: &str) -> AppResult<Vec<String>> {
    let doc = roxmltree::Document::parse(text)
        .map_err(|e| AppError::new(ErrorCode::Parse, format!("Invalid XML in {location}")).with_details(e))?;
    Ok(doc
        .descendants()
        .filter(|n| n.is_element() && matches!(n.tag_name().name(), "import" | "include" | "redefine"))
        .filter_map(|n| n.attribute("schemaLocation").or_else(|| n.attribute("location")))
        .map(String::from)
        .collect())
}

async fn fetch(client: &reqwest::Client, loc: &Loc) -> AppResult<String> {
    let bytes = match loc {
        Loc::Url(url) => {
            let response = client
                .get(url.clone())
                .send()
                .await
                .map_err(|e| AppError::new(ErrorCode::Http, format!("Could not download {url}")).with_details(e))?;
            if !response.status().is_success() {
                return Err(AppError::new(
                    ErrorCode::Http,
                    format!("{url} returned HTTP {}", response.status()),
                ));
            }
            response
                .bytes()
                .await
                .map_err(|e| AppError::new(ErrorCode::Http, format!("Could not download {url}")).with_details(e))?
                .to_vec()
        }
        Loc::File(path) => tokio::fs::read(path)
            .await
            .map_err(|e| AppError::validation(format!("Cannot read {}", path.display())).with_details(e))?,
    };
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::validation(format!("{} is larger than 20 MB", loc.key())));
    }
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

pub async fn load_all(source: &str, verify_tls: bool) -> AppResult<Vec<SourceDoc>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .danger_accept_invalid_certs(!verify_tls)
        .build()
        .map_err(|e| AppError::internal("Could not create HTTP client").with_details(e))?;
    let first = Loc::parse(source)?;
    let mut seen = HashSet::from([first.key()]);
    let mut queue = VecDeque::from([first]);
    let mut docs = Vec::new();
    while let Some(loc) = queue.pop_front() {
        if docs.len() >= MAX_DOCUMENTS {
            return Err(AppError::validation(format!(
                "WSDL imports more than {MAX_DOCUMENTS} documents"
            )));
        }
        let text = fetch(&client, &loc).await?;
        let location = loc.key();
        for reference in references(&text, &location)? {
            let next = loc.resolve(&reference)?;
            if seen.insert(next.key()) {
                queue.push_back(next);
            }
        }
        docs.push(SourceDoc { location, text });
    }
    Ok(docs)
}
