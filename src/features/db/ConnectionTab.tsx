import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, ClipboardPaste, FolderOpen, Loader2, Lock, Plug, Save, Trash2, XCircle } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { errorText } from "@/ipc/commands";
import type { DbProfile } from "@/ipc/types";
import { parseConnectionString } from "@/lib/connstring";
import { cn } from "@/lib/utils";
import { deleteProfile, driverLabels, openSqlTab, saveProfile, testProfile, useDatabases } from "@/stores/databases";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[11rem_1fr] items-center gap-3">
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

type TestState = { status: "idle" } | { status: "running" } | { status: "ok"; text: string } | { status: "fail"; text: string };

export function ConnectionTab({ id }: { id: string }) {
  const source = useDatabases((s) => s.data?.profiles.find((p) => p.id === id));
  const [draft, setDraft] = useState<DbProfile | undefined>(source);
  const [password, setPassword] = useState("");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setDraft(source);
    setPassword("");
  }, [source]);

  const dirty = useMemo(() => password !== "" || JSON.stringify(draft) !== JSON.stringify(source), [draft, source, password]);
  if (!source || !draft) return <EmptyState title="Connection not found" />;

  const set = (patch: Partial<DbProfile>) => setDraft({ ...draft, ...patch });
  const isSqlite = draft.driver === "sqlite";
  const isMssql = draft.driver === "mssql";

  if (draft.driver === "cosmos") {
    return <EmptyState title="Azure Cosmos DB" description="Cosmos DB connections arrive in the next step of phase 3." />;
  }

  const save = async () => {
    if (await saveProfile(draft, password || null)) {
      setPassword("");
      toast.success("Connection saved");
    }
  };

  const runTest = async () => {
    setTest({ status: "running" });
    try {
      const info = await testProfile(draft, password || null);
      setTest({ status: "ok", text: `${info.version} · ${Math.round(info.latencyMs)} ms` });
    } catch (e) {
      setTest({ status: "fail", text: errorText(e) });
    }
  };

  const pasteConnectionString = async () => {
    const text = await navigator.clipboard.readText().catch(() => "");
    const parsed = parseConnectionString(text);
    if (!parsed) {
      toast.error("Clipboard does not contain a recognised connection string");
      return;
    }
    const { password: pw, tlsMode, trustServerCertificate, ...rest } = parsed;
    setDraft({
      ...draft,
      ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
      tls: { mode: tlsMode ?? draft.tls.mode, trustServerCertificate: trustServerCertificate ?? draft.tls.trustServerCertificate },
    });
    if (pw) {
      setPassword(pw);
      set({ passwordMode: "keychain" });
    }
    toast.success("Connection string applied — review and save");
  };

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          e.stopPropagation();
          if (dirty) save();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b p-2">
        <span className="font-medium">{source.name}</span>
        <span className="text-xs text-muted-foreground">{driverLabels[draft.driver]}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 /> Delete
        </Button>
        <Button variant="outline" size="sm" onClick={() => openSqlTab(id)}>
          New query
        </Button>
        <Button size="sm" disabled={!dirty} onClick={save}>
          <Save /> Save
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="max-w-3xl space-y-4 p-5">
          <Row label="Name">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </Row>
          {!isSqlite && (
            <Row label="Connection string" hint="ADO.NET, JDBC or URL">
              <div>
                <Button variant="outline" size="sm" onClick={pasteConnectionString}>
                  <ClipboardPaste /> Paste from clipboard
                </Button>
              </div>
            </Row>
          )}
          {isSqlite ? (
            <Row label="Database file">
              <div className="flex gap-2">
                <Input value={draft.file ?? ""} onChange={(e) => set({ file: e.target.value })} className="font-mono" />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const f = await open({ multiple: false, directory: false });
                    if (typeof f === "string") set({ file: f });
                  }}
                >
                  <FolderOpen /> Browse
                </Button>
              </div>
            </Row>
          ) : (
            <>
              <Row label="Host" hint="Variables allowed, e.g. {{dbHost}}">
                <div className="flex gap-2">
                  <Input value={draft.host ?? ""} onChange={(e) => set({ host: e.target.value })} className="font-mono" />
                  <Input
                    type="number"
                    value={draft.port ?? ""}
                    placeholder="port"
                    onChange={(e) => set({ port: e.target.value ? Number(e.target.value) : null })}
                    className="w-28"
                  />
                </div>
              </Row>
              {isMssql && (
                <Row label="Instance name" hint="Named instance (uses SQL Browser)">
                  <Input value={draft.instance ?? ""} onChange={(e) => set({ instance: e.target.value || null })} className="font-mono" />
                </Row>
              )}
              <Row label="Database">
                <Input value={draft.database ?? ""} onChange={(e) => set({ database: e.target.value })} className="font-mono" />
              </Row>
              {isMssql && (
                <Row label="Authentication">
                  <NativeSelect value={draft.auth} onChange={(e) => set({ auth: e.target.value as DbProfile["auth"] })} className="w-64">
                    <option value="sql">SQL Server login</option>
                    <option value="windows">Windows (integrated)</option>
                  </NativeSelect>
                </Row>
              )}
              {draft.auth !== "windows" && (
                <>
                  <Row label="Username">
                    <Input value={draft.username ?? ""} onChange={(e) => set({ username: e.target.value })} className="font-mono" />
                  </Row>
                  <Row label="Password">
                    <div className="flex gap-2">
                      <NativeSelect
                        value={draft.passwordMode}
                        onChange={(e) => set({ passwordMode: e.target.value as DbProfile["passwordMode"] })}
                        className="w-44"
                      >
                        <option value="keychain">OS keychain</option>
                        <option value="variable">From variable</option>
                        <option value="none">No password</option>
                      </NativeSelect>
                      {draft.passwordMode === "keychain" && (
                        <Input
                          type="password"
                          value={password}
                          placeholder={draft.secretRef ? "•••••• stored — type to replace" : "Password"}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      )}
                      {draft.passwordMode === "variable" && (
                        <Input
                          value={draft.passwordVariable ?? ""}
                          placeholder="{{dbPassword}}"
                          onChange={(e) => set({ passwordVariable: e.target.value })}
                          className="font-mono"
                        />
                      )}
                    </div>
                  </Row>
                </>
              )}
              <Row label={isMssql ? "Encryption" : "TLS"}>
                <div className="flex items-center gap-4">
                  <NativeSelect
                    value={draft.tls.mode}
                    onChange={(e) => set({ tls: { ...draft.tls, mode: e.target.value as DbProfile["tls"]["mode"] } })}
                    className="w-44"
                  >
                    <option value="disable">Disable</option>
                    <option value="prefer">Prefer</option>
                    <option value="require">Require</option>
                  </NativeSelect>
                  {isMssql && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.tls.trustServerCertificate}
                        onChange={(e) => set({ tls: { ...draft.tls, trustServerCertificate: e.target.checked } })}
                        className="accent-primary"
                      />
                      Trust server certificate
                    </label>
                  )}
                </div>
              </Row>
            </>
          )}
          <Row label="Protected" hint="Only read queries are allowed">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.protected} onChange={(e) => set({ protected: e.target.checked })} className="accent-primary" />
              <Lock className="size-3.5" /> Block INSERT/UPDATE/DELETE/DDL (use for production)
            </label>
          </Row>
          <Row label="Timeouts" hint="Connect / query, ms">
            <div className="flex gap-2">
              <Input
                type="number"
                value={draft.connectTimeoutMs ?? ""}
                placeholder="10000"
                onChange={(e) => set({ connectTimeoutMs: e.target.value ? Number(e.target.value) : null })}
                className="w-32"
              />
              <Input
                type="number"
                value={draft.statementTimeoutMs ?? ""}
                placeholder="60000"
                onChange={(e) => set({ statementTimeoutMs: e.target.value ? Number(e.target.value) : null })}
                className="w-32"
              />
            </div>
          </Row>
          <div className="flex items-start gap-3 pt-2">
            <Button variant="outline" onClick={runTest} disabled={test.status === "running"}>
              {test.status === "running" ? <Loader2 className="animate-spin" /> : <Plug />} Test connection
            </Button>
            {(test.status === "ok" || test.status === "fail") && (
              <div className={cn("flex min-w-0 items-start gap-1.5 pt-1.5 text-sm", test.status === "ok" ? "text-method-get" : "text-destructive")}>
                {test.status === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                <span className="break-all select-text">{test.text}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete connection "${source.name}"?`}
        description="The connection file and its stored password on this machine will be removed."
        onConfirm={() => deleteProfile(id)}
      />
    </div>
  );
}
