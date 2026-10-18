use super::{big_int, ColumnInfo, QueryResult, Resolved};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::model::{DbAuth, TlsMode};
use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use futures_util::TryStreamExt;
use serde_json::Value;
use tiberius::{AuthMethod, Client, ColumnData, Config, EncryptionLevel, FromSql, QueryItem, SqlBrowser};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

pub type MsClient = Client<Compat<TcpStream>>;

fn map_err(e: tiberius::error::Error) -> AppError {
    let message = match &e {
        tiberius::error::Error::Server(token) => format!("SQL Server error {}: {}", token.code(), token.message()),
        tiberius::error::Error::Io { .. } => "Could not connect to SQL Server".to_string(),
        tiberius::error::Error::Tls(_) => "TLS handshake with SQL Server failed".to_string(),
        _ => "SQL Server request failed".to_string(),
    };
    AppError::new(ErrorCode::Db, message).with_details(e)
}

fn config(p: &Resolved) -> AppResult<Config> {
    let mut config = Config::new();
    config.host(&p.host);
    if let Some(port) = p.port {
        config.port(port);
    }
    if let Some(instance) = p.instance.as_deref().filter(|i| !i.is_empty()) {
        config.instance_name(instance);
    }
    if !p.database.is_empty() {
        config.database(&p.database);
    }
    config.application_name("API-Pulse");
    match p.auth {
        DbAuth::Sql => config.authentication(AuthMethod::sql_server(&p.username, &p.password)),
        DbAuth::Windows => {
            #[cfg(windows)]
            config.authentication(AuthMethod::Integrated);
            #[cfg(not(windows))]
            return Err(AppError::validation(
                "Windows authentication is only available on Windows",
            ));
        }
    }
    config.encryption(match p.tls_mode {
        TlsMode::Disable => EncryptionLevel::NotSupported,
        TlsMode::Prefer => EncryptionLevel::Off,
        TlsMode::Require => EncryptionLevel::Required,
    });
    if p.trust_server_certificate {
        config.trust_cert();
    }
    Ok(config)
}

async fn tcp(config: &Config, named: bool) -> AppResult<TcpStream> {
    let stream = if named {
        TcpStream::connect_named(config).await.map_err(map_err)?
    } else {
        TcpStream::connect(config.get_addr())
            .await
            .map_err(|e| AppError::new(ErrorCode::Db, "Could not connect to SQL Server").with_details(e))?
    };
    stream.set_nodelay(true).ok();
    Ok(stream)
}

pub async fn connect(p: &Resolved) -> AppResult<MsClient> {
    let mut config = config(p)?;
    let named = p.instance.as_deref().is_some_and(|i| !i.is_empty());
    let connecting = async {
        match Client::connect(config.clone(), tcp(&config, named).await?.compat_write()).await {
            Ok(client) => Ok(client),
            Err(tiberius::error::Error::Routing { host, port }) => {
                config.host(&host);
                config.port(port);
                Client::connect(config.clone(), tcp(&config, false).await?.compat_write())
                    .await
                    .map_err(map_err)
            }
            Err(e) => Err(map_err(e)),
        }
    };
    tokio::time::timeout(p.connect_timeout, connecting)
        .await
        .map_err(|_| AppError::new(ErrorCode::Timeout, "Connection to SQL Server timed out"))?
}

pub async fn version(client: &mut MsClient) -> AppResult<String> {
    let row = client
        .simple_query("SELECT @@VERSION")
        .await
        .map_err(map_err)?
        .into_row()
        .await
        .map_err(map_err)?;
    Ok(row
        .and_then(|r| {
            r.get::<&str, _>(0)
                .map(|s| s.lines().next().unwrap_or(s).trim().to_string())
        })
        .unwrap_or_default())
}

pub async fn run(client: &mut MsClient, sql: &str, max_rows: usize, results: &mut Vec<QueryResult>) -> AppResult<()> {
    let mut stream = client.simple_query(sql).await.map_err(map_err)?;
    let mut current: Option<QueryResult> = None;
    while let Some(item) = stream.try_next().await.map_err(map_err)? {
        match item {
            QueryItem::Metadata(meta) => {
                if let Some(done) = current.take() {
                    results.push(done);
                }
                current = Some(QueryResult::new(
                    meta.columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            db_type: format!("{:?}", c.column_type()),
                        })
                        .collect(),
                ));
            }
            QueryItem::Row(row) => {
                if let Some(r) = current.as_mut() {
                    if r.rows.len() < max_rows {
                        r.rows.push(row.into_iter().map(cell).collect());
                    } else {
                        r.truncated = true;
                    }
                }
            }
        }
    }
    if let Some(done) = current {
        results.push(done);
    }
    Ok(())
}

fn cell(data: ColumnData<'static>) -> Value {
    fn s(v: Option<String>) -> Value {
        v.map(Value::String).unwrap_or(Value::Null)
    }
    match &data {
        ColumnData::U8(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I16(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I32(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::I64(v) => v.map(big_int).unwrap_or(Value::Null),
        ColumnData::F32(v) => v.map(|x| Value::from(f64::from(x))).unwrap_or(Value::Null),
        ColumnData::F64(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::Bit(v) => v.map(Value::from).unwrap_or(Value::Null),
        ColumnData::String(v) => s(v.as_ref().map(|x| x.to_string())),
        ColumnData::Guid(v) => s(v.map(|g| g.to_string().to_uppercase())),
        ColumnData::Binary(v) => s(v.as_ref().map(|b| format!("0x{}", hex::encode_upper(b)))),
        ColumnData::Numeric(_) => s(rust_decimal::Decimal::from_sql(&data)
            .ok()
            .flatten()
            .map(|d| d.to_string())),
        ColumnData::Xml(v) => s(v.as_ref().map(|x| x.to_string())),
        ColumnData::Date(_) => s(NaiveDate::from_sql(&data).ok().flatten().map(|d| d.to_string())),
        ColumnData::Time(_) => s(NaiveTime::from_sql(&data)
            .ok()
            .flatten()
            .map(|t| t.format("%H:%M:%S%.f").to_string())),
        ColumnData::DateTimeOffset(_) => s(DateTime::<FixedOffset>::from_sql(&data)
            .ok()
            .flatten()
            .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true))),
        ColumnData::DateTime(_) | ColumnData::SmallDateTime(_) | ColumnData::DateTime2(_) => {
            s(NaiveDateTime::from_sql(&data)
                .ok()
                .flatten()
                .map(|d| d.format("%Y-%m-%d %H:%M:%S%.3f").to_string()))
        }
    }
}
