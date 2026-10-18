import { AlertTriangle, FileDown, FolderPlus, Plus, Search } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import type { TreeNode } from "@/ipc/types";
import { filterTree, findNode } from "@/lib/tree";
import { useTabs } from "@/stores/tabs";
import { createCollection, deleteNode, duplicateRequest, useWorkspace } from "@/stores/workspace";
import { TreeItem } from "./TreeItem";
import { WsdlImportDialog } from "@/features/soap/WsdlImportDialog";

export function CollectionsView() {
  const tree = useWorkspace((s) => s.tree);
  const setRenaming = useWorkspace((s) => s.setRenaming);
  const expanded = useWorkspace((s) => s.expanded);
  const setExpanded = useWorkspace((s) => s.setExpanded);
  const openTab = useTabs((s) => s.open);
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);
  const [importing, setImporting] = useState(false);

  const nodes = useMemo(() => filterTree(tree?.collections ?? [], filter), [tree, filter]);
  const filtering = filter.trim().length > 0;

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selectedId || e.target instanceof HTMLInputElement) return;
    const node = findNode(tree, selectedId);
    if (!node) return;
    if (e.key === "F2") {
      e.preventDefault();
      setRenaming(node.id);
    } else if (e.key === "Delete") {
      e.preventDefault();
      setPendingDelete(node);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (node.kind === "request") openTab(node.id, "request", false);
      else setExpanded(node.id, !expanded[node.id]);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && node.kind === "request") {
      e.preventDefault();
      duplicateRequest(node.id);
    }
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center justify-between border-b pr-1 pl-3">
        <span className="text-xs font-semibold tracking-wide uppercase">Collections</span>
        <div className="flex">
          <Tooltip content="Import WSDL">
            <Button variant="ghost" size="icon-sm" onClick={() => setImporting(true)} aria-label="Import WSDL">
              <FileDown />
            </Button>
          </Tooltip>
          <Tooltip content="New collection">
            <Button variant="ghost" size="icon-sm" onClick={createCollection} aria-label="New collection">
              <Plus />
            </Button>
          </Tooltip>
        </div>
      </div>
      <WsdlImportDialog open={importing} onOpenChange={setImporting} />
      <div className="relative shrink-0 p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          placeholder="Filter"
          className="h-7 pl-7 text-xs"
        />
      </div>
      {tree && tree.problems.length > 0 && (
        <div className="mx-2 mb-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 space-y-0.5">
            {tree.problems.map((p) => (
              <div key={p.path} className="truncate" title={`${p.path}\n${p.message}`}>
                {p.path}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-4 outline-none" role="tree" tabIndex={-1} onKeyDown={onKeyDown}>
        {nodes.length === 0 ? (
          filtering ? (
            <div className="p-4 text-center text-xs text-muted-foreground">No matches</div>
          ) : (
            <EmptyState icon={<FolderPlus />} title="No collections yet" description="Collections group requests into folders.">
              <Button size="sm" onClick={createCollection}>
                <Plus /> New collection
              </Button>
            </EmptyState>
          )
        ) : (
          nodes.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              forceExpanded={filtering}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={setPendingDelete}
            />
          ))
        )}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.kind ?? ""} "${pendingDelete?.name ?? ""}"?`}
        description={
          pendingDelete?.kind === "request"
            ? "The request file will be removed from disk."
            : "The folder and everything inside it will be removed from disk."
        }
        onConfirm={async () => {
          if (pendingDelete) await deleteNode(pendingDelete.id);
        }}
      />
    </div>
  );
}
