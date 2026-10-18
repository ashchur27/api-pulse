use super::fsutil::{read_yaml, slugify, unique_path, write_atomic, write_yaml};
use crate::error::{AppError, AppResult};
use crate::model::{new_id, ContainerMeta, RequestDef, RequestKind, WorkspaceDefaults, WorkspaceMeta, SCHEMA_VERSION};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

pub const WORKSPACE_FILE: &str = "apipulse.workspace.yaml";
pub const COLLECTION_FILE: &str = "_collection.yaml";
pub const FOLDER_FILE: &str = "_folder.yaml";
pub const REQUEST_SUFFIX: &str = ".req.yaml";
const COLLECTIONS_DIR: &str = "collections";
const WORKSPACE_DIRS: &[&str] = &["collections", "environments", "databases", "scenarios", ".apipulse"];

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    Collection,
    Folder,
    Request,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    pub order: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_type: Option<RequestKind>,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    pub id: String,
    pub name: String,
    pub root: String,
    pub collections: Vec<TreeNode>,
    pub problems: Vec<Problem>,
}

#[derive(Debug, Clone)]
struct NodeLoc {
    kind: NodeKind,
    path: PathBuf,
    parent: Option<String>,
    order: i64,
}

pub struct Workspace {
    root: PathBuf,
    meta: WorkspaceMeta,
    index: HashMap<String, NodeLoc>,
}

impl Workspace {
    pub fn create(root: &Path, name: &str) -> AppResult<Self> {
        let name = validate_name(name)?;
        if !root.is_dir() {
            return Err(AppError::validation("Folder does not exist"));
        }
        if root.join(WORKSPACE_FILE).exists() {
            return Err(AppError::validation(
                "This folder already contains an API-Pulse workspace",
            ));
        }
        for dir in WORKSPACE_DIRS {
            fs::create_dir_all(root.join(dir))?;
        }
        write_atomic(&root.join(".apipulse").join(".gitignore"), b"*\n")?;
        let meta = WorkspaceMeta {
            schema_version: SCHEMA_VERSION,
            id: new_id(),
            name,
            defaults: WorkspaceDefaults::default(),
            extra: BTreeMap::new(),
        };
        write_yaml(&root.join(WORKSPACE_FILE), &meta)?;
        Self::open(root)
    }

    pub fn open(root: &Path) -> AppResult<Self> {
        let file = root.join(WORKSPACE_FILE);
        if !file.is_file() {
            return Err(AppError::not_found("This folder is not an API-Pulse workspace"));
        }
        let meta: WorkspaceMeta = read_yaml(&file)?;
        if meta.schema_version > SCHEMA_VERSION {
            return Err(AppError::validation(
                "This workspace was created by a newer version of API-Pulse",
            ));
        }
        Ok(Self {
            root: root.to_path_buf(),
            meta,
            index: HashMap::new(),
        })
    }

    pub fn tree(&mut self) -> AppResult<WorkspaceTree> {
        self.index.clear();
        let mut problems = Vec::new();
        let collections_dir = self.root.join(COLLECTIONS_DIR);
        fs::create_dir_all(&collections_dir)?;
        let mut collections = Vec::new();
        for dir in sorted_entries(&collections_dir)? {
            if !dir.is_dir() {
                continue;
            }
            if !dir.join(COLLECTION_FILE).is_file() {
                problems.push(self.problem(&dir, format!("Missing {COLLECTION_FILE}")));
                continue;
            }
            if let Some(node) = self.scan_container(&dir, COLLECTION_FILE, NodeKind::Collection, None, &mut problems) {
                collections.push(node);
            }
        }
        sort_nodes(&mut collections);
        Ok(WorkspaceTree {
            id: self.meta.id.clone(),
            name: self.meta.name.clone(),
            root: self.root.display().to_string(),
            collections,
            problems,
        })
    }

