import { Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { QueryResult } from "@/ipc/types";
import { cn } from "@/lib/utils";

function display(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = display(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(result: QueryResult): string {
  return [result.columns.map((c) => csvCell(c.name)).join(","), ...result.rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

export function toJson(result: QueryResult): string {
  return JSON.stringify(
    result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c.name, r[i] ?? null]))),
    null,
    2,
  );
}

export function ResultGrid({ result }: { result: QueryResult }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [selected, setSelected] = useState<[number, number] | null>(null);

  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const copy = [...result.rows];
    copy.sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      if (x === y) return 0;
      if (x === null || x === undefined) return -sort.dir;
      if (y === null || y === undefined) return sort.dir;
      if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
      return display(x).localeCompare(display(y), undefined, { numeric: true }) * sort.dir;
    });
    return copy;
  }, [result.rows, sort]);

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1 text-xs text-muted-foreground">
        <span>
          {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
          {result.truncated && <span className="ml-1 text-amber-600 dark:text-amber-400">(limited — raise the row limit to see more)</span>}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => copy(toCsv(result), "CSV")}>
          <Copy /> CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={() => copy(toJson(result), "JSON")}>
          <Copy /> JSON
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selected) {
            e.preventDefault();
            copy(display(rows[selected[0]][selected[1]]), "Cell");
          }
        }}
      >
        <table className="border-separate border-spacing-0 font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-sidebar">
            <tr>
              <th className="sticky left-0 z-20 border-r border-b bg-sidebar px-2 py-1 text-right font-normal text-muted-foreground">#</th>
              {result.columns.map((c, i) => (
                <th
                  key={i}
                  title={c.dbType}
                  onClick={() => setSort(sort?.col === i ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })}
                  className="cursor-pointer border-r border-b px-2 py-1 text-left font-semibold whitespace-nowrap hover:bg-accent"
                >
                  {c.name}
                  {sort?.col === i && <span className="ml-1 text-muted-foreground">{sort.dir === 1 ? "▲" : "▼"}</span>}
                  <div className="font-sans text-[10px] font-normal text-muted-foreground">{c.dbType}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="hover:bg-accent/40">
                <td className="sticky left-0 border-r border-b bg-background px-2 py-0.5 text-right text-muted-foreground">{r + 1}</td>
                {row.map((v, c) => (
                  <td
                    key={c}
                    onClick={() => setSelected([r, c])}
                    onDoubleClick={() => copy(display(v), "Cell")}
                    title={display(v).length > 60 ? display(v) : undefined}
                    className={cn(
                      "max-w-96 truncate border-r border-b px-2 py-0.5 whitespace-nowrap",
                      (v === null || v === undefined) && "text-muted-foreground italic",
                      typeof v === "number" && "text-right",
                      selected?.[0] === r && selected?.[1] === c && "bg-ring/25 outline outline-1 outline-ring",
                    )}
                  >
                    {display(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
