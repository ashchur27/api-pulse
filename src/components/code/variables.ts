import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { ScopeVar } from "@/ipc/types";

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const DYNAMIC = ["$uuid", "$timestamp", "$timestampMs", "$isoDate", "$randomInt(0,1000)", "$randomString(10)", "$randomEmail"];

const marks = {
  ok: Decoration.mark({ class: "cm-var cm-var-ok" }),
  missing: Decoration.mark({ class: "cm-var cm-var-missing" }),
  dynamic: Decoration.mark({ class: "cm-var cm-var-dynamic" }),
};

export function displayValue(v: ScopeVar): string {
  if (v.secret) return "••••••";
  return typeof v.value === "string" ? v.value : JSON.stringify(v.value);
}

export function variablesExtension(vars: ScopeVar[]): Extension {
  const byKey = new Map(vars.map((v) => [v.key, v]));

  const matcher = new MatchDecorator({
    regexp: VAR_RE,
    decoration: (m) => (m[1].startsWith("$") ? marks.dynamic : byKey.has(m[1]) ? marks.ok : marks.missing),
  });

  const highlighter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );

  const hover = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(VAR_RE)) {
      const from = line.from + (m.index ?? 0);
      const to = from + m[0].length;
      if (pos < from || pos > to) continue;
      const name = m[1];
      const v = byKey.get(name);
      return {
        pos: from,
        end: to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.style.cssText = "padding:6px 8px;max-width:420px;font-size:12px";
          const title = document.createElement("div");
          title.style.fontWeight = "600";
          title.textContent = name;
          const body = document.createElement("div");
          body.style.cssText = "font-family:var(--code-font);word-break:break-all;margin-top:2px";
          const meta = document.createElement("div");
          meta.style.cssText = "color:var(--muted-foreground);margin-top:4px";
          if (name.startsWith("$")) {
            body.textContent = "Dynamic value, generated on send";
          } else if (v) {
            body.textContent = displayValue(v) || "(empty)";
            meta.textContent = `from ${v.source}`;
          } else {
            body.textContent = "Not defined in the current scope";
            body.style.color = "var(--var-missing)";
          }
          dom.append(title, body, meta);
          return { dom };
        },
      };
    }
    return null;
  });

  const source = (ctx: CompletionContext) => {
    const before = ctx.matchBefore(/\{\{\s*[\w.$-]*$/);
    if (!before) return null;
    const word = before.text.match(/[\w.$-]*$/)?.[0] ?? "";
    const from = ctx.pos - word.length;
    const apply = (key: string) => (view: EditorView, _c: Completion, start: number, end: number) => {
      const closed = view.state.sliceDoc(end, end + 2) === "}}";
      const insert = closed ? key : `${key}}}`;
      view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length + (closed ? 2 : 0) } });
    };
    const options: Completion[] = [
      ...vars.map((v) => ({ label: v.key, detail: v.source, info: displayValue(v), type: "variable", apply: apply(v.key) })),
      ...DYNAMIC.map((d) => ({ label: d, detail: "dynamic", type: "function", apply: apply(d) })),
    ];
    return { from, options, validFor: /^[\w.$-]*$/ };
  };

  return [highlighter, hover, autocompletion({ override: [source], icons: false })];
}