    fn scan_container(
        &mut self,
        dir: &Path,
        meta_file: &str,
        kind: NodeKind,
        parent: Option<&str>,
        problems: &mut Vec<Problem>,
    ) -> Option<TreeNode> {
        let meta: ContainerMeta = match read_yaml(&dir.join(meta_file)) {
            Ok(m) => m,
            Err(e) => {
                problems.push(self.problem(dir, error_text(&e)));
                return None;
            }
        };
        if self.index.contains_key(&meta.id) {
            problems.push(self.problem(dir, format!("Duplicate id {}", meta.id)));
            return None;
        }
        self.index.insert(
            meta.id.clone(),
            NodeLoc {
                kind,
                path: dir.to_path_buf(),
                parent: parent.map(String::from),
                order: meta.order,
            },
        );

        let entries = match sorted_entries(dir) {
            Ok(e) => e,
            Err(e) => {
                problems.push(self.problem(dir, error_text(&e)));
                Vec::new()
            }
        };
        let mut children = Vec::new();
        for path in entries {
            if path.is_dir() {
                if path.join(FOLDER_FILE).is_file() {
                    if let Some(node) =
                        self.scan_container(&path, FOLDER_FILE, NodeKind::Folder, Some(&meta.id), problems)
                    {
                        children.push(node);
                    }
                }
            } else if is_request_file(&path) {
                match read_yaml::<RequestDef>(&path) {
                    Ok(req) if self.index.contains_key(&req.id) => {
                        problems.push(self.problem(&path, format!("Duplicate id {}", req.id)));
                    }
                    Ok(req) => {
                        self.index.insert(
                            req.id.clone(),
                            NodeLoc {
                                kind: NodeKind::Request,
                                path: path.clone(),
                                parent: Some(meta.id.clone()),
                                order: req.order,
                            },
                        );
                        children.push(TreeNode {
                            id: req.id,
                            kind: NodeKind::Request,
                            name: req.name,
                            order: req.order,
                            method: req.method,
                            request_type: Some(req.kind),
                            children: Vec::new(),
                        });
                    }
                    Err(e) => problems.push(self.problem(&path, error_text(&e))),
                }
            }
        }
        sort_nodes(&mut children);
        Some(TreeNode {
            id: meta.id,
            kind,
            name: meta.name,
            order: meta.order,
            method: None,
            request_type: None,
            children,
        })
    }

    pub fn create_collection(&mut self, name: &str) -> AppResult<String> {
        let name = validate_name(name)?;
        let parent_dir = self.root.join(COLLECTIONS_DIR);
        fs::create_dir_all(&parent_dir)?;
        let dir = unique_path(&parent_dir, &slugify(&name), "");
        fs::create_dir(&dir)?;
        let meta = ContainerMeta::new(name, self.next_order(None), true);
        write_yaml(&dir.join(COLLECTION_FILE), &meta)?;
        Ok(meta.id)
    }

    pub fn import_collection(
        &mut self,
        name: &str,
        groups: Vec<(Option<String>, Vec<RequestDef>)>,
    ) -> AppResult<String> {
        let name = validate_name(name)?;
        let parent_dir = self.root.join(COLLECTIONS_DIR);
        fs::create_dir_all(&parent_dir)?;
        let dir = unique_path(&parent_dir, &slugify(&name), "");
        fs::create_dir(&dir)?;
        let meta = ContainerMeta::new(name, self.next_order(None), true);
        write_yaml(&dir.join(COLLECTION_FILE), &meta)?;
        for (index, (folder, requests)) in groups.into_iter().enumerate() {
            let target = match folder {
                Some(folder_name) => {
                    let folder_name = validate_name(&folder_name)?;
                    let folder_dir = unique_path(&dir, &slugify(&folder_name), "");
                    fs::create_dir(&folder_dir)?;
                    write_yaml(
                        &folder_dir.join(FOLDER_FILE),
                        &ContainerMeta::new(folder_name, index as i64, false),
                    )?;
                    folder_dir
                }
                None => dir.clone(),
            };
            for (order, mut req) in requests.into_iter().enumerate() {
                req.order = order as i64;
                write_yaml(&unique_path(&target, &slugify(&req.name), REQUEST_SUFFIX), &req)?;
            }
        }
        Ok(meta.id)
    }

