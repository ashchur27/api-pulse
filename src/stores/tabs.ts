import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { RequestDef } from "@/ipc/types";
import { closeTabs, cycleTab, idsToTheRight, openTab, pinTab, type TabKind, type TabsModel } from "@/lib/tabs";

export const SETTINGS_TAB_ID = "settings";

interface TabsState extends TabsModel {
  workspaceId: string | null;
  drafts: Record<string, RequestDef>;
  saved: Record<string, string>;
  pendingClose: string[];
  bindWorkspace: (workspaceId: string) => void;
  open: (id: string, kind: TabKind, preview?: boolean) => void;
  pin: (id: string) => void;
  activate: (id: string) => void;
  cycle: (direction: 1 | -1) => void;
  requestClose: (ids: string[]) => void;
  cancelClose: () => void;
  forceClose: (ids: string[]) => void;
  closeMissing: (existing: Set<string>) => void;
  loadRequest: (request: RequestDef) => void;
  updateDraft: (id: string, update: (draft: RequestDef) => RequestDef) => void;
  markSaved: (request: RequestDef) => void;
  renameDraft: (id: string, name: string) => void;
}

export function serialize(request: RequestDef): string {
  return JSON.stringify(request);
}

export function isDirty(state: Pick<TabsState, "drafts" | "saved">, id: string): boolean {
  const draft = state.drafts[id];
  return !!draft && state.saved[id] !== undefined && serialize(draft) !== state.saved[id];
}

function withoutKeys<T>(record: Record<string, T>, ids: string[]): Record<string, T> {
  const copy = { ...record };
  for (const id of ids) delete copy[id];
  return copy;
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      workspaceId: null,
      drafts: {},
      saved: {},
      pendingClose: [],
      bindWorkspace: (workspaceId) => {
        if (get().workspaceId !== workspaceId) {
          set({ workspaceId, tabs: [], activeId: null, drafts: {}, saved: {}, pendingClose: [] });
        }
      },
      open: (id, kind, preview = false) => set((s) => openTab(s, id, kind, preview)),
      pin: (id) => set((s) => pinTab(s, id)),
      activate: (id) => set({ activeId: id }),
      cycle: (direction) => set((s) => cycleTab(s, direction)),
      requestClose: (ids) => {
        const state = get();
        const dirty = ids.filter((id) => isDirty(state, id));
        const clean = ids.filter((id) => !isDirty(state, id));
        get().forceClose(clean);
        if (dirty.length) set({ pendingClose: dirty });
      },
      cancelClose: () => set({ pendingClose: [] }),
      forceClose: (ids) =>
        set((s) => ({
          ...closeTabs(s, ids),
          drafts: withoutKeys(s.drafts, ids),
          saved: withoutKeys(s.saved, ids),
          pendingClose: s.pendingClose.filter((id) => !ids.includes(id)),
        })),
      closeMissing: (existing) => {
        const missing = get()
          .tabs.filter((t) => (t.kind === "request" || t.kind === "container") && !existing.has(t.id))
          .map((t) => t.id);
        if (missing.length) get().forceClose(missing);
      },
      loadRequest: (request) =>
        set((s) => ({
          drafts: { ...s.drafts, [request.id]: request },
          saved: { ...s.saved, [request.id]: serialize(request) },
        })),
      updateDraft: (id, update) =>
        set((s) => {
          const draft = s.drafts[id];
          if (!draft) return s;
          return { ...pinTab(s, id), drafts: { ...s.drafts, [id]: update(draft) } };
        }),
      markSaved: (request) =>
        set((s) => ({
          drafts: { ...s.drafts, [request.id]: request },
          saved: { ...s.saved, [request.id]: serialize(request) },
        })),
      renameDraft: (id, name) =>
        set((s) => {
          const draft = s.drafts[id];
          const saved = s.saved[id];
          if (!draft || saved === undefined) return s;
          return {
            drafts: { ...s.drafts, [id]: { ...draft, name } },
            saved: { ...s.saved, [id]: serialize({ ...(JSON.parse(saved) as RequestDef), name }) },
          };
        }),
    }),
    {
      name: "api-pulse:tabs",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ tabs, activeId, workspaceId, drafts, saved }) => ({ tabs, activeId, workspaceId, drafts, saved }),
    },
  ),
);

export function closeOthers(id: string) {
  const { tabs, requestClose } = useTabs.getState();
  requestClose(tabs.filter((t) => t.id !== id).map((t) => t.id));
}

export function closeToTheRight(id: string) {
  const state = useTabs.getState();
  state.requestClose(idsToTheRight(state, id));
}

export function closeSaved() {
  const state = useTabs.getState();
  state.forceClose(state.tabs.filter((t) => !isDirty(state, t.id)).map((t) => t.id));
}
