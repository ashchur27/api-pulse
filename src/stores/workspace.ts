import { toast } from "sonner";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, errorText } from "@/ipc/commands";
import type { RequestKind, WorkspaceTree } from "@/ipc/types";
import { ancestorIds, collectIds } from "@/lib/tree";
import { loadEnvironments, useEnvironments } from "./environments";
import { loadHistory } from "./history";
import { useSettings } from "./settings";
import { useTabs } from "./tabs";

interface WorkspaceState {
  tree: WorkspaceTree | null;
  expanded: Record<string, boolean>;
  renamingId: string | null;
  setTree: (tree: WorkspaceTree) => void;
  setExpanded: (id: string, value: boolean) => void;
  reveal: (id: string) => void;
  setRenaming: (id: string | null) => void;
  close: () => void;
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tree: null,
      expanded: {},
      renamingId: null,
      setTree: (tree) => {
        set({ tree });
        useTabs.getState().closeMissing(collectIds(tree));
      },
      setExpanded: (id, value) => set({ expanded: { ...get().expanded, [id]: value } }),
      reveal: (id) => {
        const tree = get().tree;
        if (!tree) return;
        const expanded = { ...get().expanded };
        for (const a of ancestorIds(tree, id)) expanded[a] = true;
        set({ expanded });
      },
      setRenaming: (renamingId) => set({ renamingId }),
      close: () => {
        set({ tree: null, renamingId: null });
        useSettings.getState().clearLastWorkspace();
      },
    }),
    {
      name: "api-pulse:workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ expanded }) => ({ expanded }),
    },
  ),
);

async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (e) {
    toast.error(errorText(e));
    return undefined;
  }
}

function install(tree: WorkspaceTree, path: string) {
  useTabs.getState().bindWorkspace(tree.id);
  useWorkspace.getState().setTree(tree);
  useSettings.getState().rememberWorkspace(path);
  useEnvironments.getState().reset();
  loadEnvironments();
  loadHistory();
  if (tree.problems.length) {
    toast.warning(`${tree.problems.length} file(s) could not be read`, {
      description: tree.problems.slice(0, 3).map((p) => p.path).join(", "),
    });
  }
}

export async function openWorkspace(path: string, { silent = false } = {}): Promise<boolean> {
  try {
    install(await api.workspaceOpen(path), path);
    return true;
  } catch (e) {
    if (!silent) toast.error(errorText(e));
    return false;
  }
}

export async function createWorkspace(path: string, name: string): Promise<boolean> {
  const tree = await run(() => api.workspaceCreate(path, name));
  if (tree) install(tree, path);
  return !!tree;
}

export async function refreshWorkspace() {
  const tree = await run(() => api.workspaceTree());
  if (tree) useWorkspace.getState().setTree(tree);
}

function afterCreate(id: string, tree: WorkspaceTree, parentId?: string) {
  const ws = useWorkspace.getState();
  ws.setTree(tree);
  if (parentId) ws.setExpanded(parentId, true);
  ws.reveal(id);
  ws.setRenaming(id);
}

export async function createCollection() {
  const created = await run(() => api.collectionCreate("New Collection"));
  if (created) afterCreate(created.id, created.tree);
}

export async function createFolder(parentId: string) {
  const created = await run(() => api.folderCreate(parentId, "New Folder"));
  if (created) afterCreate(created.id, created.tree, parentId);
}

export async function createRequest(parentId: string, kind: RequestKind) {
  const name = kind === "soap" ? "New SOAP Request" : "New Request";
  const created = await run(() => api.requestCreate(parentId, name, kind));
  if (!created) return;
  afterCreate(created.id, created.tree, parentId);
  useTabs.getState().open(created.id, "request", false);
}

export async function duplicateRequest(id: string) {
  const created = await run(() => api.requestDuplicate(id));
  if (!created) return;
  useWorkspace.getState().setTree(created.tree);
  useWorkspace.getState().reveal(created.id);
  useTabs.getState().open(created.id, "request", false);
}

export async function renameNode(id: string, name: string) {
  useWorkspace.getState().setRenaming(null);
  const tree = await run(() => api.nodeRename(id, name));
  if (!tree) return;
  useTabs.getState().renameDraft(id, name.trim());
  useWorkspace.getState().setTree(tree);
}

export async function deleteNode(id: string) {
  const tree = await run(() => api.nodeDelete(id));
  if (tree) useWorkspace.getState().setTree(tree);
}

export async function loadRequest(id: string) {
  const request = await run(() => api.requestGet(id));
  if (request) useTabs.getState().loadRequest(request);
}

export async function saveRequest(id: string): Promise<boolean> {
  const draft = useTabs.getState().drafts[id];
  if (!draft) return false;
  const tree = await run(() => api.requestSave(draft));
  if (!tree) return false;
  useTabs.getState().markSaved(draft);
  useWorkspace.getState().setTree(tree);
  return true;
}
