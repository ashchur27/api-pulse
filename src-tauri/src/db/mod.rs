pub mod guard;
mod mssql;
mod schema;
mod sqlx_driver;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::model::{DbAuth, DbDriver, TlsMode};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub use schema::SchemaTable;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub db_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<u64>,
    pub truncated: bool,
}

impl QueryResult {
    pub fn new(columns: Vec<ColumnInfo>) -> Self {
        Self {
            columns,
            rows: Vec::new(),
            rows_affected: None,
            truncated: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub results: Vec<QueryResult>,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub latency_ms: f64,
}

pub fn big_int(v: i64) -> Value {
    if v.unsigned_abs() <= (1u64 << 53) {
        Value::from(v)
    } else {
        Value::String(v.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct Resolved {
    pub driver: DbDriver,
    pub host: String,
    pub port: Option<u16>,
    pub instance: Option<String>,
    pub database: String,
    pub file: Option<String>,
    pub auth: DbAuth,
    pub username: String,
    pub password: String,
    pub tls_mode: TlsMode,
    pub trust_server_certificate: bool,
    pub protected: bool,
    pub connect_timeout: Duration,
    pub statement_timeout: Duration,
}

impl Default for Resolved {
    fn default() -> Self {
        Self {
            driver: DbDriver::Postgres,
            host: String::new(),
            port: None,
            instance: None,
            database: String::new(),
            file: None,
            auth: DbAuth::Sql,
            username: String::new(),
            password: String::new(),
            tls_mode: TlsMode::Prefer,
            trust_server_certificate: false,
            protected: false,
            connect_timeout: Duration::from_secs(10),
            statement_timeout: Duration::from_secs(60),
        }
    }
}

impl Resolved {
    fn key(&self) -> String {
        format!(
            "{:?}|{}|{:?}|{:?}|{}|{:?}|{:?}|{}|{}|{:?}|{}|{}",
            self.driver,
            self.host,
            self.port,
            self.instance,
            self.database,
            self.file,
            self.auth,
            self.username,
            self.password,
            self.tls_mode,
            self.trust_server_certificate,
            self.protected
        )
    }
}

#[derive(Clone)]
enum Conn {
    Mssql(Arc<Mutex<mssql::MsClient>>),
    Sqlx(sqlx_driver::Pool),
}

#[derive(Default)]
pub struct DbManager {
    conns: Mutex<HashMap<String, Conn>>,
}

fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "Query cancelled")
}

impl DbManager {
    async fn open(p: &Resolved) -> AppResult<Conn> {
        match p.driver {
            DbDriver::Mssql => Ok(Conn::Mssql(Arc::new(Mutex::new(mssql::connect(p).await?)))),
            DbDriver::Postgres | DbDriver::Mysql | DbDriver::Sqlite => Ok(Conn::Sqlx(sqlx_driver::connect(p).await?)),
            DbDriver::Cosmos => Err(AppError::validation("Cosmos DB is not supported yet")),
        }
    }

    async fn get(&self, p: &Resolved) -> AppResult<Conn> {
        let key = p.key();
        if let Some(c) = self.conns.lock().await.get(&key) {
            return Ok(c.clone());
        }
        let conn = Self::open(p).await?;
        self.conns.lock().await.insert(key, conn.clone());
        Ok(conn)
    }

    async fn evict(&self, p: &Resolved) {
        if let Some(Conn::Sqlx(pool)) = self.conns.lock().await.remove(&p.key()) {
            match pool {
                sqlx_driver::Pool::Pg(p) => p.close().await,
                sqlx_driver::Pool::My(p) => p.close().await,
                sqlx_driver::Pool::Lite(p) => p.close().await,
            }
        }
    }

    pub async fn test(&self, p: &Resolved) -> AppResult<ServerInfo> {
        let started = Instant::now();
        let version = match Self::open(p).await? {
            Conn::Mssql(client) => mssql::version(&mut *client.lock().await).await?,
            Conn::Sqlx(pool) => {
                let v = sqlx_driver::version(&pool).await;
                match &pool {
                    sqlx_driver::Pool::Pg(p) => p.close().await,
                    sqlx_driver::Pool::My(p) => p.close().await,
                    sqlx_driver::Pool::Lite(p) => p.close().await,
                }
                v?
            }
        };
        Ok(ServerInfo {
            version,
            latency_ms: started.elapsed().as_secs_f64() * 1000.0,
        })
    }

    pub async fn execute(
        &self,
        p: &Resolved,
        sql: &str,
        max_rows: usize,
        cancel: CancellationToken,
    ) -> AppResult<ExecResult> {
        let started = Instant::now();
        let conn = self.get(p).await?;
        let work = async {
            let mut results = Vec::new();
            match &conn {
                Conn::Mssql(client) => {
                    let mut client = client.lock().await;
                    for batch in guard::split_batches(sql) {
                        mssql::run(&mut client, &batch, max_rows, &mut results).await?;
                    }
                }
                Conn::Sqlx(pool) => sqlx_driver::run(pool, sql, max_rows, &mut results).await?,
            }
            Ok::<_, AppError>(results)
        };
        let outcome = tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(cancelled()),
            r = tokio::time::timeout(p.statement_timeout, work) => r.unwrap_or_else(|_| {
                Err(AppError::new(ErrorCode::Timeout, format!("Query timed out after {} s", p.statement_timeout.as_secs())))
            }),
        };
        match outcome {
            Ok(results) => Ok(ExecResult {
                results,
                elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
            }),
            Err(e) => {
                if matches!(conn, Conn::Mssql(_)) || matches!(e.code, ErrorCode::Cancelled | ErrorCode::Timeout) {
                    self.conns.lock().await.remove(&p.key());
                }
                if e.code == ErrorCode::Db && e.message.starts_with("Could not connect") {
                    self.evict(p).await;
                }
                Err(e)
            }
        }
    }

    pub async fn schema(&self, p: &Resolved) -> AppResult<Vec<SchemaTable>> {
        let (tables_sql, columns_sql) = schema::queries(p.driver);
        let tables = self.execute(p, tables_sql, 100_000, CancellationToken::new()).await?;
        let columns = self
            .execute(p, columns_sql, 1_000_000, CancellationToken::new())
            .await?;
        Ok(schema::assemble(&tables, &columns))
    }
}

#[cfg(test)]
mod stand_tests {
    use super::*;

    fn stand(driver: DbDriver, port: u16, user: &str, database: &str) -> Resolved {
        Resolved {
            driver,
            host: "127.0.0.1".into(),
            port: Some(port),
            database: database.into(),
            username: user.into(),
            password: std::env::var("DEV_DB_PASSWORD").unwrap_or_else(|_| "ApiPulse_dev_1".into()),
            trust_server_certificate: true,
            ..Resolved::default()
        }
    }

    async fn check(p: Resolved, query: &str) {
        let db = DbManager::default();
        let info = db.test(&p).await.unwrap();
        assert!(!info.version.is_empty());
        let out = db.execute(&p, query, 10, CancellationToken::new()).await.unwrap();
        let rows = &out
            .results
            .iter()
            .find(|r| !r.columns.is_empty())
            .unwrap_or_else(|| panic!("no row set: {:?}", out.results))
            .rows;
        assert_eq!(rows.len(), 2, "{:?}", out.results);
        assert_eq!(rows[0][1], Value::from("alice@example.test"));
        assert_eq!(rows[0][2], Value::from("100.00"));
        let schema = db.schema(&p).await.unwrap();
        let users = schema.iter().find(|t| t.name == "users").unwrap();
        assert!(users.columns.iter().any(|c| c.name == "email"));
    }

    #[tokio::test]
    #[ignore = "needs docker-compose.dev.yml stand"]
    async fn mssql_stand() {
        check(
            stand(DbDriver::Mssql, 14330, "sa", "apipulse"),
            "SELECT TOP 2 u.id, u.email, o.total, u.external_id, o.created_at FROM users u JOIN orders o ON o.user_id = u.id ORDER BY o.id",
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "needs docker-compose.dev.yml stand"]
    async fn postgres_stand() {
        check(
            stand(DbDriver::Postgres, 54320, "apipulse", "apipulse"),
            "SELECT u.id, u.email, o.total, u.external_id, u.tags, o.created_at FROM users u JOIN orders o ON o.user_id = u.id ORDER BY o.id LIMIT 2",
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "needs docker-compose.dev.yml stand"]
    async fn mysql_stand() {
        check(
            stand(DbDriver::Mysql, 33060, "root", "apipulse"),
            "SELECT u.id, u.email, o.total, u.external_id, o.created_at FROM users u JOIN orders o ON o.user_id = u.id ORDER BY o.id LIMIT 2",
        )
        .await;
    }
}
