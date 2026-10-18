import { EmptyState } from "@/components/common/EmptyState";
import { CollectionsView } from "@/features/collections/CollectionsView";
import { DatabasesView } from "@/features/db/DatabasesView";
import { EnvironmentsView } from "@/features/environments/EnvironmentsView";
import { HistoryView } from "@/features/history/HistoryView";
import { useSettings, type Activity } from "@/stores/settings";
import { activities } from "./ActivityBar";

const upcoming: Record<Exclude<Activity, "collections" | "environments" | "history" | "databases">, { phase: number; text: string }> = {
  scenarios: { phase: 5, text: "Test suites with Setup → Steps → Teardown, SQL/Cosmos steps and cleanup." },
};

export function Sidebar() {
  const activity = useSettings((s) => s.activity);
  if (activity === "collections") return <CollectionsView />;
  if (activity === "environments") return <EnvironmentsView />;
  if (activity === "history") return <HistoryView />;
  if (activity === "databases") return <DatabasesView />;

  const meta = activities.find((a) => a.id === activity)!;
  const info = upcoming[activity];
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 items-center border-b px-3 text-xs font-semibold tracking-wide uppercase">{meta.label}</div>
      <EmptyState icon={<meta.icon />} title={`Coming in phase ${info.phase}`} description={info.text} />
    </div>
  );
}
