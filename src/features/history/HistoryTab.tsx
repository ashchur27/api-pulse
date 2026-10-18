import { AlertTriangle, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { EmptyState } from "@/components/common/EmptyState";
import { MethodBadge } from "@/components/common/MethodBadge";
import { Button } from "@/components/ui/button";
import { ResponseView } from "@/features/response/ResponsePanel";
import { api, errorText } from "@/ipc/commands";
import type { HistorySnapshot, PreparedRequest } from "@/ipc/types";
import { findNode } from "@/lib/tree";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";

function requestText(p: PreparedRequest): string {
  const head = `${p.method} ${p.url}\n${p.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}`;
  const body = p.body;
  if (!body) return head;
  if (body.kind === "text") return `${head}\n\n${body.text}`;
  if (body.kind === "form") return `${head}\n\n${body.fields.map(([k, v]) => `${k}=${v}`).join("&")}`;
  if (body.kind === "multipart") return `${head}\n\n${body.parts.map((p) => `${p.name}: ${p.filePath ?? p.value ?? ""}`).join("\n")}`;
  return `${head}\n\n<file ${body.path}>`;
}

export function HistoryTab({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>();
  const [error, setError] = useState<string>();
  const openTab = useTabs((s) => s.open);
  const exists = useWorkspace((s) => (snapshot?.entry.requestId ? !!findNode(s.tree, snapshot.entry.requestId) : false));

  useEffect(() => {
    api.historyGet(id).then(setSnapshot, (e) => setError(errorText(e)));
  }, [id]);

  if (error) return <EmptyState icon={<AlertTriangle />} title="Snapshot not available" description={error} />;
  if (!snapshot) return <EmptyState title="Loading…" />;

  const { entry, prepared, response, warnings } = snapshot;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-2">
        <MethodBadge method={entry.method} className="w-auto" />
        <span className="font-medium">{entry.name}</span>
        <span className="text-xs text-muted-foreground">{new Date(entry.ts).toLocaleString()}</span>
        <div className="flex-1" />
        {exists && entry.requestId && (
          <Button size="sm" variant="outline" onClick={() => openTab(entry.requestId!, "request", false)}>
            <ExternalLink /> Open request
          </Button>
        )}
      </div>
      <PanelGroup direction="vertical" autoSaveId="api-pulse:layout-history">
        <Panel id="sent" order={1} defaultSize={35} minSize={10} className="overflow-auto">
          <pre className="m-2 rounded-md border bg-muted/40 p-2 font-mono text-xs break-all whitespace-pre-wrap select-text">{requestText(prepared)}</pre>
        </Panel>
        <PanelResizeHandle className="z-10 -my-0.5 h-1 border-t transition-colors hover:bg-ring/40" />
        <Panel id="received" order={2} minSize={15}>
          {response ? (
            <ResponseView result={{ request: prepared, response, warnings }} />
          ) : (
            <EmptyState icon={<AlertTriangle />} title={snapshot.error?.message ?? "Request failed"} description={snapshot.error?.details} />
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
