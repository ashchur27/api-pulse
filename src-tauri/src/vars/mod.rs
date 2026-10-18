mod dynamic;

use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::Value;
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap, HashSet};

const MAX_DEPTH: usize = 10;

#[derive(Debug, Clone, Default)]
pub struct Layer {
    pub source: String,
    pub values: HashMap<String, Value>,
    pub secrets: HashSet<String>,
}

impl Layer {
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            source: source.into(),
            values: HashMap::new(),
            secrets: HashSet::new(),
        }
    }

    #[cfg(test)]
    pub fn with(mut self, key: impl Into<String>, value: impl Into<Value>) -> Self {
        self.values.insert(key.into(), value.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeVar {
    pub key: String,
    pub value: Value,
    pub source: String,
    pub secret: bool,
}

#[derive(Debug, Clone, Default)]
pub struct VarScope {
    layers: Vec<Layer>,
}

impl VarScope {
    pub fn new(layers: Vec<Layer>) -> Self {
        Self { layers }
    }

    pub fn lookup(&self, name: &str) -> Option<&Value> {
        self.layers.iter().find_map(|l| l.values.get(name))
    }

    pub fn secret_values(&self) -> Vec<String> {
        let mut values: Vec<String> = self
            .layers
            .iter()
            .flat_map(|l| l.secrets.iter().filter_map(|k| l.values.get(k)))
            .filter_map(|v| v.as_str())
            .filter(|s| s.len() >= 3)
            .map(String::from)
            .collect();
        values.sort_by_key(|s| std::cmp::Reverse(s.len()));
        values.dedup();
        values
    }

    pub fn entries(&self) -> Vec<ScopeVar> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for layer in &self.layers {
            for (key, value) in &layer.values {
                if seen.insert(key.clone()) {
                    out.push(ScopeVar {
                        key: key.clone(),
                        value: value.clone(),
                        source: layer.source.clone(),
                        secret: layer.secrets.contains(key),
                    });
                }
            }
        }
        out.sort_by_key(|v| v.key.to_lowercase());
        out
    }
}

pub struct Resolver<'a> {
    scope: &'a VarScope,
    dynamic_cache: RefCell<HashMap<String, String>>,
    warnings: RefCell<BTreeSet<String>>,
}

impl<'a> Resolver<'a> {
    pub fn new(scope: &'a VarScope) -> Self {
        Self {
            scope,
            dynamic_cache: RefCell::default(),
            warnings: RefCell::default(),
        }
    }

    pub fn warnings(&self) -> Vec<String> {
        self.warnings.borrow().iter().cloned().collect()
    }

    pub fn resolve(&self, input: &str) -> AppResult<String> {
        self.resolve_with_stack(input, &mut Vec::new())
    }

    fn resolve_with_stack(&self, input: &str, stack: &mut Vec<String>) -> AppResult<String> {
        if !input.contains("{{") {
            return Ok(input.to_string());
        }
        let mut out = String::with_capacity(input.len());
        let mut rest = input;
        while let Some(pos) = rest.find("{{") {
            if pos > 0 && rest[..pos].ends_with('\\') {
                out.push_str(&rest[..pos - 1]);
                out.push_str("{{");
                rest = &rest[pos + 2..];
                continue;
            }
            out.push_str(&rest[..pos]);
            let after = &rest[pos + 2..];
            let Some(end) = after.find("}}") else {
                out.push_str(&rest[pos..]);
                return Ok(out);
            };
            let raw = &after[..end];
            out.push_str(&self.expand(raw, stack)?);
            rest = &after[end + 2..];
        }
        out.push_str(rest);
        Ok(out)
    }

