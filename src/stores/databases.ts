import { toast } from "sonner";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, errorText, toAppError } from "@/ipc/commands";
import type { AppError, DbDriver, DbProfile, DbProfiles, ExecResult, SchemaTable } from "@/ipc/types";
import { activeEnvironmentId } from "./environments";
import { useTabs } from "./tabs";
import { useWorkspace } from "./workspace";

export interface SqlTabState {
  profileId: string | null;
  sql: string;
  title: string;
  maxRows: number;
}

export type SqlRun =
  | { status: "loading"; execId: string; startedAt: number }
  | { status: "done"; result: ExecResult }
  | { status: "error"; error: AppError }
  | { status: "cancelled" };

type SchemaState = { status: "loading" } | { status: "done"; tables: SchemaTable[] } | { status: "error"; error: string };

interface DatabasesState {
  data: DbProfiles | null;
  sqlTabs: Record<string, SqlTabState>;
  runs: Record<string, SqlRun>;
  schemas: Record<string, SchemaState>;
  setData: (data: DbProfiles) => void;
  updateSqlTab: (id: string, patch: Partial<SqlTabState>) => void;
  setRun: (id: string, run: SqlRun) => void;
  setSchema: (profileId: string, schema: SchemaState) => void;
  reset: () => void;
}

export const useDatabases = create<DatabasesState>()(
  persist(
    (set, get) => ({
      data: null,
      sqlTabs: {},
      runs: {},
      schemas: {},
      setData: (data) => set({ data }),
      updateSqlTab: (id, patch) => {
        const current = get().sqlTabs[id] ?? { profileId: null, sql: "", title: "Query", maxRows: 1000 };
        set({ sqlTabs: { ...get().sqlTabs, [id]: { ...current, ...patch } } });
      },
      setRun: (id, run) => set({ runs: { ...get().runs, [id]: run } }),
      setSchema: (profileId, schema) => set({ schemas: { ...get().schemas, [profileId]: schema } }),
      reset: () => set({ data: null, runs: {}, schemas: {} }),
    }),
    {
      name: "api-pulse:databases",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ sqlTabs }) => ({ sqlTabs }),
    },
  ),
);

export const driverLabels: Record<DbDriver, string> = {
  mssql: "MS SQL Server",
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite",
  cosmos: "Azure Cosmos DB",
};

function envId() {
  return activeEnvironmentId(useWorkspace.getState().tree?.id);
}

async function apply(action: () => Promise<DbProfiles>): Promise<boolean> {
  try {
    useDatabases.getState().setData(await action());
    return true;
  } catch (e) {
    toast.error(errorText(e));
    return false;
  }
}

export const loadProfiles = () => apply(api.dbProfilesList);

export async function createProfile(name: string, driver: DbDriver): Promise<string | undefined> {
  try {
    const created = await api.dbProfileCreate(name, driver);
    useDatabases.getState().setData(created.profiles);
    return created.id;
  } catch (e) {
    toast.error(errorText(e));
    return undefined;
  }
}

export const saveProfile = (profile: DbProfile, password: string | null) => apply(() => api.dbProfileSave(profile, password));

export async function deleteProfile(id: string) {
  if (await apply(() => api.dbProfileDelete(id))) {
    const tabs = useTabs.getState();
    tabs.forceClose(tabs.tabs.filter((t) => t.id === id).map((t) => t.id));
  }
}

export async function testProfile(profile: DbProfile, password: string | null) {
  return api.dbTest(profile, password, envId());
}

export function openSqlTab(profileId: string | null, sql = "", title?: string) {
  const id = `sql-${crypto.randomUUID()}`;
  const profile = useDatabases.getState().data?.profiles.find((p) => p.id === profileId);
  useDatabases.getState().updateSqlTab(id, { profileId, sql, title: title ?? (profile ? profile.name : "Query"), maxRows: 1000 });
  useTabs.getState().open(id, "sql", false);
  return id;
}

export type RunOutcome = { status: "ok" | "error" } | { status: "confirm"; reason: string };

export async function runSql(tabId: string, sql: string, allowDestructive = false): Promise<RunOutcome> {
  const tab = useDatabases.getState().sqlTabs[tabId];
  if (!tab?.profileId || !sql.trim()) return { status: "error" };
  const { setRun } = useDatabases.getState();
  const execId = crypto.randomUUID();
  setRun(tabId, { status: "loading", execId, startedAt: performance.now() });
  try {
    const result = await api.dbExecute(execId, tab.profileId, sql, envId(), tab.maxRows, allowDestructive);
    setRun(tabId, { status: "done", result });
    return { status: "ok" };
  } catch (e) {
    const error = toAppError(e);
    if (error.code === "CONFIRM") {
      setRun(tabId, { status: "cancelled" });
      return { status: "confirm", reason: error.message };
    }
    setRun(tabId, error.code === "CANCELLED" ? { status: "cancelled" } : { status: "error", error });
    return { status: "error" };
  }
}

export async function cancelSql(tabId: string) {
  const run = useDatabases.getState().runs[tabId];
  if (run?.status === "loading") await api.requestCancel(run.execId);
}

export async function loadSchema(profileId: string) {
  const { setSchema } = useDatabases.getState();
  setSchema(profileId, { status: "loading" });
  try {
    setSchema(profileId, { status: "done", tables: await api.dbSchema(profileId, envId()) });
  } catch (e) {
    setSchema(profileId, { status: "error", error: errorText(e) });
  }
}

export function quoteIdent(driver: DbDriver, name: string): string {
  if (driver === "mssql") return `[${name.replace(/]/g, "]]")}]`;
  if (driver === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function selectTopSql(driver: DbDriver, schema: string, table: string, n = 100): string {
  const name = driver === "sqlite" ? quoteIdent(driver, table) : `${quoteIdent(driver, schema)}.${quoteIdent(driver, table)}`;
  return driver === "mssql" ? `SELECT TOP ${n} * FROM ${name};` : `SELECT * FROM ${name} LIMIT ${n};`;
}
