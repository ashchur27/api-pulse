import { useEffect } from "react";
import { cancelRequest, sendRequest, useResponses } from "@/stores/responses";
import { useSettings } from "@/stores/settings";
import { useTabs } from "@/stores/tabs";
import { saveRequest } from "@/stores/workspace";

export function useGlobalHotkeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tabs = useTabs.getState();
      const active = tabs.tabs.find((t) => t.id === tabs.activeId);
      if (e.key === "Escape" && active?.kind === "request" && !document.querySelector("[role=dialog]")) {
        if (useResponses.getState().runs[active.id]?.status === "loading") {
          e.preventDefault();
          cancelRequest(active.id);
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "enter") {
        e.preventDefault();
        if (active?.kind === "request") sendRequest(active.id);
      } else if (key === "s") {
        e.preventDefault();
        if (active?.kind === "request") saveRequest(active.id);
      } else if (key === "w") {
        e.preventDefault();
        if (tabs.activeId) tabs.requestClose([tabs.activeId]);
      } else if (key === "b") {
        e.preventDefault();
        useSettings.getState().toggleSidebar();
      } else if (key === "tab") {
        e.preventDefault();
        tabs.cycle(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
