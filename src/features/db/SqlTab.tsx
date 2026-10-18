import { sql, MSSQL, MySQL, PostgreSQL, SQLite, type SQLDialect } from "@codemirror/lang-sql";
import type { EditorView } from "@codemirror/view";
import { AlertTriangle, Ban, Loader2, Play, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { CodeEditor } from "@/components/code/CodeEditor";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState, Kbd } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DbDriver } from "@/ipc/types";
import { formatMs } from "@/lib/format";
import { cancelSql, runSql, useDatabases } from "@/stores/databases";
import { ResultGrid } from "./ResultGrid";

const dialects: Record<DbDriver, SQLDialect> = {
  mssql: MSSQL,
  postgres: PostgreSQL,
  mysql: MySQL,
  sqlite: SQLite,
  cosmos: PostgreSQL,
};

export function SqlTab({ id }: { id: string }) {
  const tab = useDatabases((s) => s.sqlTabs[id]);
  const data = useDatabases((s) => s.data);
  const run = useDatabases((s) => s.runs[id]);
  const schemas = useDatabases((s) => s.schemas);
  const update = useDatabases((s) => s.updateSqlTab);
  const viewRef = useRef<EditorView | null>(null);
  const [pendingSql, setPendingSql] = useState<{ sql: string; reason: string } | null>(null);

  const profile = data?.profiles.find((p) => p.id === tab?.profileId);
  const schema = profile ? schemas[profile.id] : undefined;
  const extensions = useMemo(() => {
    if (!profile) return [sql()];
    const tables: Record<string, string[]> = {};
    if (schema?.status === "done") for (const t of schema.tables) tables[t.name] = t.columns.map((c) => c.name);
    return [sql({ dialect: dialects[profile.driver], schema: tables, upperCaseKeywords: true })];
  }, [profile, schema]);

  if (!tab) return <EmptyState title="Query tab not found" />;

  const execute = async () => {
    const view = viewRef.current;
    const selection = view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : "";
    const text = selection.trim() ? selection : tab.sql;
    const outcome = await runSql(id, text);
    if (outcome.status === "confirm") setPendingSql({ sql: text, reason: outcome.reason });
  };

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          execute();
        } else if (e.key === "Escape" && run?.status === "loading") {
          cancelSql(id);
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b p-2">
        <NativeSelect value={tab.profileId ?? ""} onChange={(e) => update(id, { profileId: e.target.value || null })} className="w-64" aria-label="Connection">
          <option value="">Select connection…</option>
          {data?.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.protected ? " (protected)" : ""}
            </option>
          ))}
        </NativeSelect>
        {run?.status === "loading" ? (
          <Button variant="secondary" onClick={() => cancelSql(id)}>
            <Square /> Stop
          </Button>
        ) : (
          <Button onClick={execute} disabled={!tab.profileId}>
            <Play /> Run
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          <Kbd>Ctrl+Enter</Kbd> runs the selection or the whole script
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Row limit
          <Input
            type="number"
            min={1}
            max={100000}
            value={tab.maxRows}
            onChange={(e) => update(id, { maxRows: Math.max(1, Math.min(100000, Number(e.target.value) || 1)) })}
            className="h-7 w-24"
          />
        </label>
      </div>
      <PanelGroup direction="vertical" autoSaveId="api-pulse:layout-sql">
        <Panel id="editor" order={1} defaultSize={40} minSize={15}>
          <CodeEditor
            value={tab.sql}
            onChange={(value) => update(id, { sql: value })}
            extensions={extensions}
            onView={(v) => {
              viewRef.current = v;
            }}
            placeholder={profile ? `-- ${profile.name}` : "-- choose a connection"}
          />
        </Panel>
        <PanelResizeHandle className="z-10 -my-0.5 h-1 border-t transition-colors hover:bg-ring/40 data-[resize-handle-state=drag]:bg-ring/60" />
        <Panel id="results" order={2} minSize={15}>
          <Results tabId={id} />
        </Panel>
      </PanelGroup>
      <ConfirmDialog
        open={pendingSql !== null}
        onOpenChange={(o) => !o && setPendingSql(null)}
        title="Run a destructive statement?"
        description={`The script contains: ${pendingSql?.reason ?? ""}. Run it anyway?`}
        confirmLabel="Run anyway"
        onConfirm={async () => {
          if (pendingSql) await runSql(id, pendingSql.sql, true);
        }}
      />
    </div>
  );
}

function Results({ tabId }: { tabId: string }) {
  const run = useDatabases((s) => s.runs[tabId]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (run?.status !== "loading") return;
    const t = setInterval(() => setElapsed(performance.now() - run.startedAt), 100);
    return () => clearInterval(t);
  }, [run]);

  if (!run) return <EmptyState title="Run a query to see results" />;
  if (run.status === "loading") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span className="font-mono text-xs">{formatMs(elapsed)}</span>
      </div>
    );
  }
  if (run.status === "cancelled") return <EmptyState icon={<Ban />} title="Query cancelled" />;
  if (run.status === "error") {
    return (
      <div className="p-3">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" /> {run.error.message}
          </div>
          {run.error.details && <pre className="mt-2 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground select-text">{run.error.details}</pre>}
        </div>
      </div>
    );
  }

  const sets = run.result.results.filter((r) => r.columns.length > 0);
  const messages = run.result.results
    .filter((r) => r.columns.length === 0)
    .map((r) => `${r.rowsAffected ?? 0} row(s) affected`);
  return (
    <Tabs key={run.result.elapsedMs} defaultValue={sets.length ? "0" : "messages"} className="flex h-full flex-col">
      <TabsList>
        {sets.map((_, i) => (
          <TabsTrigger key={i} value={String(i)}>
            Result {i + 1}
          </TabsTrigger>
        ))}
        <TabsTrigger value="messages">Messages</TabsTrigger>
        <span className="mb-1.5 ml-auto self-center text-xs text-muted-foreground">{formatMs(run.result.elapsedMs)}</span>
      </TabsList>
      {sets.map((r, i) => (
        <TabsContent key={i} value={String(i)} className="overflow-hidden">
          <ResultGrid result={r} />
        </TabsContent>
      ))}
      <TabsContent value="messages" className="p-3 font-mono text-xs">
        {messages.length === 0 ? <div className="text-muted-foreground">Query completed in {formatMs(run.result.elapsedMs)}</div> : messages.map((m, i) => <div key={i}>{m}</div>)}
      </TabsContent>
    </Tabs>
  );
}
