use serde::Serialize;

const WRITE_KEYWORDS: &[&str] = &[
    "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "CREATE", "ALTER", "TRUNCATE", "EXEC", "EXECUTE", "GRANT", "REVOKE",
    "REPLACE", "CALL", "INTO", "COPY", "UPSERT", "RENAME", "DENY", "BACKUP", "RESTORE", "DBCC", "VACUUM", "REINDEX",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub read_only: bool,
    pub destructive: Vec<String>,
}

pub fn strip(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '-' && next == Some('-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if c == '/' && next == Some('*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            out.push(' ');
        } else if c == '\'' {
            i += 1;
            while i < chars.len() {
                if chars[i] == '\'' {
                    if chars.get(i + 1) == Some(&'\'') {
                        i += 2;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            i += 1;
            out.push_str("''");
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '@' || c == '#'))
        .filter(|w| !w.is_empty())
        .map(|w| w.to_ascii_uppercase())
        .collect()
}

pub fn split_batches(sql: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current = String::new();
    for line in sql.lines() {
        if line.trim().eq_ignore_ascii_case("go") {
            if !current.trim().is_empty() {
                batches.push(std::mem::take(&mut current));
            }
            current.clear();
        } else {
            current.push_str(line);
            current.push('\n');
        }
    }
    if !current.trim().is_empty() {
        batches.push(current);
    }
    batches
}

pub fn analyze(sql: &str) -> Analysis {
    let clean = strip(sql);
    let all = words(&clean);
    let read_only = !all.iter().any(|w| WRITE_KEYWORDS.contains(&w.as_str()));
    let mut destructive = Vec::new();
    for statement in clean.split(';').flat_map(|s| split_batches(s).into_iter()) {
        let w = words(&statement);
        let Some(first) = w.first() else { continue };
        let has_where = w.iter().any(|x| x == "WHERE");
        match first.as_str() {
            "DELETE" if !has_where => destructive.push("DELETE without WHERE".into()),
            "UPDATE" if !has_where => destructive.push("UPDATE without WHERE".into()),
            "DROP" => destructive.push(format!("DROP {}", w.get(1).cloned().unwrap_or_default())),
            "TRUNCATE" => destructive.push("TRUNCATE".into()),
            _ => {}
        }
    }
    destructive.dedup();
    Analysis { read_only, destructive }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_reads_and_writes() {
        assert!(analyze("SELECT * FROM users WHERE note = 'delete me' -- update\n").read_only);
        assert!(analyze("with x as (select 1) select * from x; select update_date from t").read_only);
        assert!(!analyze("select * into backup from users").read_only);
        assert!(!analyze("DECLARE @id int = 1\nUPDATE users SET a = 1 WHERE id = @id").read_only);
        assert!(!analyze("exec dbo.Proc").read_only);
    }

    #[test]
    fn detects_destructive_statements() {
        assert_eq!(
            analyze("update users set status = 'x'").destructive,
            vec!["UPDATE without WHERE"]
        );
        assert!(analyze("delete from users where id = 1").destructive.is_empty());
        assert_eq!(
            analyze("DROP TABLE t;\nGO\ntruncate table x").destructive,
            vec!["DROP TABLE", "TRUNCATE"]
        );
        assert!(analyze("select 'drop table x'").destructive.is_empty());
    }

    #[test]
    fn splits_go_batches() {
        assert_eq!(split_batches("select 1\nGO\n  go  \nselect 2\n").len(), 2);
    }
}
