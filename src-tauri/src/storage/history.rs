use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const HISTORY_DIR: &str = ".apipulse/history";
const INDEX_FILE: &str = "index.jsonl";
pub const MAX_ENTRIES: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub ts: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn dir(root: &Path) -> AppResult<PathBuf> {
    let dir = root.join(HISTORY_DIR);
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn snapshot_path(dir: &Path, id: &str) -> AppResult<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(AppError::validation("Invalid history id"));
    }
    Ok(dir.join(format!("{id}.json")))
}

fn read_index(dir: &Path) -> Vec<HistoryEntry> {
    fs::read_to_string(dir.join(INDEX_FILE))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

pub fn record(root: &Path, entry: &HistoryEntry, snapshot: &Value) -> AppResult<()> {
    let dir = dir(root)?;
    fs::write(snapshot_path(&dir, &entry.id)?, serde_json::to_vec(snapshot)?)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(INDEX_FILE))?;
    writeln!(file, "{}", serde_json::to_string(entry)?)?;
    drop(file);

    let entries = read_index(&dir);
    if entries.len() > MAX_ENTRIES + MAX_ENTRIES / 5 {
        let cut = entries.len() - MAX_ENTRIES;
        for old in &entries[..cut] {
            let _ = fs::remove_file(snapshot_path(&dir, &old.id)?);
        }
        let kept: String = entries[cut..]
            .iter()
            .filter_map(|e| serde_json::to_string(e).ok())
            .map(|l| l + "\n")
            .collect();
        fs::write(dir.join(INDEX_FILE), kept)?;
    }
    Ok(())
}

pub fn list(root: &Path, limit: usize) -> AppResult<Vec<HistoryEntry>> {
    let mut entries = read_index(&dir(root)?);
    entries.reverse();
    entries.truncate(limit);
    Ok(entries)
}

pub fn get(root: &Path, id: &str) -> AppResult<Value> {
    let path = snapshot_path(&dir(root)?, id)?;
    if !path.is_file() {
        return Err(AppError::not_found("History entry not found"));
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub fn clear(root: &Path) -> AppResult<()> {
    let dir = root.join(HISTORY_DIR);
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(n: usize) -> HistoryEntry {
        HistoryEntry {
            id: format!("0000000{n:04x}-0000-0000-0000-000000000000"),
            ts: "2026-10-18T00:00:00Z".into(),
            request_id: None,
            name: format!("r{n}"),
            method: "GET".into(),
            url: "http://x".into(),
            status: Some(200),
            total_ms: Some(1.0),
            error: None,
        }
    }

    #[test]
    fn records_lists_and_rotates() {
        let dir = tempfile::tempdir().unwrap();
        for n in 0..(MAX_ENTRIES + MAX_ENTRIES / 5 + 1) {
            record(dir.path(), &entry(n), &json!({ "n": n })).unwrap();
        }
        let all = list(dir.path(), 10_000).unwrap();
        assert_eq!(all.len(), MAX_ENTRIES);
        assert_eq!(all[0].name, format!("r{}", MAX_ENTRIES + MAX_ENTRIES / 5));
        assert!(get(dir.path(), &entry(0).id).is_err());
        assert_eq!(get(dir.path(), &all[0].id).unwrap()["n"], MAX_ENTRIES + MAX_ENTRIES / 5);
    }

    #[test]
    fn rejects_path_traversal_and_clears() {
        let dir = tempfile::tempdir().unwrap();
        assert!(get(dir.path(), "../../secret").is_err());
        record(dir.path(), &entry(1), &json!({})).unwrap();
        clear(dir.path()).unwrap();
        assert!(list(dir.path(), 10).unwrap().is_empty());
    }
}
