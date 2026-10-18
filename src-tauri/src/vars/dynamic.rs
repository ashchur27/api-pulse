use chrono::{SecondsFormat, Utc};

const ENV_PREFIX: &str = "APIPULSE_";

pub fn evaluate(expr: &str) -> Option<String> {
    let expr = expr.split('#').next().unwrap_or(expr).trim();
    let (name, args) = match expr.find('(') {
        Some(open) if expr.ends_with(')') => (&expr[..open], parse_args(&expr[open + 1..expr.len() - 1])),
        _ => (expr, Vec::new()),
    };
    let int_arg = |i: usize, default: i64| args.get(i).and_then(|a| a.parse::<i64>().ok()).unwrap_or(default);

    Some(match name {
        "uuid" => uuid::Uuid::new_v4().to_string(),
        "timestamp" => Utc::now().timestamp().to_string(),
        "timestampMs" => Utc::now().timestamp_millis().to_string(),
        "isoDate" => Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        "randomInt" => {
            let (min, max) = (int_arg(0, 0), int_arg(1, 1000));
            fastrand::i64(min.min(max)..=max.max(min)).to_string()
        }
        "randomString" => random_alnum(int_arg(0, 10).clamp(1, 1024) as usize),
        "randomEmail" => format!("user_{}@example.test", random_alnum(8).to_lowercase()),
        "env" => {
            let var = args.first()?;
            if !var.starts_with(ENV_PREFIX) {
                return None;
            }
            std::env::var(var).unwrap_or_default()
        }
        _ => return None,
    })
}

fn parse_args(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|a| a.trim().trim_matches('"').to_string())
        .filter(|a| !a.is_empty())
        .collect()
}

fn random_alnum(len: usize) -> String {
    std::iter::repeat_with(fastrand::alphanumeric).take(len).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_requires_prefix() {
        std::env::set_var("APIPULSE_TEST_TOKEN", "t0k");
        assert_eq!(evaluate("env(APIPULSE_TEST_TOKEN)").as_deref(), Some("t0k"));
        assert_eq!(evaluate("env(PATH)"), None);
    }

    #[test]
    fn iso_date_and_email_shapes() {
        assert!(evaluate("isoDate").unwrap().ends_with('Z'));
        assert!(evaluate("randomEmail").unwrap().ends_with("@example.test"));
        assert_eq!(
            evaluate("randomInt(10, 1)")
                .unwrap()
                .parse::<i64>()
                .map(|n| (1..=10).contains(&n)),
            Ok(true)
        );
    }
}
