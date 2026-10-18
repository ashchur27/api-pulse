import { Eye, EyeOff, Globe, Lock, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EnvVar, Environment } from "@/ipc/types";
import { cn } from "@/lib/utils";
import { deleteEnvironment, findEnvironment, saveEnvironment, useEnvironments } from "@/stores/environments";
import { useTabs } from "@/stores/tabs";

const empty: EnvVar = { key: "", value: "", enabled: true };

export function EnvironmentTab({ id }: { id: string }) {
  const data = useEnvironments((s) => s.data);
  const source = findEnvironment(data, id);
  const forceClose = useTabs((s) => s.forceClose);
  const [draft, setDraft] = useState<Environment | undefined>(source);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isGlobals = data?.globals.id === id;

  useEffect(() => setDraft(source), [source]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(source), [draft, source]);

  if (!data) return <EmptyState title="Loading…" />;
  if (!source || !draft) return <EmptyState title="Environment not found" />;

  const vars = [...draft.variables, empty];
  const update = (i: number, patch: Partial<EnvVar>) => {
    const variables = i === draft.variables.length ? [...draft.variables, { ...empty, ...patch }] : draft.variables.map((v, idx) => (idx === i ? { ...v, ...patch } : v));
    setDraft({ ...draft, variables });
  };
  const remove = (i: number) => setDraft({ ...draft, variables: draft.variables.filter((_, idx) => idx !== i) });
  const save = () => saveEnvironment({ ...draft, variables: draft.variables.filter((v) => v.key.trim()) });
  const cell = "h-7 w-full bg-transparent px-2 font-mono outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40";

  return (
    <div
      className="flex h-full flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          e.stopPropagation();
          if (dirty) save();
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b p-2">
        {isGlobals ? <Globe className="size-4 text-muted-foreground" /> : null}
        <Input
          value={draft.name}
          disabled={isGlobals}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-8 max-w-xs font-medium"
        />
        <div className="flex-1" />
        {!isGlobals && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        )}
        <Button size="sm" disabled={!dirty} onClick={save}>
          <Save /> Save
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="w-8" />
              <th className="w-[30%] px-2 py-1 font-medium">Variable</th>
              <th className="px-2 py-1 font-medium">Value</th>
              <th className="w-24 px-2 py-1 font-medium">Type</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {vars.map((v, i) => {
              const phantom = i === draft.variables.length;
              const secret = v.type === "secret";
              return (
                <tr key={i} className="group border-t">
                  <td className="text-center">
                    {!phantom && <input type="checkbox" checked={v.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} className="accent-primary" />}
                  </td>
                  <td className="border-l">
                    <input
                      value={v.key}
                      placeholder={phantom ? "Add variable" : ""}
                      onChange={(e) => update(i, { key: e.target.value })}
                      spellCheck={false}
                      className={cn(cell, !v.enabled && !phantom && "text-muted-foreground line-through")}
                    />
                  </td>
                  <td className="border-l">
                    <div className="flex items-center">
                      <input
                        type={secret && !revealed[i] ? "password" : "text"}
                        value={v.value}
                        onChange={(e) => update(i, { value: e.target.value })}
                        spellCheck={false}
                        className={cell}
                      />
                      {secret && (
                        <button
                          aria-label={revealed[i] ? "Hide value" : "Show value"}
                          onClick={() => setRevealed({ ...revealed, [i]: !revealed[i] })}
                          className="px-1.5 text-muted-foreground hover:text-foreground"
                        >
                          {revealed[i] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="border-l px-1">
                    {!phantom && (
                      <button
                        onClick={() => update(i, { type: secret ? "default" : "secret" })}
                        className={cn("flex h-6 items-center gap-1 rounded px-1.5 hover:bg-accent", secret && "text-amber-600 dark:text-amber-400")}
                        title={secret ? "Stored in the OS keychain, not in the file" : "Stored in the YAML file"}
                      >
                        {secret && <Lock className="size-3" />}
                        {secret ? "Secret" : "Default"}
                      </button>
                    )}
                  </td>
                  <td className="text-center">
                    {!phantom && (
                      <button aria-label="Remove" onClick={() => remove(i)} className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-3 py-3 text-xs text-muted-foreground">
          Secret values are kept in the OS keychain on this machine; only a reference is written to the workspace file, so it is safe to commit.
          {isGlobals ? " Globals apply to every environment." : ""}
        </p>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete environment "${source.name}"?`}
        description="The environment file and its secrets on this machine will be removed."
        onConfirm={async () => {
          if (await deleteEnvironment(id)) forceClose([id]);
        }}
      />
    </div>
  );
}
