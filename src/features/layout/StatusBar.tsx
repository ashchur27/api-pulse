import { AlertTriangle, FolderGit2 } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { countRequests } from "@/lib/tree";
import { useWorkspace } from "@/stores/workspace";

export function StatusBar() {
  const tree = useWorkspace((s) => s.tree);
  if (!tree) return null;
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5" title={tree.root}>
        <FolderGit2 className="size-3.5 shrink-0" />
        <span className="truncate">{tree.root}</span>
      </span>
      {tree.problems.length > 0 && (
        <Tooltip content={tree.problems.map((p) => `${p.path}: ${p.message}`).join("\n")} side="top">
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5" /> {tree.problems.length} unreadable file(s)
          </span>
        </Tooltip>
      )}
      <span className="ml-auto">
        {tree.collections.length} collection(s) · {countRequests(tree)} request(s)
      </span>
    </footer>
  );
}
