import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Trash2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code/CodeEditor";
import { EmptyState } from "@/components/common/EmptyState";
import { KeyValueTable } from "@/components/common/KeyValueTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Body, MultipartField, ScopeVar } from "@/ipc/types";
import { prettyJson, prettyXml } from "@/lib/format";
import { cn } from "@/lib/utils";

type BodyType = Body["type"];

const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: "none", label: "None" },
  { id: "json", label: "JSON" },
  { id: "xml", label: "XML" },
  { id: "text", label: "Text" },
  { id: "formUrlEncoded", label: "Form URL-encoded" },
  { id: "multipart", label: "Multipart" },
  { id: "binary", label: "Binary file" },
];

function convert(body: Body | undefined, type: BodyType): Body {
  const raw = body && "raw" in body ? body.raw : "";
  switch (type) {
    case "json":
    case "xml":
    case "text":
      return { type, raw };
    case "formUrlEncoded":
      return { type, fields: body?.type === "multipart" ? body.fields.filter((f) => f.kind === "text").map((f) => ({ key: f.key, value: f.value ?? "", enabled: f.enabled })) : [] };
    case "multipart":
      return { type, fields: body?.type === "formUrlEncoded" ? body.fields.map((f) => ({ ...f, kind: "text" as const })) : [] };
    case "binary":
      return { type, filePath: "" };
    default:
      return { type: "none" };
  }
}

async function pickFile(): Promise<string | null> {
  const selected = await open({ multiple: false, directory: false });
  return typeof selected === "string" ? selected : null;
}

export function BodyEditor({
  body,
  onChange,
  vars,
}: {
  body?: Body;
  onChange: (body: Body) => void;
  vars?: ScopeVar[];
}) {
  const current = body ?? { type: "none" as const };

  const beautify = () => {
    if (current.type !== "json" && current.type !== "xml") return;
    const pretty = current.type === "json" ? prettyJson(current.raw) : prettyXml(current.raw);
    if (pretty === null) toast.error(`Body is not valid ${current.type.toUpperCase()}`);
    else onChange({ ...current, raw: pretty });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 px-2 pt-2">
        {BODY_TYPES.map((t) => (
          <Button key={t.id} size="sm" variant={t.id === current.type ? "secondary" : "ghost"} onClick={() => onChange(convert(body, t.id))}>
            {t.label}
          </Button>
        ))}
        {(current.type === "json" || current.type === "xml") && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={beautify} title="Beautify (Shift+Alt+F)">
            <WandSparkles /> Beautify
          </Button>
        )}
      </div>
      <div
        className="min-h-0 flex-1"
        onKeyDown={(e) => {
          if (e.shiftKey && e.altKey && e.key.toLowerCase() === "f") {
            e.preventDefault();
            beautify();
          }
        }}
      >
        {current.type === "none" && <EmptyState title="This request has no body" />}
        {(current.type === "json" || current.type === "xml" || current.type === "text") && (
          <div className="h-full p-2">
            <div className="h-full overflow-hidden rounded-md border">
              <CodeEditor
                value={current.raw}
                onChange={(raw) => onChange({ ...current, raw })}
                language={current.type === "text" ? "text" : current.type}
                vars={vars}
              />
            </div>
          </div>
        )}
        {current.type === "formUrlEncoded" && (
          <KeyValueTable items={current.fields} onChange={(fields) => onChange({ ...current, fields })} />
        )}
        {current.type === "multipart" && (
          <MultipartTable fields={current.fields} onChange={(fields) => onChange({ ...current, fields })} />
        )}
        {current.type === "binary" && (
          <div className="flex max-w-2xl items-center gap-2 p-4">
            <Input
              value={current.filePath}
              onChange={(e) => onChange({ ...current, filePath: e.target.value })}
              placeholder="Path to file"
              className="font-mono"
            />
            <Button
              variant="outline"
              onClick={async () => {
                const path = await pickFile();
                if (path) onChange({ ...current, filePath: path });
              }}
            >
              <FolderOpen /> Browse
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MultipartTable({ fields, onChange }: { fields: MultipartField[]; onChange: (fields: MultipartField[]) => void }) {
  const rows: MultipartField[] = [...fields, { key: "", kind: "text", value: "", enabled: true }];
  const update = (i: number, patch: Partial<MultipartField>) => {
    if (i === fields.length) onChange([...fields, { ...rows[i], ...patch }]);
    else onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };
  const cell = "h-7 w-full bg-transparent px-2 font-mono outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40";

  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="w-8" />
          <th className="w-[30%] px-2 py-1 font-medium">Key</th>
          <th className="w-20 px-2 py-1 font-medium">Type</th>
          <th className="px-2 py-1 font-medium">Value</th>
          <th className="w-36 px-2 py-1 font-medium">Content-Type</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {rows.map((f, i) => {
          const phantom = i === fields.length;
          return (
            <tr key={i} className="group border-t">
              <td className="text-center">
                {!phantom && (
                  <input type="checkbox" checked={f.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} className="accent-primary" />
                )}
              </td>
              <td className="border-l">
                <input value={f.key} placeholder={phantom ? "Add key" : ""} onChange={(e) => update(i, { key: e.target.value })} className={cell} />
              </td>
              <td className="border-l px-1">
                <NativeSelect value={f.kind} onChange={(e) => update(i, { kind: e.target.value as "text" | "file" })} className="w-full [&_select]:h-6 [&_select]:text-xs">
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </NativeSelect>
              </td>
              <td className="border-l">
                {f.kind === "text" ? (
                  <input value={f.value ?? ""} onChange={(e) => update(i, { value: e.target.value })} className={cell} />
                ) : (
                  <div className="flex items-center">
                    <input value={f.filePath ?? ""} placeholder="File path" onChange={(e) => update(i, { filePath: e.target.value })} className={cell} />
                    <button
                      aria-label="Browse"
                      className="px-1 text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        const path = await pickFile();
                        if (path) update(i, { filePath: path });
                      }}
                    >
                      <FolderOpen className="size-3.5" />
                    </button>
                  </div>
                )}
              </td>
              <td className="border-l">
                <input value={f.contentType ?? ""} placeholder="auto" onChange={(e) => update(i, { contentType: e.target.value })} className={cell} />
              </td>
              <td className="text-center">
                {!phantom && (
                  <button
                    aria-label="Remove"
                    onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
                    className={cn("rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
