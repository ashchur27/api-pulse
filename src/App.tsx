import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/features/layout/AppShell";
import { Welcome } from "@/features/workspace/Welcome";
import { useGlobalHotkeys } from "@/lib/hotkeys";
import { resolveTheme, useThemeEffect } from "@/lib/theme";
import { useSettings } from "@/stores/settings";
import { openWorkspace, useWorkspace } from "@/stores/workspace";

function useRestoreWorkspace() {
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    const last = useSettings.getState().lastWorkspace;
    if (!last) {
      setBooting(false);
      return;
    }
    openWorkspace(last, { silent: true }).then((ok) => {
      if (!ok) useSettings.getState().forgetWorkspace(last);
      setBooting(false);
    });
  }, []);
  return booting;
}

export function App() {
  useThemeEffect();
  useGlobalHotkeys();
  const booting = useRestoreWorkspace();
  const hasWorkspace = useWorkspace((s) => s.tree !== null);
  const theme = useSettings((s) => s.theme);

  return (
    <TooltipProvider delayDuration={400}>
      {booting ? (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : hasWorkspace ? (
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      ) : (
        <Welcome />
      )}
      <Toaster theme={resolveTheme(theme)} position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
