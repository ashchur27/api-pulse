use super::ExecResult;
use crate::model::DbDriver;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaTable {
    pub schema: String,
    pub name: String,
    pub kind: String,
    pub columns: Vec<SchemaColumn>,
}

pub fn queries(driver: DbDriver) -> (&'static str, &'static str) {
    match driver {
        DbDriver::Postgres => (
            "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2",
            "SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position",
        ),
        DbDriver::Mysql => (
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1, 2",
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
        ),
        DbDriver::Sqlite => (
            "SELECT 'main', name, CASE type WHEN 'view' THEN 'VIEW' ELSE 'BASE TABLE' END FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
            "SELECT 'main', m.name, p.name, p.type, CASE p.\"notnull\" WHEN 1 THEN 'NO' ELSE 'YES' END FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid",
        ),
        _ => (
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY 1, 2",
            "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
        ),
    }
}

fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

pub fn assemble(tables: &ExecResult, columns: &ExecResult) -> Vec<SchemaTable> {
    let mut map: BTreeMap<(String, String), SchemaTable> = BTreeMap::new();
    for row in tables.results.iter().flat_map(|r| r.rows.iter()) {
        let (schema, name) = (text(row.first()), text(row.get(1)));
        let kind = if text(row.get(2)).to_uppercase().contains("VIEW") {
            "view"
        } else {
            "table"
        };
        map.insert(
            (schema.clone(), name.clone()),
            SchemaTable {
                schema,
                name,
                kind: kind.into(),
                columns: Vec::new(),
            },
        );
    }
    for row in columns.results.iter().flat_map(|r| r.rows.iter()) {
        if let Some(t) = map.get_mut(&(text(row.first()), text(row.get(1)))) {
            t.columns.push(SchemaColumn {
                name: text(row.get(2)),
                data_type: text(row.get(3)),
                nullable: text(row.get(4)).eq_ignore_ascii_case("YES"),
            });
        }
    }
    map.into_values().collect()
}
