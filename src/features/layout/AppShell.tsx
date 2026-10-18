import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { loadProfiles, useDatabases } from "@/stores/databases";
import { useSettings } from "@/stores/settings";
import { useWorkspace } from "@/stores/workspace";
import { ActivityBar } from "./ActivityBar";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { Workbench } from "./Workbench";

export function AppShell() {
  const sidebarVisible = useSettings((s) => s.sidebarVisible);
  const workspaceId = useWorkspace((s) => s.tree?.id);

  useEffect(() => {
    useDatabases.getState().reset();
    if (workspaceId) loadProfiles();
  }, [workspaceId]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <PanelGroup direction="horizontal" autoSaveId="api-pulse:layout-main">
          {sidebarVisible && (
            <>
              <Panel id="sidebar" order={1} defaultSize={22} minSize={12} maxSize={45} className="border-r">
                <Sidebar />
              </Panel>
              <PanelResizeHandle className="w-1 -mx-0.5 z-10 transition-colors hover:bg-ring/40 data-[resize-handle-state=drag]:bg-ring/60" />
            </>
          )}
          <Panel id="workbench" order={2} minSize={40}>
            <Workbench />
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar />
    </div>
  );
}
