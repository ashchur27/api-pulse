import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { RequestSettings } from "@/ipc/types";

function TriState({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <NativeSelect
      value={value === null ? "inherit" : value ? "on" : "off"}
      onChange={(e) => onChange(e.target.value === "inherit" ? null : e.target.value === "on")}
      className="w-48"
    >
      <option value="inherit">Workspace default</option>
      <option value="on">On</option>
      <option value="off">Off</option>
    </NativeSelect>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function SettingsEditor({
  settings,
  onChange,
}: {
  settings: RequestSettings;
  onChange: (settings: RequestSettings) => void;
}) {
  return (
    <div className="max-w-2xl space-y-5 p-4">
      <Row label="Timeout" hint="Milliseconds. Empty = workspace default (30 000).">
        <Input
          type="number"
          min={1}
          value={settings.timeoutMs ?? ""}
          placeholder="30000"
          onChange={(e) => onChange({ ...settings, timeoutMs: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })}
          className="w-48"
        />
      </Row>
      <Row label="Follow redirects" hint="Up to 10 redirects.">
        <TriState value={settings.followRedirects} onChange={(followRedirects) => onChange({ ...settings, followRedirects })} />
      </Row>
      <Row label="Verify TLS certificates" hint="Turn off only for test servers with self-signed certificates.">
        <TriState value={settings.verifyTls} onChange={(verifyTls) => onChange({ ...settings, verifyTls })} />
      </Row>
      {settings.verifyTls === false && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          Certificate verification is disabled for this request. Responses can be intercepted without warning.
        </p>
      )}
    </div>
  );
}
