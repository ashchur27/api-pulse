use crate::error::{AppError, AppResult, ErrorCode};
use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const RESERVED_WINDOWS_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9", "lpt1", "lpt2",
    "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

pub fn read_yaml<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let text = fs::read_to_string(path)?;
    serde_yaml_ng::from_str(&text)
        .map_err(|e| AppError::new(ErrorCode::Parse, format!("Invalid file: {}", path.display())).with_details(e))
}

pub fn write_yaml<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_yaml_ng::to_string(value)?;
    write_atomic(path, text.as_bytes())
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    fs::write(&tmp, bytes)?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let mut out: String = out.chars().take(60).collect();
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        return "item".into();
    }
    if RESERVED_WINDOWS_NAMES.contains(&out.as_str()) {
        out.push_str("-1");
    }
    out
}

pub fn unique_path(dir: &Path, stem: &str, suffix: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}{suffix}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{n}{suffix}"));
        n += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_handles_unicode_and_symbols() {
        assert_eq!(slugify("Create user"), "create-user");
        assert_eq!(slugify("  GET /users/{id}  "), "get-users-id");
        assert_eq!(slugify("Створити замовлення"), "створити-замовлення");
        assert_eq!(slugify("***"), "item");
        assert_eq!(slugify("CON"), "con-1");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.req.yaml"), "").unwrap();
        fs::write(dir.path().join("a-2.req.yaml"), "").unwrap();
        let p = unique_path(dir.path(), "a", ".req.yaml");
        assert_eq!(p.file_name().unwrap(), "a-3.req.yaml");
    }
}
