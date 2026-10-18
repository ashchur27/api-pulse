import { Database, FileCode2, Folder, History, Settings, Variable, X } from "lucide-react";
import { MethodBadge } from "@/components/common/MethodBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/menu";
import type { Tab } from "@/lib/tabs";
import { findNode } from "@/lib/tree";
import { cn } from "@/lib/utils";
import { closeOthers, closeSaved, closeToTheRight, isDirty, useTabs } from "@/stores/tabs";
import { findEnvironment, useEnvironments } from "@/stores/environments";
import { useHistory } from "@/stores/history";
import { useDatabases } from "@/stores/databases";
import { saveRequest, useWorkspace } from "@/stores/workspace";

const tabIcons = { settings: Settings, environment: Variable, container: Folder, history: History, database: Database, sql: FileCode2 };

function useTabInfo(tab: Tab) {
  const node = useWorkspace((s) => (tab.kind === "request" || tab.kind === "container" ? findNode(s.tree, tab.id) : null));
  const draft = useTabs((s) => s.drafts[tab.id]);
  const env = useEnvironments((s) => (tab.kind === "environment" ? findEnvironment(s.data, tab.id) : undefined));
  const historyEntry = useHistory((s) => (tab.kind === "history" ? s.entries.find((e) => e.id === tab.id) : undefined));
  const dbTitle = useDatabases((s) =>
    tab.kind === "database" ? s.data?.profiles.find((p) => p.id === tab.id)?.name : tab.kind === "sql" ? s.sqlTabs[tab.id]?.title : undefined,
  );
  if (tab.kind === "database" || tab.kind === "sql") return { title: dbTitle ?? (tab.kind === "sql" ? "Query" : "Connection"), method: undefined, soap: false };
  if (tab.kind === "settings") return { title: "Settings", method: undefined, soap: false };
  if (tab.kind === "environment") return { title: env?.name ?? "Environment", method: undefined, soap: false };
  if (tab.kind === "container") return { title: node?.name ?? "Settings", method: undefined, soap: false };
  if (tab.kind === "history") return { title: historyEntry ? `${historyEntry.name} (history)` : "History", method: undefined, soap: false };
  return {
    title: draft?.name ?? node?.name ?? "Request",
    method: draft?.method ?? node?.method,
    soap: (draft?.type ?? node?.requestType) === "soap",
  };
}

function TabButton({ tab }: { tab: Tab }) {
  const active = useTabs((s) => s.activeId === tab.id);
  const dirty = useTabs((s) => isDirty(s, tab.id));
  const activate = useTabs((s) => s.activate);
  const pin = useTabs((s) => s.pin);
  const requestClose = useTabs((s) => s.requestClose);
  const info = useTabInfo(tab);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              requestClose([tab.id]);
            }
          }}
          onClick={() => activate(tab.id)}
          onDoubleClick={() => pin(tab.id)}
          className={cn(
            "group relative flex h-9 max-w-56 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r pr-1 pl-3 text-muted-foreground hover:bg-accent/40",
            active && "bg-background text-foreground after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:bg-primary",
          )}
          title={info.title}
        >
          {tab.kind !== "request" ? (
            (() => {
              const Icon = tabIcons[tab.kind];
              return <Icon className="size-3.5 shrink-0" />;
            })()
          ) : (
            <MethodBadge method={info.method} soap={info.soap} className="w-auto" />
          )}
          <span className={cn("truncate", tab.preview && "italic")}>{info.title}</span>
          <button
            aria-label={dirty ? "Unsaved changes, close" : "Close"}
            onClick={(e) => {
              e.stopPropagation();
              requestClose([tab.id]);
            }}
            className="group/close ml-1 flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
          >
            {dirty ? (
              <>
                <span className="size-2 rounded-full bg-foreground/70 group-hover/close:hidden" />
                <X className="hidden size-3.5 group-hover/close:block" />
              </>
            ) : (
              <X className={cn("size-3.5", !active && "opacity-0 group-hover:opacity-100")} />
            )}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem shortcut="Ctrl+W" onSelect={() => requestClose([tab.id])}>
          Close
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => closeOthers(tab.id)}>Close others</ContextMenuItem>
        <ContextMenuItem onSelect={() => closeToTheRight(tab.id)}>Close to the right</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={closeSaved}>Close saved</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TabBar() {
  const tabs = useTabs((s) => s.tabs);
  return (
    <div
      role="tablist"
      onWheel={(e) => {
        if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
      }}
      className="flex h-9 shrink-0 overflow-x-auto overflow-y-hidden border-b bg-sidebar [scrollbar-width:none]"
    >
      {tabs.map((tab) => (
        <TabButton key={tab.id} tab={tab} />
      ))}
      <UnsavedChangesDialog />
    </div>
  );
}

function UnsavedChangesDialog() {
  const pending = useTabs((s) => s.pendingClose);
  const cancel = useTabs((s) => s.cancelClose);
  const forceClose = useTabs((s) => s.forceClose);
  const tree = useWorkspace((s) => s.tree);
  const drafts = useTabs((s) => s.drafts);
  const names = pending.map((id) => drafts[id]?.name ?? findNode(tree, id)?.name ?? id);

  const saveAll = async () => {
    const saved: string[] = [];
    for (const id of pending) {
      if (await saveRequest(id)) saved.push(id);
    }
    forceClose(saved);
  };

  return (
    <Dialog open={pending.length > 0} onOpenChange={(o) => !o && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save changes?</DialogTitle>
          <DialogDescription>
            {names.length === 1 ? `"${names[0]}" has unsaved changes.` : `${names.length} requests have unsaved changes: ${names.join(", ")}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => forceClose(pending)}>
            Don't save
          </Button>
          <Button onClick={saveAll} autoFocus>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
