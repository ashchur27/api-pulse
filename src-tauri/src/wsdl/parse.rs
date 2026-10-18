use super::loader::SourceDoc;
use crate::error::{AppError, AppResult, ErrorCode};
use roxmltree::{Document, Node};
use serde::Serialize;
use std::collections::HashMap;

const XSD: &str = "http://www.w3.org/2001/XMLSchema";
const WSDL: &str = "http://schemas.xmlsoap.org/wsdl/";
const SOAP11_BIND: &str = "http://schemas.xmlsoap.org/wsdl/soap/";
const SOAP12_BIND: &str = "http://schemas.xmlsoap.org/wsdl/soap12/";
const SOAP11_ENV: &str = "http://schemas.xmlsoap.org/soap/envelope/";
const SOAP12_ENV: &str = "http://www.w3.org/2003/05/soap-envelope";
const MAX_DEPTH: usize = 12;

type QName = (String, String);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsdlOperation {
    pub name: String,
    pub action: String,
    pub style: String,
    pub envelope: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsdlPort {
    pub name: String,
    pub binding: String,
    pub soap_version: String,
    pub address: String,
    pub operations: Vec<WsdlOperation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsdlService {
    pub name: String,
    pub ports: Vec<WsdlPort>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsdlInfo {
    pub source: String,
    pub name: String,
    pub target_namespace: String,
    pub documents: usize,
    pub services: Vec<WsdlService>,
    pub warnings: Vec<String>,
}

fn is(n: Node, ns: &str, name: &str) -> bool {
    n.is_element() && n.tag_name().namespace() == Some(ns) && n.tag_name().name() == name
}

fn children<'a, 'i>(n: Node<'a, 'i>, ns: &'static str) -> impl Iterator<Item = Node<'a, 'i>> {
    n.children()
        .filter(move |c| c.is_element() && c.tag_name().namespace() == Some(ns))
}

fn child<'a, 'i>(n: Node<'a, 'i>, ns: &'static str, name: &str) -> Option<Node<'a, 'i>> {
    children(n, ns).find(|c| c.tag_name().name() == name)
}

fn qname(n: Node, value: &str) -> QName {
    match value.split_once(':') {
        Some((prefix, local)) => (
            n.lookup_namespace_uri(Some(prefix)).unwrap_or_default().to_string(),
            local.to_string(),
        ),
        None => (
            n.lookup_namespace_uri(None).unwrap_or_default().to_string(),
            value.to_string(),
        ),
    }
}

fn schema_of<'a, 'i>(n: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    n.ancestors().find(|a| is(*a, XSD, "schema"))
}

fn tns(n: Node) -> String {
    schema_of(n)
        .and_then(|s| s.attribute("targetNamespace"))
        .unwrap_or_default()
        .to_string()
}

#[derive(Default)]
struct Index<'a, 'i> {
    elements: HashMap<QName, Node<'a, 'i>>,
    complex: HashMap<QName, Node<'a, 'i>>,
    simple: HashMap<QName, Node<'a, 'i>>,
    groups: HashMap<QName, Node<'a, 'i>>,
    messages: HashMap<QName, Node<'a, 'i>>,
    port_types: HashMap<QName, Node<'a, 'i>>,
    bindings: HashMap<QName, Node<'a, 'i>>,
    services: Vec<(String, Node<'a, 'i>)>,
    definitions: Vec<Node<'a, 'i>>,
}

impl<'a, 'i> Index<'a, 'i> {
    fn build(docs: &'a [Document<'i>]) -> Self {
        let mut idx = Index::default();
        for doc in docs {
            for node in doc.descendants() {
                if is(node, XSD, "schema") {
                    let ns = node.attribute("targetNamespace").unwrap_or_default().to_string();
                    for c in children(node, XSD) {
                        let Some(name) = c.attribute("name") else { continue };
                        let key = (ns.clone(), name.to_string());
                        let map = match c.tag_name().name() {
                            "element" => &mut idx.elements,
                            "complexType" => &mut idx.complex,
                            "simpleType" => &mut idx.simple,
                            "group" => &mut idx.groups,
                            _ => continue,
                        };
                        map.entry(key).or_insert(c);
                    }
                } else if is(node, WSDL, "definitions") {
                    idx.definitions.push(node);
                    let ns = node.attribute("targetNamespace").unwrap_or_default().to_string();
                    for c in children(node, WSDL) {
                        let Some(name) = c.attribute("name") else { continue };
                        let key = (ns.clone(), name.to_string());
                        match c.tag_name().name() {
                            "message" => {
                                idx.messages.insert(key, c);
                            }
                            "portType" => {
                                idx.port_types.insert(key, c);
                            }
                            "binding" => {
                                idx.bindings.insert(key, c);
                            }
                            "service" => idx.services.push((name.to_string(), c)),
                            _ => {}
                        }
                    }
                }
            }
        }
        idx
    }
}

struct Gen<'x, 'a, 'i> {
    idx: &'x Index<'a, 'i>,
    prefixes: Vec<(String, String)>,
    out: String,
    stack: Vec<QName>,
}

impl<'x, 'a, 'i> Gen<'x, 'a, 'i> {
    fn new(idx: &'x Index<'a, 'i>) -> Self {
        Self {
            idx,
            prefixes: Vec::new(),
            out: String::new(),
            stack: Vec::new(),
        }
    }

    fn prefix(&mut self, ns: &str, hint: Node) -> String {
        if let Some((_, p)) = self.prefixes.iter().find(|(n, _)| n == ns) {
            return p.clone();
        }
        let taken = |p: &str, list: &[(String, String)]| {
            matches!(p, "soapenv" | "soap" | "xml" | "xmlns") || list.iter().any(|(_, x)| x == p)
        };
        let usable = |p: &&str| !p.is_empty() && !taken(p, &self.prefixes);
        let candidate = self
            .idx
            .definitions
            .first()
            .and_then(|d| d.lookup_prefix(ns))
            .filter(usable)
            .or_else(|| hint.lookup_prefix(ns).filter(usable));
        let prefix = match candidate {
            Some(p) => p.to_string(),
            None => (1..)
                .map(|n| format!("ns{n}"))
                .find(|p| !taken(p, &self.prefixes))
                .unwrap(),
        };
        self.prefixes.push((ns.to_string(), prefix.clone()));
        prefix
    }

    fn tag(&mut self, ns: &str, name: &str, hint: Node) -> String {
        if ns.is_empty() {
            name.to_string()
        } else {
            format!("{}:{name}", self.prefix(ns, hint))
        }
    }

    fn line(&mut self, depth: usize, text: &str) {
        self.out.push_str(&"  ".repeat(depth));
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn occurrence(&mut self, el: Node, depth: usize) {
        let min = el.attribute("minOccurs").unwrap_or("1");
        let max = el.attribute("maxOccurs").unwrap_or("1");
        let many = max == "unbounded" || max.parse::<u32>().is_ok_and(|m| m > 1);
        match (min == "0", many) {
            (true, true) => self.line(depth, "<!--Zero or more repetitions:-->"),
            (false, true) => self.line(depth, "<!--1 or more repetitions:-->"),
            (true, false) => self.line(depth, "<!--Optional:-->"),
            _ => {}
        }
    }

    fn element(&mut self, el: Node<'a, 'i>, depth: usize) {
        if let Some(r) = el.attribute("ref") {
            let q = qname(el, r);
            self.occurrence(el, depth);
            match self.idx.elements.get(&q).copied() {
                Some(global) => self.element_body(global, depth, true),
                None => self.line(depth, &format!("<!--unresolved element {}-->", q.1)),
            }
            return;
        }
        self.occurrence(el, depth);
        let global = schema_of(el).is_some_and(|s| el.parent() == Some(s));
        self.element_body(el, depth, global);
    }

    fn element_body(&mut self, el: Node<'a, 'i>, depth: usize, global: bool) {
        let name = el.attribute("name").unwrap_or("element");
        let qualified = global
            || match el.attribute("form") {
                Some(form) => form == "qualified",
                None => schema_of(el).and_then(|s| s.attribute("elementFormDefault")) == Some("qualified"),
            };
        let ns = if qualified { tns(el) } else { String::new() };
        let tag = self.tag(&ns, name, el);
        if depth > MAX_DEPTH {
            self.line(depth, &format!("<{tag}>?</{tag}>"));
            return;
        }
        if let Some(t) = el.attribute("type") {
            let q = qname(el, t);
            if q.0 != XSD {
                if let Some(ct) = self.idx.complex.get(&q).copied() {
                    self.complex(ct, &tag, depth, Some(q));
                    return;
                }
            }
        } else if let Some(ct) = child(el, XSD, "complexType") {
            self.complex(ct, &tag, depth, None);
            return;
        }
        self.line(depth, &format!("<{tag}>?</{tag}>"));
    }

    fn complex(&mut self, ct: Node<'a, 'i>, tag: &str, depth: usize, type_name: Option<QName>) {
        if let Some(q) = &type_name {
            if self.stack.contains(q) {
                self.line(depth, &format!("<{tag}><!--recursive type {}--></{tag}>", q.1));
                return;
            }
            self.stack.push(q.clone());
        }
        let start = self.out.len();
        self.line(depth, &format!("<{tag}>"));
        let mark = self.out.len();
        self.content(ct, depth + 1);
        if self.out.len() == mark {
            self.out.truncate(start);
            self.line(depth, &format!("<{tag}>?</{tag}>"));
        } else {
            self.line(depth, &format!("</{tag}>"));
        }
        if type_name.is_some() {
            self.stack.pop();
        }
    }

    fn content(&mut self, ct: Node<'a, 'i>, depth: usize) {
        for c in children(ct, XSD) {
            match c.tag_name().name() {
                "sequence" | "all" | "choice" => self.particles(c, depth),
                "group" => self.group(c, depth),
                "complexContent" => {
                    for d in children(c, XSD) {
                        if d.tag_name().name() == "extension" {
                            if let Some(base) = d.attribute("base").map(|b| qname(d, b)) {
                                if let Some(b) = self.idx.complex.get(&base).copied() {
                                    if !self.stack.contains(&base) {
                                        self.stack.push(base);
                                        self.content(b, depth);
                                        self.stack.pop();
                                    }
                                }
                            }
                        }
                        self.content(d, depth);
                    }
                }
                _ => {}
            }
        }
    }

    fn particles(&mut self, p: Node<'a, 'i>, depth: usize) {
        if p.tag_name().name() == "choice" {
            let n = children(p, XSD).count();
            self.line(
                depth,
                &format!("<!--You have a CHOICE of the next {n} items at this level-->"),
            );
        }
        for c in children(p, XSD) {
            match c.tag_name().name() {
                "element" => self.element(c, depth),
                "sequence" | "all" | "choice" => self.particles(c, depth),
                "group" => self.group(c, depth),
                "any" => self.line(depth, "<!--You may enter ANY elements at this point-->"),
                _ => {}
            }
        }
    }

    fn group(&mut self, g: Node<'a, 'i>, depth: usize) {
        let def = match g.attribute("ref") {
            Some(r) => self.idx.groups.get(&qname(g, r)).copied(),
            None => Some(g),
        };
        if let Some(def) = def {
            for c in children(def, XSD) {
                self.particles(c, depth);
            }
        }
    }

    fn type_content(&mut self, part: Node<'a, 'i>, name: &str, type_attr: &str, depth: usize) {
        let q = qname(part, type_attr);
        match self.idx.complex.get(&q).copied() {
            Some(ct) if q.0 != XSD => self.complex(ct, name, depth, Some(q)),
            _ => self.line(depth, &format!("<{name}>?</{name}>")),
        }
    }

    fn envelope(mut self, soap12: bool) -> String {
        let (p, uri) = if soap12 {
            ("soap", SOAP12_ENV)
        } else {
            ("soapenv", SOAP11_ENV)
        };
        let mut decl = format!("xmlns:{p}=\"{uri}\"");
        for (ns, prefix) in &self.prefixes {
            decl.push_str(&format!(" xmlns:{prefix}=\"{ns}\""));
        }
        let body = std::mem::take(&mut self.out);
        format!("<{p}:Envelope {decl}>\n  <{p}:Header/>\n  <{p}:Body>\n{body}  </{p}:Body>\n</{p}:Envelope>\n")
    }
}

fn soap_child<'a, 'i>(n: Node<'a, 'i>, name: &str) -> Option<(Node<'a, 'i>, bool)> {
    n.children().find_map(|c| {
        if is(c, SOAP11_BIND, name) {
            Some((c, false))
        } else if is(c, SOAP12_BIND, name) {
            Some((c, true))
        } else {
            None
        }
    })
}

fn build_operation<'a, 'i>(
    idx: &Index<'a, 'i>,
    binding: Node<'a, 'i>,
    port_type: Option<Node<'a, 'i>>,
    op: Node<'a, 'i>,
    soap12: bool,
    default_style: &str,
    warnings: &mut Vec<String>,
) -> WsdlOperation {
    let name = op.attribute("name").unwrap_or_default().to_string();
    let soap_op = soap_child(op, "operation").map(|(n, _)| n);
    let action = soap_op
        .and_then(|n| n.attribute("soapAction"))
        .unwrap_or_default()
        .to_string();
    let style = soap_op
        .and_then(|n| n.attribute("style"))
        .unwrap_or(default_style)
        .to_string();
    let input_body = child(op, WSDL, "input")
        .and_then(|i| soap_child(i, "body"))
        .map(|(n, _)| n);
    let only_parts: Option<Vec<&str>> = input_body
        .and_then(|b| b.attribute("parts"))
        .map(|p| p.split_whitespace().collect());

    let message = port_type
        .and_then(|pt| {
            children(pt, WSDL).find(|o| o.tag_name().name() == "operation" && o.attribute("name") == Some(&name))
        })
        .and_then(|o| child(o, WSDL, "input"))
        .and_then(|i| i.attribute("message").map(|m| qname(i, m)))
        .and_then(|q| idx.messages.get(&q).copied());
    if message.is_none() {
        warnings.push(format!("Operation {name}: input message not found"));
    }
    let parts: Vec<Node> = message
        .map(|m| {
            children(m, WSDL)
                .filter(|p| p.tag_name().name() == "part")
                .filter(|p| {
                    only_parts
                        .as_ref()
                        .is_none_or(|only| p.attribute("name").is_some_and(|n| only.contains(&n)))
                })
                .collect()
        })
        .unwrap_or_default();

    let mut g = Gen::new(idx);
    if style == "rpc" {
        let ns = input_body
            .and_then(|b| b.attribute("namespace"))
            .map(String::from)
            .unwrap_or_else(|| {
                binding
                    .ancestors()
                    .find(|a| is(*a, WSDL, "definitions"))
                    .and_then(|d| d.attribute("targetNamespace"))
                    .unwrap_or_default()
                    .to_string()
            });
        let wrapper = g.tag(&ns, &name, op);
        g.line(2, &format!("<{wrapper}>"));
        for part in parts {
            let pname = part.attribute("name").unwrap_or("part");
            if let Some(t) = part.attribute("type") {
                g.type_content(part, pname, t, 3);
            } else if let Some(el) = part
                .attribute("element")
                .and_then(|e| idx.elements.get(&qname(part, e)).copied())
            {
                g.element_body(el, 3, true);
            }
        }
        g.line(2, &format!("</{wrapper}>"));
    } else {
        for part in parts {
            if let Some(e) = part.attribute("element") {
                let q = qname(part, e);
                match idx.elements.get(&q).copied() {
                    Some(el) => g.element_body(el, 2, true),
                    None => warnings.push(format!("Operation {name}: element {} not found in schemas", q.1)),
                }
            } else if let Some(t) = part.attribute("type") {
                let pname = part.attribute("name").unwrap_or("part").to_string();
                g.type_content(part, &pname, t, 2);
            }
        }
    }
    WsdlOperation {
        name,
        action,
        style,
        envelope: g.envelope(soap12),
    }
}

pub fn inspect(source: &str, docs: &[SourceDoc]) -> AppResult<WsdlInfo> {
    let parsed = docs
        .iter()
        .map(|d| {
            Document::parse(&d.text)
                .map_err(|e| AppError::new(ErrorCode::Parse, format!("Invalid XML in {}", d.location)).with_details(e))
        })
        .collect::<AppResult<Vec<_>>>()?;
    let idx = Index::build(&parsed);
    let Some(definitions) = idx.definitions.first().copied() else {
        return Err(AppError::validation(
            "The document is not a WSDL 1.1 file (no wsdl:definitions)",
        ));
    };
    let mut warnings = Vec::new();
    let mut services = Vec::new();

    for (service_name, service) in &idx.services {
        let mut ports = Vec::new();
        for port in children(*service, WSDL).filter(|p| p.tag_name().name() == "port") {
            let Some((address, _)) = soap_child(port, "address") else {
                continue;
            };
            let Some(binding_q) = port.attribute("binding").map(|b| qname(port, b)) else {
                continue;
            };
            let Some(binding) = idx.bindings.get(&binding_q).copied() else {
                warnings.push(format!(
                    "Port {}: binding {} not found",
                    port.attribute("name").unwrap_or("?"),
                    binding_q.1
                ));
                continue;
            };
            let Some((soap_binding, soap12)) = soap_child(binding, "binding") else {
                continue;
            };
            let default_style = soap_binding.attribute("style").unwrap_or("document");
            let port_type = binding
                .attribute("type")
                .and_then(|t| idx.port_types.get(&qname(binding, t)).copied());
            let operations = children(binding, WSDL)
                .filter(|o| o.tag_name().name() == "operation")
                .map(|op| build_operation(&idx, binding, port_type, op, soap12, default_style, &mut warnings))
                .collect();
            ports.push(WsdlPort {
                name: port.attribute("name").unwrap_or_default().to_string(),
                binding: binding_q.1,
                soap_version: if soap12 { "1.2" } else { "1.1" }.into(),
                address: address.attribute("location").unwrap_or_default().to_string(),
                operations,
            });
        }
        if !ports.is_empty() {
            services.push(WsdlService {
                name: service_name.clone(),
                ports,
            });
        }
    }
    if services.is_empty() {
        return Err(AppError::validation("No SOAP 1.1/1.2 ports were found in the WSDL"));
    }
    Ok(WsdlInfo {
        source: source.to_string(),
        name: definitions
            .attribute("name")
            .map(String::from)
            .unwrap_or_else(|| services[0].name.clone()),
        target_namespace: definitions.attribute("targetNamespace").unwrap_or_default().to_string(),
        documents: docs.len(),
        services,
        warnings,
    })
}
