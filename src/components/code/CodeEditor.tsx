import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo, useRef } from "react";
import type { ScopeVar } from "@/ipc/types";
import type { BodyLanguage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { editorTheme, highlightStyle } from "./theme";
import { variablesExtension } from "./variables";

const languages: Record<BodyLanguage, () => Extension> = {
  json: () => json(),
  xml: () => xml(),
  html: () => html(),
  text: () => [],
};

const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
  const text = tr.newDoc.toString().replace(/\r?\n/g, "");
  return [{ changes: { from: 0, to: tr.startState.doc.length, insert: text }, selection: { anchor: text.length } }];
});

const multiLineSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: true,
  autocompletion: false,
  searchKeymap: true,
};

const singleLineSetup = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false,
  searchKeymap: false,
};

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: BodyLanguage;
  readOnly?: boolean;
  vars?: ScopeVar[];
  singleLine?: boolean;
  wrap?: boolean;
  onEnter?: () => void;
  placeholder?: string;
  className?: string;
  extensions?: Extension[];
  onView?: (view: EditorView) => void;
}

export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly = false,
  vars,
  singleLine: isSingleLine = false,
  wrap = false,
  onEnter,
  placeholder,
  className,
  extensions: extra,
  onView,
}: CodeEditorProps) {
  const enterRef = useRef(onEnter);
  enterRef.current = onEnter;

  const extensions = useMemo(() => {
    const ext: Extension[] = [editorTheme, syntaxHighlighting(highlightStyle), languages[language]()];
    if (vars) ext.push(variablesExtension(vars));
    if (placeholder) ext.push(placeholderExt(placeholder));
    if (wrap) ext.push(EditorView.lineWrapping);
    if (extra) ext.push(...extra);
    if (!isSingleLine) ext.push(Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => true }])));
    if (isSingleLine) {
      ext.push(
        singleLine,
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: () => {
                enterRef.current?.();
                return true;
              },
            },
          ]),
        ),
      );
    }
    return ext;
  }, [language, vars, placeholder, wrap, isSingleLine, extra]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onCreateEditor={onView}
      editable={!readOnly}
      readOnly={readOnly}
      theme="none"
      basicSetup={isSingleLine ? singleLineSetup : multiLineSetup}
      extensions={extensions}
      height="100%"
      className={cn("min-h-0 overflow-hidden", className)}
    />
  );
}
