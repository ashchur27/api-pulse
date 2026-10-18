import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ResponsePanel } from "@/features/response/ResponsePanel";
import { useTabs } from "@/stores/tabs";
import { loadRequest } from "@/stores/workspace";
import { RequestEditor } from "./RequestEditor";
import { useScopeVars } from "./useScopeVars";

export function RequestTab({ id }: { id: string }) {
  const draft = useTabs((s) => s.drafts[id]);
  const vars = useScopeVars(id);

  useEffect(() => {
    if (!draft) loadRequest(id);
  }, [id, draft]);

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <PanelGroup direction="vertical" autoSaveId="api-pulse:layout-request">
      <Panel id="request" order={1} defaultSize={55} minSize={20}>
        <RequestEditor request={draft} vars={vars} />
      </Panel>
      <PanelResizeHandle className="h-1 -my-0.5 z-10 border-t transition-colors hover:bg-ring/40 data-[resize-handle-state=drag]:bg-ring/60" />
      <Panel id="response" order={2} minSize={15}>
        <ResponsePanel requestId={id} />
      </Panel>
    </PanelGroup>
  );
}
