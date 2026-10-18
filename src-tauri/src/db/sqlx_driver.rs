use super::{big_int, ColumnInfo, QueryResult, Resolved};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::model::{DbDriver, TlsMode};
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::TryStreamExt;
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::mysql::{MySqlConnectOptions, MySqlPool, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow, PgSslMode};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions, SqliteRow};
use sqlx::{Column, Either, Row, TypeInfo};

#[derive(Clone)]
pub enum Pool {
    Pg(PgPool),
    My(MySqlPool),
    Lite(SqlitePool),
}

pub fn map_err(e: sqlx::Error) -> AppError {
    let message = match &e {
        sqlx::Error::Database(db) => format!("Database error: {}", db.message()),
        sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut => "Could not connect to the database".to_string(),
        sqlx::Error::Tls(_) => "TLS handshake with the database failed".to_string(),
        sqlx::Error::Configuration(_) => "Invalid connection settings".to_string(),
        _ => "Database request failed".to_string(),
    };
    AppError::new(ErrorCode::Db, message).with_details(e)
}

pub async fn connect(p: &Resolved) -> AppResult<Pool> {
    Ok(match p.driver {
        DbDriver::Postgres => {
            let mut opts = PgConnectOptions::new()
                .host(&p.host)
                .username(&p.username)
                .password(&p.password)
                .application_name("API-Pulse")
                .ssl_mode(match p.tls_mode {
                    TlsMode::Disable => PgSslMode::Disable,
                    TlsMode::Prefer => PgSslMode::Prefer,
                    TlsMode::Require => PgSslMode::Require,
                });
            if let Some(port) = p.port {
                opts = opts.port(port);
            }
            if !p.database.is_empty() {
                opts = opts.database(&p.database);
            }
            Pool::Pg(
                PgPoolOptions::new()
                    .max_connections(3)
                    .acquire_timeout(p.connect_timeout)
                    .connect_with(opts)
                    .await
                    .map_err(map_err)?,
            )
        }
        DbDriver::Mysql => {
            let mut opts = MySqlConnectOptions::new()
                .host(&p.host)
                .username(&p.username)
                .password(&p.password)
                .ssl_mode(match p.tls_mode {
                    TlsMode::Disable => MySqlSslMode::Disabled,
                    TlsMode::Prefer => MySqlSslMode::Preferred,
                    TlsMode::Require => MySqlSslMode::Required,
                });
            if let Some(port) = p.port {
                opts = opts.port(port);
            }
            if !p.database.is_empty() {
                opts = opts.database(&p.database);
            }
            Pool::My(
                MySqlPoolOptions::new()
                    .max_connections(3)
                    .acquire_timeout(p.connect_timeout)
                    .connect_with(opts)
                    .await
                    .map_err(map_err)?,
            )
        }
        DbDriver::Sqlite => {
            let file = p
                .file
                .as_deref()
                .filter(|f| !f.is_empty())
                .ok_or_else(|| AppError::validation("SQLite file path is empty"))?;
            let opts = SqliteConnectOptions::new()
                .filename(file)
                .create_if_missing(false)
                .read_only(p.protected);
            Pool::Lite(
                SqlitePoolOptions::new()
                    .max_connections(1)
                    .acquire_timeout(p.connect_timeout)
                    .connect_with(opts)
                    .await
                    .map_err(map_err)?,
            )
        }
        _ => return Err(AppError::internal("Unsupported driver for sqlx")),
    })
}

pub async fn version(pool: &Pool) -> AppResult<String> {
    let sql = match pool {
        Pool::Pg(_) => "SELECT version()",
        Pool::My(_) => "SELECT CONCAT('MySQL ', version())",
        Pool::Lite(_) => "SELECT 'SQLite ' || sqlite_version()",
    };
    let mut results = Vec::new();
    run(pool, sql, 1, &mut results).await?;
    Ok(results
        .first()
        .and_then(|r| r.rows.first())
        .and_then(|row| row.first())
        .and_then(|v| v.as_str())
        .map(|s| s.split(" on ").next().unwrap_or(s).to_string())
        .unwrap_or_default())
}

macro_rules! collect {
    ($stream:expr, $max:expr, $results:expr, $decode:path) => {{
        let mut stream = $stream;
        let mut current: Option<QueryResult> = None;
        while let Some(item) = stream.try_next().await.map_err(map_err)? {
            match item {
                Either::Left(done) => {
                    let mut r = current.take().unwrap_or_else(|| QueryResult::new(Vec::new()));
                    r.rows_affected = Some(done.rows_affected());
                    $results.push(r);
                }
                Either::Right(row) => {
                    let r = current.get_or_insert_with(|| {
                        QueryResult::new(
                            row.columns()
                                .iter()
                                .map(|c| ColumnInfo {
                                    name: c.name().to_string(),
                                    db_type: c.type_info().name().to_string(),
                                })
                                .collect(),
                        )
                    });
                    if r.rows.len() < $max {
                        r.rows.push((0..row.len()).map(|i| $decode(&row, i)).collect());
                    } else {
                        r.truncated = true;
                    }
                }
            }
        }
        if let Some(r) = current {
            $results.push(r);
        }
    }};
}

