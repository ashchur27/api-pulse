import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  ContainerMeta,
  Created,
  DbDriver,
  DbProfile,
  DbProfiles,
  Environment,
  Environments,
  ExecResult,
  HistoryEntry,
  HistorySnapshot,
  RequestDef,
  RequestKind,
  ScopeVar,
  SchemaTable,
  SendResult,
  WorkspaceTree,
  WsdlInfo,
} from "./types";

export const api = {
  workspaceOpen: (path: string) => invoke<WorkspaceTree>("workspace_open", { path }),
  workspaceCreate: (path: string, name: string) => invoke<WorkspaceTree>("workspace_create", { path, name }),
  workspaceTree: () => invoke<WorkspaceTree>("workspace_tree"),
  collectionCreate: (name: string) => invoke<Created>("collection_create", { name }),
  folderCreate: (parentId: string, name: string) => invoke<Created>("folder_create", { parentId, name }),
  requestCreate: (parentId: string, name: string, kind: RequestKind) =>
    invoke<Created>("request_create", { parentId, name, kind }),
  requestGet: (id: string) => invoke<RequestDef>("request_get", { id }),
  requestSave: (request: RequestDef) => invoke<WorkspaceTree>("request_save", { request }),
  requestDuplicate: (id: string) => invoke<Created>("request_duplicate", { id }),
  nodeRename: (id: string, name: string) => invoke<WorkspaceTree>("node_rename", { id, name }),
  nodeDelete: (id: string) => invoke<WorkspaceTree>("node_delete", { id }),
  environmentsList: () => invoke<Environments>("environments_list"),
  environmentCreate: (name: string) => invoke<Environments>("environment_create", { name }),
  environmentSave: (environment: Environment) => invoke<Environments>("environment_save", { environment }),
  environmentDelete: (id: string) => invoke<Environments>("environment_delete", { id }),
  requestSend: (execId: string, request: RequestDef, environmentId: string | null) =>
    invoke<SendResult>("request_send", { execId, request, environmentId }),
  requestCancel: (execId: string) => invoke<void>("request_cancel", { execId }),
  variablesScope: (requestId: string | null, environmentId: string | null) =>
    invoke<ScopeVar[]>("variables_scope", { requestId, environmentId }),
  containerGet: (id: string) => invoke<ContainerMeta>("container_get", { id }),
  containerSave: (container: ContainerMeta) => invoke<WorkspaceTree>("container_save", { container }),
  historyList: (limit?: number) => invoke<HistoryEntry[]>("history_list", { limit }),
  historyGet: (id: string) => invoke<HistorySnapshot>("history_get", { id }),
  historyClear: () => invoke<void>("history_clear"),
  wsdlInspect: (source: string, environmentId: string | null, verifyTls: boolean) =>
    invoke<WsdlInfo>("wsdl_inspect", { source, environmentId, verifyTls }),
  wsdlImport: (source: string, environmentId: string | null, verifyTls: boolean) =>
    invoke<Created>("wsdl_import", { source, environmentId, verifyTls }),
  dbProfilesList: () => invoke<DbProfiles>("db_profiles_list"),
  dbProfileCreate: (name: string, driver: DbDriver) =>
    invoke<{ id: string; profiles: DbProfiles }>("db_profile_create", { name, driver }),
  dbProfileSave: (profile: DbProfile, password: string | null) => invoke<DbProfiles>("db_profile_save", { profile, password }),
  dbProfileDelete: (id: string) => invoke<DbProfiles>("db_profile_delete", { id }),
  dbTest: (profile: DbProfile, password: string | null, environmentId: string | null) =>
    invoke<{ version: string; latencyMs: number }>("db_test", { profile, password, environmentId }),
  dbExecute: (
    execId: string,
    profileId: string,
    sql: string,
    environmentId: string | null,
    maxRows: number,
    allowDestructive: boolean,
  ) => invoke<ExecResult>("db_execute", { execId, profileId, sql, environmentId, maxRows, allowDestructive }),
  dbSchema: (profileId: string, environmentId: string | null) => invoke<SchemaTable[]>("db_schema", { profileId, environmentId }),
};

export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "message" in e && "code" in e) return e as AppError;
  return { code: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
}

export function errorText(e: unknown): string {
  const err = toAppError(e);
  return err.details ? `${err.message}: ${err.details}` : err.message;
}
