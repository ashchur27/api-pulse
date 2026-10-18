import { open } from "@tauri-apps/plugin-dialog";
import { Activity, FolderOpen, FolderPlus, X } from "lucide-react";
import { useState } from "react";
import { NameDialog } from "@/components/common/NameDialog";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/stores/settings";
import { createWorkspace, openWorkspace } from "@/stores/workspace";

async function pickFolder(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

export async function pickAndOpenWorkspace() {
  const path = await pickFolder("Open API-Pulse workspace");
  if (path) await openWorkspace(path);
}

export function useCreateWorkspaceFlow() {
  const [path, setPath] = useState<string | null>(null);
  const start = async () => setPath(await pickFolder("Choose an empty folder for the new workspace"));
  const dialog = (
    <NameDialog
      open={path !== null}
      title="New workspace"
      description={path ?? undefined}
      initialValue={path?.split(/[\\/]/).filter(Boolean).pop() ?? "My workspace"}
      onOpenChange={(o) => !o && setPath(null)}
      onSubmit={async (name) => {
        if (path && (await createWorkspace(path, name))) setPath(null);
      }}
    />
  );
  return { start, dialog };
}

export function Welcome() {
  const recent = useSettings((s) => s.recentWorkspaces);
  const forget = useSettings((s) => s.forgetWorkspace);
  const create = useCreateWorkspaceFlow();

  return (
    <div className="flex h-full items-center justify-center bg-sidebar">
      <div className="w-full max-w-lg space-y-8 p-8">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-gradient-to-br from-teal-700 to-blue-900 p-2 text-white">
            <Activity className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">API-Pulse</h1>
            <p className="text-muted-foreground">REST, SOAP and database testing</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-16 justify-start gap-3 px-4" onClick={pickAndOpenWorkspace}>
            <FolderOpen className="size-5" />
            <div className="text-left">
              <div>Open workspace</div>
              <div className="text-xs font-normal text-muted-foreground">Existing folder</div>
            </div>
          </Button>
          <Button variant="outline" className="h-16 justify-start gap-3 px-4" onClick={create.start}>
            <FolderPlus className="size-5" />
            <div className="text-left">
              <div>New workspace</div>
              <div className="text-xs font-normal text-muted-foreground">Git-friendly YAML files</div>
            </div>
          </Button>
        </div>

        {recent.length > 0 && (
          <div className="space-y-1">
            <div className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Recent</div>
            {recent.map((path) => (
              <div key={path} className="group flex items-center rounded-md hover:bg-accent">
                <button
                  className="min-w-0 flex-1 truncate px-2 py-1.5 text-left"
                  title={path}
                  onClick={async () => {
                    if (!(await openWorkspace(path))) forget(path);
                  }}
                >
                  {path}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mr-1 opacity-0 group-hover:opacity-100"
                  aria-label="Remove from recent"
                  onClick={() => forget(path)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      {create.dialog}
    </div>
  );
}
