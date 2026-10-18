import { create } from "zustand";
import { api, toAppError } from "@/ipc/commands";
import type { AppError, SendResult } from "@/ipc/types";
import { activeEnvironmentId } from "./environments";
import { loadHistory } from "./history";
import { useTabs } from "./tabs";
import { useWorkspace } from "./workspace";

export type RunState =
  | { status: "loading"; execId: string; startedAt: number }
  | { status: "done"; result: SendResult; finishedAt: number }
  | { status: "error"; error: AppError }
  | { status: "cancelled" };

interface ResponsesState {
  runs: Record<string, RunState>;
  set: (id: string, run: RunState) => void;
  clear: (id: string) => void;
}

export const useResponses = create<ResponsesState>()((set, get) => ({
  runs: {},
  set: (id, run) => set({ runs: { ...get().runs, [id]: run } }),
  clear: (id) => {
    const runs = { ...get().runs };
    delete runs[id];
    set({ runs });
  },
}));

export async function sendRequest(id: string) {
  const draft = useTabs.getState().drafts[id];
  const current = useResponses.getState().runs[id];
  if (!draft || current?.status === "loading") return;
  const execId = crypto.randomUUID();
  const { set } = useResponses.getState();
  set(id, { status: "loading", execId, startedAt: performance.now() });
  const environmentId = activeEnvironmentId(useWorkspace.getState().tree?.id);
  try {
    const result = await api.requestSend(execId, draft, environmentId);
    set(id, { status: "done", result, finishedAt: Date.now() });
  } catch (e) {
    const error = toAppError(e);
    set(id, error.code === "CANCELLED" ? { status: "cancelled" } : { status: "error", error });
  }
  loadHistory();
}

export async function cancelRequest(id: string) {
  const run = useResponses.getState().runs[id];
  if (run?.status === "loading") await api.requestCancel(run.execId);
}
