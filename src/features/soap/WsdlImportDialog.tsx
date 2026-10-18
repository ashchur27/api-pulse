import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorText } from "@/ipc/commands";
import { activeEnvironmentId } from "@/stores/environments";
import { useWorkspace } from "@/stores/workspace";

export async function pickWsdlFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "WSDL", extensions: ["wsdl", "xml", "svc"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export function WsdlImportDialog({ open: isOpen, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [source, setSource] = useState("");
  const [verifyTls, setVerifyTls] = useState(true);
  const [busy, setBusy] = useState(false);
  const workspaceId = useWorkspace((s) => s.tree?.id);

  const submit = async () => {
    if (!source.trim()) return;
    setBusy(true);
    try {
      const created = await api.wsdlImport(source.trim(), activeEnvironmentId(workspaceId), verifyTls);
      const ws = useWorkspace.getState();
      ws.setTree(created.tree);
      ws.setExpanded(created.id, true);
      toast.success("WSDL imported");
      onOpenChange(false);
      setSource("");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Import WSDL</DialogTitle>
            <DialogDescription>
              Creates a collection with one SOAP request per operation and ready-to-edit envelopes. WSDL 1.1, SOAP 1.1 and 1.2, document and rpc
              literal. Variables like {"{{baseUrl}}"} are resolved with the active environment.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              autoFocus
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://host/Service.svc?wsdl or C:\path\service.wsdl"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const path = await pickWsdlFile();
                if (path) setSource(path);
              }}
            >
              <FolderOpen /> File
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!verifyTls} onChange={(e) => setVerifyTls(!e.target.checked)} className="accent-primary" />
            Ignore TLS certificate errors (self-signed test servers)
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !source.trim()}>
              {busy && <Loader2 className="animate-spin" />} Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
