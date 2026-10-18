import { ChevronRight, Copy, FilePlus2, FolderClosed, FolderOpen, FolderPlus, Library, Pencil, Settings2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MethodBadge } from "@/components/common/MethodBadge";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/menu";
import type { TreeNode } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { isDirty, useTabs } from "@/stores/tabs";
import { createFolder, createRequest, duplicateRequest, renameNode, useWorkspace } from "@/stores/workspace";

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  forceExpanded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (node: TreeNode) => void;
}

export function TreeItem({ node, depth, forceExpanded, selectedId, onSelect, onDelete }: TreeItemProps) {
  const expanded = useWorkspace((s) => !!s.expanded[node.id]);
  const setExpanded = useWorkspace((s) => s.setExpanded);
  const renaming = useWorkspace((s) => s.renamingId === node.id);
  const setRenaming = useWorkspace((s) => s.setRenaming);
  const openTab = useTabs((s) => s.open);
  const active = useTabs((s) => s.activeId === node.id);
  const dirty = useTabs((s) => isDirty(s, node.id));

  const isContainer = node.kind !== "request";
  const open = isContainer && (expanded || forceExpanded);
  const selected = selectedId === node.id;

  const activate = (pin: boolean) => {
    onSelect(node.id);
    if (isContainer) setExpanded(node.id, !expanded);
    else openTab(node.id, "request", !pin);
  };

  const ContainerIcon = node.kind === "collection" ? Library : open ? FolderOpen : FolderClosed;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="treeitem"
            aria-expanded={isContainer ? open : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => activate(false)}
            onDoubleClick={() => !isContainer && activate(true)}
            onContextMenu={() => onSelect(node.id)}
            style={{ paddingLeft: depth * 12 + 6 }}
            className={cn(
              "group flex h-7 cursor-default items-center gap-1 pr-2 outline-none hover:bg-accent/60",
              selected && "bg-accent",
              active && "font-medium",
            )}
          >
            {isContainer ? (
              <>
                <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
                <ContainerIcon className="size-4 shrink-0 text-muted-foreground" />
              </>
            ) : (
              <MethodBadge method={node.method} soap={node.requestType === "soap"} className="ml-4.5 text-right" />
            )}
            {renaming ? (
              <InlineRename name={node.name} onDone={(name) => (name ? renameNode(node.id, name) : setRenaming(null))} />
            ) : (
              <span className="min-w-0 flex-1 truncate pl-1">{node.name}</span>
            )}
            {dirty && <span className="size-2 shrink-0 rounded-full bg-foreground/60" aria-label="Unsaved changes" />}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {isContainer ? (
            <>
              <ContextMenuItem onSelect={() => createRequest(node.id, "http")}>
                <FilePlus2 /> New request
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => createRequest(node.id, "soap")}>
                <FilePlus2 /> New SOAP request
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => createFolder(node.id)}>
                <FolderPlus /> New folder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => openTab(node.id, "container", false)}>
                <Settings2 /> Settings…
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => openTab(node.id, "request", false)}>Open</ContextMenuItem>
              <ContextMenuItem shortcut="Ctrl+D" onSelect={() => duplicateRequest(node.id)}>
                <Copy /> Duplicate
              </ContextMenuItem>
            </>
          )}
          <ContextMenuItem shortcut="F2" onSelect={() => setRenaming(node.id)}>
            <Pencil /> Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" shortcut="Del" onSelect={() => onDelete(node)}>
            <Trash2 /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open &&
        node.children.map((child) => (
          <TreeItem
            key={child.id}
            node={child}
            depth={depth + 1}
            forceExpanded={forceExpanded}
            selectedId={selectedId}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

function InlineRename({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    const trimmed = result?.trim();
    onDone(trimmed && trimmed !== name ? trimmed : null);
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value)}
      spellCheck={false}
      className="h-6 min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 outline-none"
    />
  );
}
