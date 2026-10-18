import { toast } from "sonner";
import { create } from "zustand";
import { api, errorText } from "@/ipc/commands";
import type { HistoryEntry } from "@/ipc/types";

interface HistoryState {
  entries: HistoryEntry[];
  setEntries: (entries: HistoryEntry[]) => void;
}

export const useHistory = create<HistoryState>()((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
}));

export async function loadHistory() {
  try {
    useHistory.getState().setEntries(await api.historyList());
  } catch {
    useHistory.getState().setEntries([]);
  }
}

export async function clearHistory() {
  try {
    await api.historyClear();
    useHistory.getState().setEntries([]);
  } catch (e) {
    toast.error(errorText(e));
  }
}
