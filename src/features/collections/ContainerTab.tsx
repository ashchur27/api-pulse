import { Folder, Library, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/EmptyState";
import { KeyValueTable } from "@/components/common/KeyValueTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorText } from "@/ipc/commands";
import type { ContainerMeta } from "@/ipc/types";
import { AuthEditor } from "@/features/request/editors/AuthEditor";
import { useScopeVars } from "@/features/request/useScopeVars";
import { useEnvironments } from "@/stores/environments";
import { useWorkspace } from "@/stores/workspace";
import { findNode } from "@/lib/tree";

export function ContainerTab({ id }: { id: string }) {
  const node = useWorkspace((s) => findNode(s.tree, id));
  const setTree = useWorkspace((s) => s.setTree);
  const [saved, setSaved] = useState<ContainerMeta>();
  const [draft, setDraft] = useState<ContainerMeta>();
  const vars = useScopeVars(id);

  useEffect(() => {
    api
      .containerGet(id)
      .then((meta) => {
        setSaved(meta);
        setDraft(meta);
      })
      .catch((e) => toast.error(errorText(e)));
  }, [id]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  if (!draft) return <EmptyState title="Loading…" />;

  const isCollection = node?.kind === "collection";
  const set = (patch: Partial<ContainerMeta>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    try {
      setTree(await api.containerSave(draft));
      setSaved(draft);
      useEnvironments.setState((s) => ({ version: s.version + 1 }));
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  const count = (n?: number) => (n ? <span className="text-xs text-muted-foreground">({n})</span> : null);

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
        {isCollection ? <Library className="size-4 text-muted-foreground" /> : <Folder className="size-4 text-muted-foreground" />}
        <span className="font-medium">{draft.name}</span>
        <span className="text-xs text-muted-foreground">{isCollection ? "Collection settings" : "Folder settings"}</span>
        <div className="flex-1" />
        <Button size="sm" disabled={!dirty} onClick={save}>
          <Save /> Save
        </Button>
      </div>
      <Tabs defaultValue="variables" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="variables">Variables {count(draft.variables?.length)}</TabsTrigger>
          <TabsTrigger value="headers">Headers {count(draft.headers?.length)}</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-3 p-4">
          <label className="block max-w-2xl space-y-1">
            <span className="text-xs text-muted-foreground">Name (rename from the sidebar to also rename the folder on disk)</span>
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block max-w-2xl space-y-1">
            <span className="text-xs text-muted-foreground">Description</span>
            <textarea
              value={draft.description ?? ""}
              onChange={(e) => set({ description: e.target.value })}
              className="min-h-32 w-full resize-y rounded-md border bg-transparent p-2 text-sm outline-none focus-visible:border-ring"
            />
          </label>
        </TabsContent>
        <TabsContent value="variables">
          <KeyValueTable items={draft.variables ?? []} onChange={(variables) => set({ variables })} keyPlaceholder="Variable" />
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Available to every request inside. They override environment and global variables; nested folders override their parents.
          </p>
        </TabsContent>
        <TabsContent value="headers">
          <KeyValueTable items={draft.headers ?? []} onChange={(headers) => set({ headers })} />
          <p className="px-3 py-2 text-xs text-muted-foreground">Sent with every request inside unless a request sets the same header.</p>
        </TabsContent>
        <TabsContent value="auth">
          <AuthEditor auth={draft.auth} onChange={(auth) => set({ auth })} vars={vars} isCollection={isCollection} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