    fn expand(&self, raw: &str, stack: &mut Vec<String>) -> AppResult<String> {
        let expr = raw.trim();
        let literal = || format!("{{{{{raw}}}}}");
        if let Some(dynamic) = expr.strip_prefix('$') {
            if let Some(v) = self.dynamic_cache.borrow().get(expr) {
                return Ok(v.clone());
            }
            return Ok(match dynamic::evaluate(dynamic) {
                Some(v) => {
                    self.dynamic_cache.borrow_mut().insert(expr.to_string(), v.clone());
                    v
                }
                None => {
                    self.warn(format!("Unknown dynamic variable {{{{{expr}}}}}"));
                    literal()
                }
            });
        }
        if !is_variable_name(expr) {
            return Ok(literal());
        }
        let Some(value) = self.scope.lookup(expr) else {
            self.warn(format!("Variable '{expr}' is not defined"));
            return Ok(literal());
        };
        match value {
            Value::String(s) => {
                if stack.iter().any(|n| n == expr) {
                    let mut chain = stack.clone();
                    chain.push(expr.to_string());
                    return Err(AppError::validation(format!(
                        "Circular variable reference: {}",
                        chain.join(" → ")
                    )));
                }
                if stack.len() >= MAX_DEPTH {
                    return Err(AppError::validation(format!(
                        "Variable nesting is deeper than {MAX_DEPTH} levels at '{expr}'"
                    )));
                }
                stack.push(expr.to_string());
                let resolved = self.resolve_with_stack(s, stack);
                stack.pop();
                resolved
            }
            Value::Null => Ok("null".into()),
            other => Ok(other.to_string()),
        }
    }

    fn warn(&self, message: String) {
        self.warnings.borrow_mut().insert(message);
    }
}

pub fn is_variable_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scope() -> VarScope {
        VarScope::new(vec![
            Layer::new("runtime").with("userId", 42),
            Layer::new("folder").with("path", "/users/{{userId}}"),
            Layer::new("environment")
                .with("baseUrl", "https://{{host}}")
                .with("host", "api.test")
                .with("userId", 1)
                .with("tags", json!(["a", "b"])),
            Layer::new("globals")
                .with("host", "ignored.test")
                .with("a", "{{b}}")
                .with("b", "{{a}}"),
        ])
    }

    #[test]
    fn resolves_by_priority_and_recursively() {
        let s = scope();
        let r = Resolver::new(&s);
        assert_eq!(r.resolve("{{baseUrl}}{{path}}").unwrap(), "https://api.test/users/42");
        assert_eq!(
            r.resolve("{\"tags\": {{tags}}, \"id\": {{ userId }}}").unwrap(),
            "{\"tags\": [\"a\",\"b\"], \"id\": 42}"
        );
        assert!(r.warnings().is_empty());
    }

    #[test]
    fn keeps_undefined_and_warns() {
        let s = scope();
        let r = Resolver::new(&s);
        assert_eq!(r.resolve("x={{missing}}").unwrap(), "x={{missing}}");
        assert_eq!(r.warnings(), vec!["Variable 'missing' is not defined".to_string()]);
    }

    #[test]
    fn escapes_and_ignores_non_variables() {
        let s = scope();
        let r = Resolver::new(&s);
        assert_eq!(r.resolve(r"\{{userId}} {{userId}}").unwrap(), "{{userId}} 42");
        assert_eq!(r.resolve("{{ not a var }} {{").unwrap(), "{{ not a var }} {{");
    }

    #[test]
    fn detects_cycles() {
        let s = scope();
        let err = Resolver::new(&s).resolve("{{a}}").unwrap_err();
        assert!(err.message.contains("a → b → a"), "{}", err.message);
    }

    #[test]
    fn dynamic_values_are_stable_within_one_resolver() {
        let s = VarScope::default();
        let r = Resolver::new(&s);
        let a = r.resolve("{{$uuid}}").unwrap();
        assert_eq!(a, r.resolve("{{$uuid}}").unwrap());
        assert_ne!(a, r.resolve("{{$uuid#2}}").unwrap());
        assert_eq!(a.len(), 36);
        let n: i64 = r.resolve("{{$randomInt(5,5)}}").unwrap().parse().unwrap();
        assert_eq!(n, 5);
        assert_eq!(r.resolve("{{$randomString(12)}}").unwrap().len(), 12);
        assert_eq!(r.resolve("{{$nope}}").unwrap(), "{{$nope}}");
        assert_eq!(r.warnings().len(), 1);
    }
}
