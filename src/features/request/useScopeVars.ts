import { useEffect, useState } from "react";
import { api } from "@/ipc/commands";
import type { ScopeVar } from "@/ipc/types";
import { activeEnvironmentId, useEnvironments } from "@/stores/environments";
import { useWorkspace } from "@/stores/workspace";

export function useScopeVars(requestId: string | null): ScopeVar[] | undefined {
  const workspaceId = useWorkspace((s) => s.tree?.id);
  const tree = useWorkspace((s) => s.tree);
  const version = useEnvironments((s) => s.version);
  const [vars, setVars] = useState<ScopeVar[]>();

  useEffect(() => {
    let cancelled = false;
    api
      .variablesScope(requestId, activeEnvironmentId(workspaceId))
      .then((v) => !cancelled && setVars(v))
      .catch(() => !cancelled && setVars([]));
    return () => {
      cancelled = true;
    };
  }, [requestId, workspaceId, version, tree]);

  return vars;
}
