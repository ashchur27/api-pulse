import { Activity, Check, ChevronDown, FolderOpen, FolderPlus, Monitor, Moon, Settings, Settings2, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { pickAndOpenWorkspace, useCreateWorkspaceFlow } from "@/features/workspace/Welcome";
import { useActiveEnvironment, useEnvironments } from "@/stores/environments";
import { useSettings } from "@/stores/settings";
import { SETTINGS_TAB_ID, useTabs } from "@/stores/tabs";
import { openWorkspace, useWorkspace } from "@/stores/workspace";

const themeIcon = { light: Sun, dark: Moon, system: Monitor };

export function TopBar() {
  const tree = useWorkspace((s) => s.tree);
  const closeWorkspace = useWorkspace((s) => s.close);
  const recent = useSettings((s) => s.recentWorkspaces);
  const theme = useSettings((s) => s.theme);
  const cycleTheme = useSettings((s) => s.cycleTheme);
  const openTab = useTabs((s) => s.open);
  const create = useCreateWorkspaceFlow();
  const ThemeIcon = themeIcon[theme];

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-sidebar px-2">
      <div className="flex items-center gap-1.5 px-1 font-semibold">
        <Activity className="size-4 text-teal-600 dark:text-teal-400" />
        API-Pulse
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="max-w-72 gap-1 font-normal">
            <span className="truncate">{tree?.name}</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuItem onSelect={pickAndOpenWorkspace}>
            <FolderOpen /> Open workspace…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={create.start}>
            <FolderPlus /> New workspace…
          </DropdownMenuItem>
          {recent.filter((p) => p !== tree?.root).length > 0 && <DropdownMenuSeparator />}
          {recent
            .filter((p) => p !== tree?.root)
            .map((path) => (
              <DropdownMenuItem key={path} onSelect={() => openWorkspace(path)} title={path}>
                <span className="truncate">{path}</span>
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={closeWorkspace}>
            <X /> Close workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />

      <EnvironmentSelector />
      <Tooltip content={`Theme: ${theme}`}>
        <Button variant="ghost" size="icon" onClick={cycleTheme} aria-label="Toggle theme">
          <ThemeIcon />
        </Button>
      </Tooltip>
      <Tooltip content="Settings">
        <Button variant="ghost" size="icon" onClick={() => openTab(SETTINGS_TAB_ID, "settings")} aria-label="Settings">
          <Settings />
        </Button>
      </Tooltip>
      {create.dialog}
    </header>
  );
}

function EnvironmentSelector() {
  const workspaceId = useWorkspace((s) => s.tree?.id);
  const data = useEnvironments((s) => s.data);
  const environments = data?.environments ?? [];
  const setActive = useEnvironments((s) => s.setActive);
  const active = useActiveEnvironment(workspaceId);
  const selectActivity = useSettings((s) => s.selectActivity);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-44 justify-between font-normal">
          <span className={active ? "truncate" : "truncate text-muted-foreground"}>{active?.name ?? "No environment"}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => workspaceId && setActive(workspaceId, null)}>
          <Check className={active ? "opacity-0" : ""} /> No environment
        </DropdownMenuItem>
        {environments.map((env) => (
          <DropdownMenuItem key={env.id} onSelect={() => workspaceId && setActive(workspaceId, env.id)}>
            <Check className={active?.id === env.id ? "" : "opacity-0"} /> <span className="truncate">{env.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            if (useSettings.getState().activity !== "environments" || !useSettings.getState().sidebarVisible) selectActivity("environments");
          }}
        >
          <Settings2 /> Manage environments
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
