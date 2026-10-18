import { Check, Globe, Plus, Trash2, Variable } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { NameDialog } from "@/components/common/NameDialog";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { Environment } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { createEnvironment, deleteEnvironment, useEnvironments } from "@/stores/environments";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";

export function EnvironmentsView() {
  const data = useEnvironments((s) => s.data);
  const workspaceId = useWorkspace((s) => s.tree?.id);
  const activeId = useEnvironments((s) => (workspaceId ? s.activeByWorkspace[workspaceId] : null));
  const setActive = useEnvironments((s) => s.setActive);
  const openTab = useTabs((s) => s.open);
  const forceClose = useTabs((s) => s.forceClose);
  const tabId = useTabs((s) => s.activeId);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Environment | null>(null);

  const row = (env: Environment, globals = false) => {
    const active = !globals && env.id === activeId;
    return (
      <ContextMenu key={env.id}>
        <ContextMenuTrigger asChild>
          <div
            onClick={() => openTab(env.id, "environment")}
            className={cn("group flex h-7 cursor-default items-center gap-2 px-3 hover:bg-accent/60", tabId === env.id && "bg-accent")}
          >
            {globals ? <Globe className="size-4 text-muted-foreground" /> : <Variable className="size-4 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{env.name}</span>
            <span className="text-xs text-muted-foreground">{env.variables.length}</span>
            {!globals && (
              <Tooltip content={active ? "Active" : "Set active"}>
                <button
                  aria-label="Set active"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (workspaceId) setActive(workspaceId, active ? null : env.id);
                  }}
                  className={cn("rounded p-0.5", active ? "text-method-get" : "text-muted-foreground opacity-0 group-hover:opacity-100")}
                >
                  <Check className="size-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        </ContextMenuTrigger>
        {!globals && (
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => workspaceId && setActive(workspaceId, env.id)}>Set active</ContextMenuItem>
            <ContextMenuItem onSelect={() => openTab(env.id, "environment")}>Edit</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => setPendingDelete(env)}>
              <Trash2 /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1 pl-3">
        <span className="text-xs font-semibold tracking-wide uppercase">Environments</span>
        <Tooltip content="New environment">
          <Button variant="ghost" size="icon-sm" onClick={() => setCreating(true)} aria-label="New environment">
            <Plus />
          </Button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {data && row(data.globals, true)}
        <div className="my-1 border-t" />
        {data?.environments.length === 0 ? (
          <EmptyState
            icon={<Variable />}
            title="No environments"
            description="Create dev, staging, etc. and switch between them in the top bar."
            className="h-auto py-12"
          >
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New environment
            </Button>
          </EmptyState>
        ) : (
          data?.environments.map((env) => row(env))
        )}
      </div>
      <NameDialog
        open={creating}
        title="New environment"
        initialValue="dev"
        onOpenChange={setCreating}
        onSubmit={async (name) => {
          const id = await createEnvironment(name);
          setCreating(false);
          if (id) openTab(id, "environment");
        }}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete environment "${pendingDelete?.name ?? ""}"?`}
        description="The environment file and its secrets on this machine will be removed."
        onConfirm={async () => {
          if (pendingDelete && (await deleteEnvironment(pendingDelete.id))) forceClose([pendingDelete.id]);
        }}
      />
    </div>
  );
}
