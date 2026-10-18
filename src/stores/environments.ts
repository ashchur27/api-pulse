import { toast } from "sonner";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, errorText } from "@/ipc/commands";
import type { Environment, Environments } from "@/ipc/types";

interface EnvironmentsState {
  data: Environments | null;
  activeByWorkspace: Record<string, string | null>;
  version: number;
  setData: (data: Environments) => void;
  setActive: (workspaceId: string, id: string | null) => void;
  reset: () => void;
}

export const useEnvironments = create<EnvironmentsState>()(
  persist(
    (set, get) => ({
      data: null,
      activeByWorkspace: {},
      version: 0,
      setData: (data) => set({ data, version: get().version + 1 }),
      setActive: (workspaceId, id) =>
        set({ activeByWorkspace: { ...get().activeByWorkspace, [workspaceId]: id }, version: get().version + 1 }),
      reset: () => set({ data: null }),
    }),
    {
      name: "api-pulse:environments",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ activeByWorkspace }) => ({ activeByWorkspace }),
    },
  ),
);

export function activeEnvironmentId(workspaceId: string | undefined): string | null {
  if (!workspaceId) return null;
  const state = useEnvironments.getState();
  const id = state.activeByWorkspace[workspaceId] ?? null;
  if (id && state.data && !state.data.environments.some((e) => e.id === id)) return null;
  return id;
}

export function useActiveEnvironment(workspaceId: string | undefined): Environment | null {
  return useEnvironments((s) => {
    const id = workspaceId ? s.activeByWorkspace[workspaceId] : null;
    return s.data?.environments.find((e) => e.id === id) ?? null;
  });
}

async function apply(action: () => Promise<Environments>): Promise<Environments | undefined> {
  try {
    const data = await action();
    useEnvironments.getState().setData(data);
    return data;
  } catch (e) {
    toast.error(errorText(e));
    return undefined;
  }
}

export const loadEnvironments = () => apply(api.environmentsList);

export async function createEnvironment(name: string): Promise<string | undefined> {
  const before = new Set(useEnvironments.getState().data?.environments.map((e) => e.id));
  const data = await apply(() => api.environmentCreate(name));
  return data?.environments.find((e) => !before.has(e.id))?.id;
}

export async function saveEnvironment(env: Environment): Promise<boolean> {
  return !!(await apply(() => api.environmentSave(env)));
}

export async function deleteEnvironment(id: string): Promise<boolean> {
  return !!(await apply(() => api.environmentDelete(id)));
}

export function findEnvironment(data: Environments | null, id: string): Environment | undefined {
  if (!data) return undefined;
  return data.globals.id === id ? data.globals : data.environments.find((e) => e.id === id);
}
