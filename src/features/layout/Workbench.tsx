import { FolderTree } from "lucide-react";
import { EmptyState, Kbd } from "@/components/common/EmptyState";
import { ContainerTab } from "@/features/collections/ContainerTab";
import { ConnectionTab } from "@/features/db/ConnectionTab";
import { SqlTab } from "@/features/db/SqlTab";
import { EnvironmentTab } from "@/features/environments/EnvironmentTab";
import { HistoryTab } from "@/features/history/HistoryTab";
import { RequestTab } from "@/features/request/RequestTab";
import { SettingsTab } from "@/features/settings/SettingsTab";
import { useTabs } from "@/stores/tabs";
import { TabBar } from "./TabBar";

export function Workbench() {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId);

  if (tabs.length === 0) {
    return (
      <EmptyState
        icon={<FolderTree />}
        title="No open requests"
        description={
          <span className="space-y-1">
            Select a request in the sidebar or create one from a collection's context menu.
            <span className="mt-3 flex justify-center gap-3">
              <span>
                <Kbd>Ctrl+B</Kbd> sidebar
              </span>
              <span>
                <Kbd>Ctrl+S</Kbd> save
              </span>
              <span>
                <Kbd>Ctrl+W</Kbd> close tab
              </span>
            </span>
          </span>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {active?.kind === "request" && <RequestTab key={active.id} id={active.id} />}
        {active?.kind === "settings" && <SettingsTab />}
        {active?.kind === "environment" && <EnvironmentTab key={active.id} id={active.id} />}
        {active?.kind === "container" && <ContainerTab key={active.id} id={active.id} />}
        {active?.kind === "history" && <HistoryTab key={active.id} id={active.id} />}
        {active?.kind === "database" && <ConnectionTab key={active.id} id={active.id} />}
        {active?.kind === "sql" && <SqlTab key={active.id} id={active.id} />}
      </div>
    </div>
  );
}
