import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CodeEditor } from "@/components/code/CodeEditor";
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
import { NativeSelect } from "@/components/ui/native-select";
import { api, errorText } from "@/ipc/commands";
import type { RequestDef, WsdlInfo } from "@/ipc/types";
import { activeEnvironmentId } from "@/stores/environments";
import { useTabs } from "@/stores/tabs";
import { useWorkspace } from "@/stores/workspace";

interface WsdlRef {
  source?: string;
  service?: string;
  port?: string;
}

export function WsdlOperationDialog({
  request,
  open,
  onOpenChange,
}: {
  request: RequestDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const ref = (request.soap?.wsdl ?? {}) as WsdlRef;
  const workspaceId = useWorkspace((s) => s.tree?.id);
  const update = useTabs((s) => s.updateDraft);
  const [source, setSource] = useState(ref.source ?? (request.url ? `${request.url}?wsdl` : ""));
  const [info, setInfo] = useState<WsdlInfo>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [portKey, setPortKey] = useState("");
  const [operation, setOperation] = useState(request.soap?.operation ?? "");
  const [replaceUrl, setReplaceUrl] = useState(!request.url);

  const ports = useMemo(
    () => info?.services.flatMap((s) => s.ports.map((p) => ({ key: `${s.name}/${p.name}`, service: s.name, port: p }))) ?? [],
    [info],
  );
  const selectedPort = ports.find((p) => p.key === portKey) ?? ports[0];
  const selectedOp = selectedPort?.port.operations.find((o) => o.name === operation) ?? selectedPort?.port.operations[0];

  const load = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.wsdlInspect(source.trim(), activeEnvironmentId(workspaceId), request.settings.verifyTls !== false);
      setInfo(result);
      const match = result.services.flatMap((s) => s.ports.map((p) => `${s.name}/${p.name}`)).find((k) => k === `${ref.service}/${ref.port}`);
      if (match) setPortKey(match);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open && source && !info) load();
  }, [open]);

  const apply = () => {
    if (!selectedPort || !selectedOp) return;
    update(request.id, (d) => ({
      ...d,
      url: replaceUrl ? selectedPort.port.address : d.url,
      envelope: selectedOp.envelope,
      soap: {
        ...d.soap,
        version: selectedPort.port.soapVersion,
        action: selectedOp.action,
        operation: selectedOp.name,
        wsdl: { source: source.trim(), service: selectedPort.service, port: selectedPort.port.name },
      },
    }));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate envelope from WSDL</DialogTitle>
          <DialogDescription>Replaces the current envelope, SOAPAction and SOAP version with the selected operation.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="WSDL URL or file path" className="font-mono" />
          <Button variant="outline" onClick={load} disabled={busy || !source.trim()}>
            {busy && <Loader2 className="animate-spin" />} Load
          </Button>
        </div>
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">{error}</div>}
        {info && selectedPort && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect value={selectedPort.key} onChange={(e) => setPortKey(e.target.value)} aria-label="Port">
                {ports.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.service} / {p.port.name} (SOAP {p.port.soapVersion})
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={selectedOp?.name ?? ""} onChange={(e) => setOperation(e.target.value)} aria-label="Operation">
                {selectedPort.port.operations.map((o) => (
                  <option key={o.name} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="h-72 overflow-hidden rounded-md border">
              <CodeEditor value={selectedOp?.envelope ?? ""} readOnly language="xml" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={replaceUrl} onChange={(e) => setReplaceUrl(e.target.checked)} className="accent-primary" />
              Use endpoint from WSDL: <span className="font-mono text-xs">{selectedPort.port.address}</span>
            </label>
            {info.warnings.length > 0 && <div className="text-xs text-amber-600 dark:text-amber-400">{info.warnings.join(" · ")}</div>}
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!selectedOp}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
