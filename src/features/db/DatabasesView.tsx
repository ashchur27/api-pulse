import { ChevronRight, Database, Eye, FileCode2, Loader2, Lock, Plus, RefreshCw, Table2, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/menu";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip } from "@/components/ui/tooltip";
import type { DbDriver, DbProfile, SchemaTable } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { createProfile, deleteProfile, driverLabels, loadSchema, openSqlTab, selectTopSql, useDatabases } from "@/stores/databases";
import { useTabs } from "@/stores/tabs";

const driverShort: Record<DbDriver, string> = { mssql: "MS", postgres: "PG", mysql: "MY", sqlite: "SL", cosmos: "CO" };

function NewConnectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const [driver, setDriver] = useState<DbDriver>("mssql");
  const openTab = useTabs((s) => s.open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const id = await createProfile(name.trim(), driver);
            if (id) {
              onOpenChange(false);
              setName("");
              openTab(id, "database", false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>New database connection</DialogTitle>
          </DialogHeader>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. billing-dev" />
          <NativeSelect value={driver} onChange={(e) => setDriver(e.target.value as DbDriver)}>
            {(["mssql", "postgres", "mysql", "sqlite"] as DbDriver[]).map((d) => (
              <option key={d} value={d}>
                {driverLabels[d]}
              </option>
            ))}
          </NativeSelect>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TableNode({ profile, table }: { profile: DbProfile; table: SchemaTable }) {
  const [open, setOpen] = useState(false);
  const label = profile.driver === "sqlite" || table.schema === "dbo" || table.schema === "public" ? table.name : `${table.schema}.${table.name}`;
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => setOpen(!open)}
            onDoubleClick={() => openSqlTab(profile.id, selectTopSql(profile.driver, table.schema, table.name), table.name)}
            className="flex h-6 cursor-default items-center gap-1 pr-2 pl-7 hover:bg-accent/60"
          >
            <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            {table.kind === "view" ? <Eye className="size-3.5 shrink-0 text-muted-foreground" /> : <Table2 className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate text-xs">{label}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openSqlTab(profile.id, selectTopSql(profile.driver, table.schema, table.name), table.name)}>
            Select top 100
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => navigator.clipboard.writeText(label)}>Copy name</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open &&
        table.columns.map((c) => (
          <div key={c.name} className="flex h-5 items-center gap-2 pr-2 pl-14 text-[11px]" title={`${c.dataType}${c.nullable ? " NULL" : " NOT NULL"}`}>
            <span className="truncate font-mono">{c.name}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{c.dataType}</span>
          </div>
        ))}
    </>
  );
}

function ProfileNode({ profile, onDelete }: { profile: DbProfile; onDelete: (p: DbProfile) => void }) {
  const [open, setOpen] = useState(false);
  const schema = useDatabases((s) => s.schemas[profile.id]);
  const openTab = useTabs((s) => s.open);
  const active = useTabs((s) => s.activeId === profile.id);

  const toggle = () => {
    if (!open && !schema && profile.driver !== "cosmos") loadSchema(profile.id);
    setOpen(!open);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onClick={toggle}
            onDoubleClick={() => openTab(profile.id, "database", false)}
            className={cn("group flex h-7 cursor-default items-center gap-1.5 pr-1 pl-2 hover:bg-accent/60", active && "bg-accent")}
          >
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <span className="w-5 shrink-0 rounded bg-muted text-center font-mono text-[9px] font-bold text-muted-foreground">{driverShort[profile.driver]}</span>
            <span className="min-w-0 flex-1 truncate">{profile.name}</span>
            {profile.protected && <Lock className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />}
            <Tooltip content="New query">
              <button
                aria-label="New query"
                onClick={(e) => {
                  e.stopPropagation();
                  openSqlTab(profile.id);
                }}
                className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
              >
                <FileCode2 className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openSqlTab(profile.id)}>
            <FileCode2 /> New query
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openTab(profile.id, "database", false)}>Edit connection</ContextMenuItem>
          <ContextMenuItem onSelect={() => loadSchema(profile.id)}>
            <RefreshCw /> Refresh schema
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(profile)}>
            <Trash2 /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open && (
        <>
          {schema?.status === "loading" && (
            <div className="flex h-6 items-center gap-2 pl-8 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading schema…
            </div>
          )}
          {schema?.status === "error" && (
            <div className="px-3 py-1 pl-8 text-xs break-all text-destructive" title={schema.error}>
              {schema.error}
            </div>
          )}
          {schema?.status === "done" &&
            (schema.tables.length === 0 ? (
              <div className="pl-8 text-xs text-muted-foreground">No tables</div>
            ) : (
              schema.tables.map((t) => <TableNode key={`${t.schema}.${t.name}`} profile={profile} table={t} />)
            ))}
        </>
      )}
    </>
  );
}

export function DatabasesView() {
  const data = useDatabases((s) => s.data);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DbProfile | null>(null);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1 pl-3">
        <span className="text-xs font-semibold tracking-wide uppercase">Databases</span>
        <Tooltip content="New connection">
          <Button variant="ghost" size="icon-sm" onClick={() => setCreating(true)} aria-label="New connection">
            <Plus />
          </Button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {data && data.profiles.length === 0 ? (
          <EmptyState icon={<Database />} title="No connections" description="MS SQL Server, PostgreSQL, MySQL/MariaDB and SQLite." className="h-auto py-12">
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New connection
            </Button>
          </EmptyState>
        ) : (
          data?.profiles.map((p) => <ProfileNode key={p.id} profile={p} onDelete={setPendingDelete} />)
        )}
      </div>
      <NewConnectionDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete connection "${pendingDelete?.name ?? ""}"?`}
        description="The connection file and its stored password on this machine will be removed."
        onConfirm={async () => {
          if (pendingDelete) await deleteProfile(pendingDelete.id);
        }}
      />
    </div>
  );
}
