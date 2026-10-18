import { ListPlus, Table2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { KeyValue } from "@/ipc/types";
import { cn } from "@/lib/utils";

export function toBulk(items: KeyValue[]): string {
  return items.map((kv) => `${kv.enabled ? "" : "//"}${kv.key}: ${kv.value}`).join("\n");
}

export function fromBulk(text: string): KeyValue[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const disabled = line.trimStart().startsWith("//");
      const body = disabled ? line.trimStart().slice(2) : line;
      const idx = body.indexOf(":");
      const key = (idx < 0 ? body : body.slice(0, idx)).trim();
      const value = idx < 0 ? "" : body.slice(idx + 1).trim();
      return { key, value, enabled: !disabled };
    });
}

interface KeyValueTableProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  keySuggestions?: string[];
  fixedKeys?: boolean;
  allowBulk?: boolean;
  className?: string;
}

export function KeyValueTable({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  keySuggestions,
  fixedKeys = false,
  allowBulk = true,
  className,
}: KeyValueTableProps) {
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const listId = keySuggestions ? `kv-suggest-${keySuggestions.length}` : undefined;

  const update = (index: number, patch: Partial<KeyValue>) => {
    if (index === items.length) {
      onChange([...items, { key: "", value: "", enabled: true, ...patch }]);
      return;
    }
    onChange(items.map((kv, i) => (i === index ? { ...kv, ...patch } : kv)));
  };
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const rows = fixedKeys ? items : [...items, { key: "", value: "", enabled: true }];

  return (
    <div className={cn("flex flex-col", className)}>
      {allowBulk && !fixedKeys && (
        <div className="flex justify-end px-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!bulk) setBulkText(toBulk(items));
              else onChange(fromBulk(bulkText));
              setBulk(!bulk);
            }}
          >
            {bulk ? <Table2 /> : <ListPlus />}
            {bulk ? "Key-value edit" : "Bulk edit"}
          </Button>
        </div>
      )}
      {bulk ? (
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          onBlur={() => onChange(fromBulk(bulkText))}
          spellCheck={false}
          placeholder={"key: value\n//disabled: value"}
          className="m-2 min-h-40 flex-1 resize-none rounded-md border bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring"
        />
      ) : (
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="w-8" />
              <th className="w-[35%] px-2 py-1 font-medium">{keyPlaceholder}</th>
              <th className="px-2 py-1 font-medium">{valuePlaceholder}</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((kv, i) => {
              const phantom = !fixedKeys && i === items.length;
              return (
                <tr key={i} className="group border-t">
                  <td className="text-center">
                    {!phantom && (
                      <input
                        type="checkbox"
                        aria-label="Enabled"
                        checked={kv.enabled}
                        onChange={(e) => update(i, { enabled: e.target.checked })}
                        className="accent-primary"
                      />
                    )}
                  </td>
                  <td className="border-l">
                    <input
                      value={kv.key}
                      readOnly={fixedKeys}
                      list={listId}
                      placeholder={phantom ? `Add ${keyPlaceholder.toLowerCase()}` : ""}
                      onChange={(e) => update(i, { key: e.target.value })}
                      spellCheck={false}
                      className={cn(
                        "h-7 w-full bg-transparent px-2 font-mono outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40",
                        !kv.enabled && !phantom && "text-muted-foreground line-through",
                      )}
                    />
                  </td>
                  <td className="border-l">
                    <input
                      value={kv.value}
                      placeholder={phantom ? valuePlaceholder : ""}
                      onChange={(e) => update(i, { value: e.target.value })}
                      spellCheck={false}
                      className={cn(
                        "h-7 w-full bg-transparent px-2 font-mono outline-none placeholder:text-muted-foreground/60 focus:bg-accent/40",
                        !kv.enabled && !phantom && "text-muted-foreground",
                      )}
                    />
                  </td>
                  <td className="text-center">
                    {!phantom && !fixedKeys && (
                      <button
                        aria-label="Remove"
                        onClick={() => remove(i)}
                        className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
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
      )}
      {listId && (
        <datalist id={listId}>
          {keySuggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}
