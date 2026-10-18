export type ErrorCode =
  | "IO"
  | "PARSE"
  | "VALIDATION"
  | "NOT_FOUND"
  | "HTTP"
  | "TIMEOUT"
  | "CANCELLED"
  | "SECRET"
  | "DB"
  | "CONFIRM"
  | "INTERNAL";

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: string;
}

export type RequestKind = "http" | "soap";
export type NodeKind = "collection" | "folder" | "request";

export interface TreeNode {
  id: string;
  kind: NodeKind;
  name: string;
  order: number;
  method?: string;
  requestType?: RequestKind;
  children: TreeNode[];
}

export interface Problem {
  path: string;
  message: string;
}

export interface WorkspaceTree {
  id: string;
  name: string;
  root: string;
  collections: TreeNode[];
  problems: Problem[];
}

export interface Created {
  id: string;
  tree: WorkspaceTree;
}

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export type Auth =
  | { type: "inherit" }
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string }
  | { type: "apiKey"; key: string; value: string; in: "header" | "query" };

export interface MultipartField {
  key: string;
  kind: "text" | "file";
  value?: string;
  filePath?: string;
  contentType?: string;
  enabled: boolean;
}

export type Body =
  | { type: "none" }
  | { type: "json"; raw: string }
  | { type: "xml"; raw: string }
  | { type: "text"; raw: string }
  | { type: "formUrlEncoded"; fields: KeyValue[] }
  | { type: "multipart"; fields: MultipartField[] }
  | { type: "binary"; filePath: string };

export interface RequestSettings {
  timeoutMs: number | null;
  followRedirects: boolean | null;
  verifyTls: boolean | null;
}

export interface SoapConfig {
  version: "1.1" | "1.2";
  action: string;
  operation?: string;
  wsdl?: unknown;
  namespaces?: Record<string, string>;
}

export interface RequestDef {
  id: string;
  type: RequestKind;
  name: string;
  order: number;
  method?: string;
  url: string;
  soap?: SoapConfig;
  params: { query: KeyValue[]; path: KeyValue[] };
  headers: KeyValue[];
  auth: Auth;
  body?: Body;
  envelope?: string;
  settings: RequestSettings;
  extract: unknown[];
  dbChecks: unknown[];
  assertions: unknown[];
  [extra: string]: unknown;
}

export interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
  type?: "default" | "secret";
  secretRef?: string;
  description?: string;
}

export interface Environment {
  schemaVersion: number;
  id: string;
  name: string;
  color?: string;
  variables: EnvVar[];
  [extra: string]: unknown;
}

export interface Environments {
  globals: Environment;
  environments: Environment[];
  problems: Problem[];
}

export interface ScopeVar {
  key: string;
  value: unknown;
  source: string;
  secret: boolean;
}

export type PreparedBody =
  | { kind: "text"; text: string }
  | { kind: "form"; fields: [string, string][] }
  | { kind: "multipart"; parts: { name: string; value?: string; filePath?: string; contentType?: string }[] }
  | { kind: "file"; path: string };

export interface PreparedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: PreparedBody;
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  httpOnly: boolean;
  secure: boolean;
}

export type ResponseBody =
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "binary"; base64: string; truncated: boolean };

export interface HttpResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  url: string;
  remoteAddr?: string;
  headers: [string, string][];
  cookies: Cookie[];
  contentType?: string;
  body: ResponseBody;
  size: { headers: number; body: number };
  timings: { ttfbMs: number; downloadMs: number; totalMs: number };
}

export interface SendResult {
  request: PreparedRequest;
  response: HttpResponse;
  warnings: string[];
}

export interface ContainerMeta {
  schemaVersion?: number;
  id: string;
  name: string;
  description?: string;
  order: number;
  variables?: KeyValue[];
  auth: Auth;
  headers?: KeyValue[];
  [extra: string]: unknown;
}

export interface HistoryEntry {
  id: string;
  ts: string;
  requestId?: string;
  name: string;
  method: string;
  url: string;
  status?: number;
  totalMs?: number;
  error?: string;
}

export interface HistorySnapshot {
  entry: HistoryEntry;
  request: RequestDef;
  prepared: PreparedRequest;
  response: HttpResponse | null;
  error: AppError | null;
  warnings: string[];
}

export interface WsdlOperation {
  name: string;
  action: string;
  style: string;
  envelope: string;
}

export interface WsdlPort {
  name: string;
  binding: string;
  soapVersion: "1.1" | "1.2";
  address: string;
  operations: WsdlOperation[];
}

export interface WsdlInfo {
  source: string;
  name: string;
  targetNamespace: string;
  documents: number;
  services: { name: string; ports: WsdlPort[] }[];
  warnings: string[];
}

export type DbDriver = "mssql" | "postgres" | "mysql" | "sqlite" | "cosmos";

export interface DbProfile {
  schemaVersion: number;
  id: string;
  name: string;
  driver: DbDriver;
  host?: string;
  port?: number | null;
  instance?: string | null;
  database?: string;
  file?: string | null;
  auth: "sql" | "windows";
  username?: string;
  passwordMode: "keychain" | "variable" | "none";
  passwordVariable?: string | null;
  secretRef?: string | null;
  tls: { mode: "disable" | "prefer" | "require"; trustServerCertificate: boolean };
  protected: boolean;
  connectTimeoutMs?: number | null;
  statementTimeoutMs?: number | null;
  [extra: string]: unknown;
}

export interface DbProfiles {
  profiles: DbProfile[];
  problems: Problem[];
}

export interface QueryResult {
  columns: { name: string; dbType: string }[];
  rows: unknown[][];
  rowsAffected?: number;
  truncated: boolean;
}

export interface ExecResult {
  results: QueryResult[];
  elapsedMs: number;
}

export interface SchemaTable {
  schema: string;
  name: string;
  kind: "table" | "view";
  columns: { name: string; dataType: string; nullable: boolean }[];
}
