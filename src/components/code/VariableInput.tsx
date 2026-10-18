import { CodeEditor } from "@/components/code/CodeEditor";
import type { ScopeVar } from "@/ipc/types";
import { cn } from "@/lib/utils";

export function VariableInput({
  value,
  onChange,
  vars,
  onEnter,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  vars?: ScopeVar[];
  onEnter?: () => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-input px-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40 [&_.cm-content]:py-0 [&_.cm-editor]:w-full [&_.cm-line]:px-0.5 [&_.cm-scroller]:overflow-x-auto [&_.cm-scroller]:[scrollbar-width:none]",
        className,
      )}
    >
      <CodeEditor value={value} onChange={onChange} vars={vars} singleLine onEnter={onEnter} placeholder={placeholder} className="w-full" />
    </div>
  );
}
