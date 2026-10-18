import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";
export type Activity = "collections" | "scenarios" | "environments" | "databases" | "history";

const MAX_RECENT = 8;

interface SettingsState {
  theme: Theme;
  sidebarVisible: boolean;
  activity: Activity;
  recentWorkspaces: string[];
  lastWorkspace: string | null;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  toggleSidebar: () => void;
  selectActivity: (activity: Activity) => void;
  rememberWorkspace: (path: string) => void;
  forgetWorkspace: (path: string) => void;
  clearLastWorkspace: () => void;
}

const nextTheme: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "system",
      sidebarVisible: true,
      activity: "collections",
      recentWorkspaces: [],
      lastWorkspace: null,
      setTheme: (theme) => set({ theme }),
      cycleTheme: () => set({ theme: nextTheme[get().theme] }),
      toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),
      selectActivity: (activity) => {
        const { activity: current, sidebarVisible } = get();
        if (current === activity && sidebarVisible) set({ sidebarVisible: false });
        else set({ activity, sidebarVisible: true });
      },
      rememberWorkspace: (path) =>
        set({
          lastWorkspace: path,
          recentWorkspaces: [path, ...get().recentWorkspaces.filter((p) => p !== path)].slice(0, MAX_RECENT),
        }),
      forgetWorkspace: (path) =>
        set({
          recentWorkspaces: get().recentWorkspaces.filter((p) => p !== path),
          lastWorkspace: get().lastWorkspace === path ? null : get().lastWorkspace,
        }),
      clearLastWorkspace: () => set({ lastWorkspace: null }),
    }),
    {
      name: "api-pulse:settings",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, sidebarVisible, activity, recentWorkspaces, lastWorkspace }) => ({
        theme,
        sidebarVisible,
        activity,
        recentWorkspaces,
        lastWorkspace,
      }),
    },
  ),
);
