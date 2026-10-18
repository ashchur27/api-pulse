import { Database, FolderTree, History, ListChecks, Variable } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSettings, type Activity } from "@/stores/settings";

export const activities: { id: Activity; label: string; icon: typeof FolderTree }[] = [
  { id: "collections", label: "Collections", icon: FolderTree },
  { id: "scenarios", label: "Scenarios", icon: ListChecks },
  { id: "environments", label: "Environments", icon: Variable },
  { id: "databases", label: "Databases", icon: Database },
  { id: "history", label: "History", icon: History },
];

export function ActivityBar() {
  const activity = useSettings((s) => s.activity);
  const sidebarVisible = useSettings((s) => s.sidebarVisible);
  const select = useSettings((s) => s.selectActivity);

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2">
      {activities.map(({ id, label, icon: Icon }) => {
        const active = sidebarVisible && activity === id;
        return (
          <Tooltip key={id} content={label} side="right">
            <button
              aria-label={label}
              aria-pressed={active}
              onClick={() => select(id)}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground",
                active && "text-foreground before:absolute before:top-1.5 before:bottom-1.5 before:-left-1 before:w-0.5 before:rounded before:bg-primary",
              )}
            >
              <Icon className="size-5" />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