    pub fn create_folder(&mut self, parent_id: &str, name: &str) -> AppResult<String> {
        let name = validate_name(name)?;
        let parent_dir = self.container_dir(parent_id)?;
        let dir = unique_path(&parent_dir, &slugify(&name), "");
        fs::create_dir(&dir)?;
        let meta = ContainerMeta::new(name, self.next_order(Some(parent_id)), false);
        write_yaml(&dir.join(FOLDER_FILE), &meta)?;
        Ok(meta.id)
    }

    pub fn create_request(&mut self, parent_id: &str, name: &str, kind: RequestKind) -> AppResult<String> {
        let name = validate_name(name)?;
        let parent_dir = self.container_dir(parent_id)?;
        let path = unique_path(&parent_dir, &slugify(&name), REQUEST_SUFFIX);
        let req = RequestDef::new(name, kind, self.next_order(Some(parent_id)));
        write_yaml(&path, &req)?;
        Ok(req.id)
    }

    pub fn get_request(&self, id: &str) -> AppResult<RequestDef> {
        read_yaml(&self.request_path(id)?)
    }

    pub fn save_request(&mut self, req: &RequestDef) -> AppResult<()> {
        validate_name(&req.name)?;
        let path = self.request_path(&req.id)?;
        write_yaml(&path, req)
    }

    fn container_file(&self, id: &str) -> AppResult<PathBuf> {
        let loc = self.loc(id)?;
        match loc.kind {
            NodeKind::Collection => Ok(loc.path.join(COLLECTION_FILE)),
            NodeKind::Folder => Ok(loc.path.join(FOLDER_FILE)),
            NodeKind::Request => Err(AppError::validation("Item is not a collection or folder")),
        }
    }

    pub fn get_container(&self, id: &str) -> AppResult<ContainerMeta> {
        read_yaml(&self.container_file(id)?)
    }

    pub fn save_container(&mut self, meta: &ContainerMeta) -> AppResult<()> {
        validate_name(&meta.name)?;
        let path = self.container_file(&meta.id)?;
        let mut meta = meta.clone();
        if self.loc(&meta.id)?.kind == NodeKind::Folder {
            meta.schema_version = None;
        }
        write_yaml(&path, &meta)
    }