pub async fn run(pool: &Pool, sql: &str, max_rows: usize, results: &mut Vec<QueryResult>) -> AppResult<()> {
    match pool {
        Pool::Pg(p) => collect!(sqlx::raw_sql(sql).fetch_many(p), max_rows, results, pg_cell),
        Pool::My(p) => collect!(sqlx::raw_sql(sql).fetch_many(p), max_rows, results, my_cell),
        Pool::Lite(p) => collect!(sqlx::raw_sql(sql).fetch_many(p), max_rows, results, lite_cell),
    }
    Ok(())
}

macro_rules! try_types {
    ($row:expr, $i:expr; $( $t:ty => $conv:expr ),* $(,)?) => {{
        $(
            if let Ok(v) = $row.try_get::<Option<$t>, _>($i) {
                return v.map($conv).unwrap_or(Value::Null);
            }
        )*
        Value::String(format!("<{}>", $row.columns()[$i].type_info().name()))
    }};
}

fn text(s: String) -> Value {
    Value::String(s)
}

fn pg_cell(row: &PgRow, i: usize) -> Value {
    try_types!(row, i;
        bool => Value::from,
        i16 => Value::from,
        i32 => Value::from,
        i64 => big_int,
        f32 => |v: f32| Value::from(f64::from(v)),
        f64 => Value::from,
        Decimal => |d: Decimal| text(d.to_string()),
        String => text,
        uuid::Uuid => |u: uuid::Uuid| text(u.to_string()),
        DateTime<Utc> => |d: DateTime<Utc>| text(d.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)),
        NaiveDateTime => |d: NaiveDateTime| text(d.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        NaiveDate => |d: NaiveDate| text(d.to_string()),
        NaiveTime => |t: NaiveTime| text(t.to_string()),
        Value => |v: Value| v,
        Vec<String> => |v: Vec<String>| Value::from(v),
        Vec<i64> => |v: Vec<i64>| Value::from(v),
        Vec<i32> => |v: Vec<i32>| Value::from(v),
        Vec<u8> => |b: Vec<u8>| text(format!("\\x{}", hex::encode(b))),
    )
}

fn my_cell(row: &MySqlRow, i: usize) -> Value {
    try_types!(row, i;
        i64 => big_int,
        u64 => |v: u64| if v <= (1u64 << 53) { Value::from(v) } else { text(v.to_string()) },
        f64 => Value::from,
        f32 => |v: f32| Value::from(f64::from(v)),
        Decimal => |d: Decimal| text(d.to_string()),
        String => text,
        NaiveDateTime => |d: NaiveDateTime| text(d.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        DateTime<Utc> => |d: DateTime<Utc>| text(d.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)),
        NaiveDate => |d: NaiveDate| text(d.to_string()),
        NaiveTime => |t: NaiveTime| text(t.to_string()),
        Value => |v: Value| v,
        bool => Value::from,
        Vec<u8> => |b: Vec<u8>| match String::from_utf8(b) {
            Ok(s) => text(s),
            Err(e) => text(format!("0x{}", hex::encode_upper(e.into_bytes()))),
        },
    )
}

fn lite_cell(row: &SqliteRow, i: usize) -> Value {
    try_types!(row, i;
        i64 => big_int,
        f64 => Value::from,
        String => text,
        bool => Value::from,
        Vec<u8> => |b: Vec<u8>| text(format!("x'{}'", hex::encode_upper(b))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn sqlite_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("t.db");
        std::fs::File::create(&file).unwrap();
        let p = Resolved {
            driver: DbDriver::Sqlite,
            file: Some(file.display().to_string()),
            connect_timeout: Duration::from_secs(5),
            ..Resolved::default()
        };
        let pool = connect(&p).await.unwrap();
        assert!(version(&pool).await.unwrap().starts_with("SQLite "));
        let mut results = Vec::new();
        run(
            &pool,
            "CREATE TABLE u (id INTEGER PRIMARY KEY, name TEXT, score REAL, big INTEGER);
             INSERT INTO u (name, score, big) VALUES ('Ann', 1.5, 9007199254740993), ('Bob', NULL, 1);
             SELECT id, name, score, big FROM u ORDER BY id;",
            1,
            &mut results,
        )
        .await
        .unwrap();
        let select = results.iter().find(|r| !r.columns.is_empty()).unwrap();
        assert_eq!(
            select.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            ["id", "name", "score", "big"]
        );
        assert_eq!(select.rows.len(), 1);
        assert!(select.truncated);
        assert_eq!(
            select.rows[0],
            vec![
                Value::from(1),
                text("Ann".into()),
                Value::from(1.5),
                text("9007199254740993".into())
            ]
        );
        assert!(results.iter().any(|r| r.rows_affected == Some(2)));
    }
}
