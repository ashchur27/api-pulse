import { History, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { MethodBadge } from "@/components/common/MethodBadge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { HistoryEntry } from "@/ipc/types";
import { formatMs, statusTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clearHistory, useHistory } from "@/stores/history";
import { useTabs } from "@/stores/tabs";

const toneClass = {
  success: "text-method-get",
  redirect: "text-method-put",
  client: "text-method-post",
  server: "text-method-delete",
  info: "text-muted-foreground",
};

function groupOf(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86_400_000;
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return "Earlier";
}

export function HistoryView() {
  const entries = useHistory((s) => s.entries);
  const openTab = useTabs((s) => s.open);
  const activeId = useTabs((s) => s.activeId);
  const [confirm, setConfirm] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const g = groupOf(e.ts);
      map.set(g, [...(map.get(g) ?? []), e]);
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1 pl-3">
        <span className="text-xs font-semibold tracking-wide uppercase">History</span>
        <Tooltip content="Clear history">
          <Button variant="ghost" size="icon-sm" disabled={entries.length === 0} onClick={() => setConfirm(true)} aria-label="Clear history">
            <Trash2 />
          </Button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {entries.length === 0 ? (
          <EmptyState icon={<History />} title="No requests yet" description="Every sent request is saved here with its response." />
        ) : (
          groups.map(([group, items]) => (
            <div key={group}>
              <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{group}</div>
              {items.map((e) => (
                <div
                  key={e.id}
                  onClick={() => openTab(e.id, "history", true)}
                  onDoubleClick={() => openTab(e.id, "history", false)}
                  title={e.url}
                  className={cn("flex h-11 cursor-default flex-col justify-center px-3 hover:bg-accent/60", activeId === e.id && "bg-accent")}
                >
                  <div className="flex items-center gap-1.5">
                    <MethodBadge method={e.method} className="w-auto" />
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                    {e.status !== undefined ? (
                      <span className={cn("font-mono text-xs", toneClass[statusTone(e.status)])}>{e.status}</span>
                    ) : (
                      <span className="font-mono text-xs text-destructive">ERR</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 flex-1 truncate font-mono">{e.url}</span>
                    <span>{new Date(e.ts).toLocaleTimeString()}</span>
                    {e.totalMs !== undefined && <span>{formatMs(e.totalMs)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear history?"
        description="All saved requests and response snapshots of this workspace will be removed."
        confirmLabel="Clear"
        onConfirm={clearHistory}
      />
    </div>
  );
}