    pub fn duplicate_request(&mut self, id: &str) -> AppResult<String> {
        let loc = self.loc(id)?.clone();
        if loc.kind != NodeKind::Request {
            return Err(AppError::validation("Only requests can be duplicated"));
        }
        let mut copy: RequestDef = read_yaml(&loc.path)?;
        copy.id = new_id();
        copy.name = format!("{} copy", copy.name);
        copy.order = self.next_order(loc.parent.as_deref());
        let dir = loc
            .path
            .parent()
            .ok_or_else(|| AppError::internal("Request has no parent folder"))?;
        let path = unique_path(dir, &slugify(&copy.name), REQUEST_SUFFIX);
        write_yaml(&path, &copy)?;
        Ok(copy.id)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> AppResult<()> {
        let name = validate_name(name)?;
        let loc = self.loc(id)?.clone();
        let parent_dir = loc
            .path
            .parent()
            .ok_or_else(|| AppError::internal("Node has no parent folder"))?;
        let slug = slugify(&name);
        match loc.kind {
            NodeKind::Request => {
                let mut req: RequestDef = read_yaml(&loc.path)?;
                req.name = name;
                let current_stem = request_stem(&loc.path);
                let target = if current_stem.eq_ignore_ascii_case(&slug) {
                    loc.path.clone()
                } else {
                    unique_path(parent_dir, &slug, REQUEST_SUFFIX)
                };
                write_yaml(&target, &req)?;
                if target != loc.path {
                    fs::remove_file(&loc.path)?;
                }
            }
            NodeKind::Collection | NodeKind::Folder => {
                let meta_file = if loc.kind == NodeKind::Collection {
                    COLLECTION_FILE
                } else {
                    FOLDER_FILE
                };
                let mut meta: ContainerMeta = read_yaml(&loc.path.join(meta_file))?;
                meta.name = name;
                write_yaml(&loc.path.join(meta_file), &meta)?;
                let current = loc.path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
                if !current.eq_ignore_ascii_case(&slug) {
                    fs::rename(&loc.path, unique_path(parent_dir, &slug, ""))?;
                }
            }
        }
        Ok(())
    }

    pub fn delete(&mut self, id: &str) -> AppResult<()> {
        let loc = self.loc(id)?.clone();
        match loc.kind {
            NodeKind::Request => fs::remove_file(&loc.path)?,
            NodeKind::Collection | NodeKind::Folder => fs::remove_dir_all(&loc.path)?,
        }
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn id(&self) -> &str {
        &self.meta.id
    }

    pub fn defaults(&self) -> &WorkspaceDefaults {
        &self.meta.defaults
    }

    pub fn ancestors(&self, id: &str) -> Vec<ContainerMeta> {
        let mut result = Vec::new();
        let mut current = self.index.get(id).and_then(|l| l.parent.clone());
        while let Some(parent_id) = current {
            let Some(loc) = self.index.get(&parent_id) else { break };
            let file = if loc.kind == NodeKind::Collection {
                COLLECTION_FILE
            } else {
                FOLDER_FILE
            };
            if let Ok(meta) = read_yaml::<ContainerMeta>(&loc.path.join(file)) {
                result.push(meta);
            }
            current = loc.parent.clone();
        }
        result
    }

    fn loc(&self, id: &str) -> AppResult<&NodeLoc> {
        self.index
            .get(id)
            .ok_or_else(|| AppError::not_found(format!("Item {id} not found")))
    }

    fn container_dir(&self, id: &str) -> AppResult<PathBuf> {
        let loc = self.loc(id)?;
        match loc.kind {
            NodeKind::Collection | NodeKind::Folder => Ok(loc.path.clone()),
            NodeKind::Request => Err(AppError::validation("Target must be a collection or folder")),
        }
    }

    fn request_path(&self, id: &str) -> AppResult<PathBuf> {
        let loc = self.loc(id)?;
        match loc.kind {
            NodeKind::Request => Ok(loc.path.clone()),
            _ => Err(AppError::validation("Item is not a request")),
        }
    }

    fn next_order(&self, parent: Option<&str>) -> i64 {
        self.index
            .values()
            .filter(|l| l.parent.as_deref() == parent)
            .map(|l| l.order + 1)
            .max()
            .unwrap_or(0)
    }

    fn problem(&self, path: &Path, message: impl Into<String>) -> Problem {
        Problem {
            path: path.strip_prefix(&self.root).unwrap_or(path).display().to_string(),
            message: message.into(),
        }
    }
}

fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Name must not be empty"));
    }
    if name.chars().count() > 200 {
        return Err(AppError::validation("Name is too long (max 200 characters)"));
    }
    Ok(name.to_string())
}

fn error_text(e: &AppError) -> String {
    match &e.details {
        Some(d) => format!("{}: {d}", e.message),
        None => e.message.clone(),
    }
}

fn sorted_entries(dir: &Path) -> AppResult<Vec<PathBuf>> {
    let mut paths: Vec<PathBuf> = fs::read_dir(dir)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    Ok(paths)
}

fn is_request_file(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.ends_with(REQUEST_SUFFIX))
}

fn request_stem(path: &Path) -> String {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    name.strip_suffix(REQUEST_SUFFIX).unwrap_or(name).to_string()
}

fn sort_nodes(nodes: &mut [TreeNode]) {
    nodes.sort_by(|a, b| {
        a.order
            .cmp(&b.order)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Body;

    fn new_ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let mut ws = Workspace::create(dir.path(), "Test").unwrap();
        ws.tree().unwrap();
        (dir, ws)
    }

    #[test]
    fn create_workspace_layout() {
        let (dir, _) = new_ws();
        for d in WORKSPACE_DIRS {
            assert!(dir.path().join(d).is_dir(), "{d} missing");
        }
        assert_eq!(
            fs::read_to_string(dir.path().join(".apipulse/.gitignore")).unwrap(),
            "*\n"
        );
        assert!(Workspace::create(dir.path(), "Again").is_err());
    }

    #[test]
    fn open_rejects_non_workspace() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Workspace::open(dir.path()).is_err());
    }

    #[test]
    fn crud_tree() {
        let (dir, mut ws) = new_ws();
        let col = ws.create_collection("Users API").unwrap();
        ws.tree().unwrap();
        let folder = ws.create_folder(&col, "Users").unwrap();
        ws.tree().unwrap();
        let r1 = ws.create_request(&folder, "List users", RequestKind::Http).unwrap();
        ws.tree().unwrap();
        let r2 = ws.create_request(&folder, "Get invoice", RequestKind::Soap).unwrap();
        let tree = ws.tree().unwrap();

        assert!(dir.path().join("collections/users-api/_collection.yaml").is_file());
        assert!(dir
            .path()
            .join("collections/users-api/users/list-users.req.yaml")
            .is_file());
        let users = &tree.collections[0].children[0];
        assert_eq!(users.children.len(), 2);
        assert_eq!(users.children[0].id, r1);
        assert_eq!(users.children[0].order, 0);
        assert_eq!(users.children[1].id, r2);
        assert_eq!(users.children[1].request_type, Some(RequestKind::Soap));

        ws.rename(&r1, "List all users").unwrap();
        ws.tree().unwrap();
        assert!(dir
            .path()
            .join("collections/users-api/users/list-all-users.req.yaml")
            .is_file());
        assert!(!dir
            .path()
            .join("collections/users-api/users/list-users.req.yaml")
            .exists());
        assert_eq!(ws.get_request(&r1).unwrap().name, "List all users");

        ws.rename(&folder, "People").unwrap();
        let tree = ws.tree().unwrap();
        assert!(dir.path().join("collections/users-api/people/_folder.yaml").is_file());
        assert_eq!(tree.collections[0].children[0].name, "People");

        let copy = ws.duplicate_request(&r1).unwrap();
        ws.tree().unwrap();
        assert_eq!(ws.get_request(&copy).unwrap().name, "List all users copy");

        ws.delete(&folder).unwrap();
        let tree = ws.tree().unwrap();
        assert!(tree.collections[0].children.is_empty());
    }

    #[test]
    fn save_round_trip_is_stable() {
        let (_dir, mut ws) = new_ws();
        let col = ws.create_collection("C").unwrap();
        ws.tree().unwrap();
        let id = ws.create_request(&col, "Create user", RequestKind::Http).unwrap();
        ws.tree().unwrap();
        let mut req = ws.get_request(&id).unwrap();
        req.method = Some("POST".into());
        req.url = "{{baseUrl}}/users".into();
        req.body = Some(Body::Json {
            raw: "{\n  \"email\": \"a@b.c\"\n}\n".into(),
        });
        ws.save_request(&req).unwrap();

        let path = ws.request_path(&id).unwrap();
        let first = fs::read_to_string(&path).unwrap();
        let reread = ws.get_request(&id).unwrap();
        assert_eq!(reread, req);
        ws.save_request(&reread).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), first);
        assert!(
            first.contains("raw: |"),
            "multiline body should be a block scalar:\n{first}"
        );
    }

    #[test]
    fn unknown_fields_are_preserved() {
        let (_dir, mut ws) = new_ws();
        let col = ws.create_collection("C").unwrap();
        ws.tree().unwrap();
        let id = ws.create_request(&col, "R", RequestKind::Http).unwrap();
        ws.tree().unwrap();
        let path = ws.request_path(&id).unwrap();
        let text = fs::read_to_string(&path).unwrap() + "futureField:\n  a: 1\n";
        fs::write(&path, text).unwrap();
        let req = ws.get_request(&id).unwrap();
        ws.save_request(&req).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("futureField"));
    }

    #[test]
    fn broken_files_become_problems() {
        let (dir, mut ws) = new_ws();
        let col = ws.create_collection("C").unwrap();
        ws.tree().unwrap();
        ws.create_request(&col, "Ok", RequestKind::Http).unwrap();
        fs::write(dir.path().join("collections/c/broken.req.yaml"), "id: [").unwrap();
        let tree = ws.tree().unwrap();
        assert_eq!(tree.collections[0].children.len(), 1);
        assert_eq!(tree.problems.len(), 1);
        assert!(tree.problems[0].path.contains("broken.req.yaml"));
    }
}
