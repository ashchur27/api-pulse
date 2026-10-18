import { cn } from "@/lib/utils";

const methodColor: Record<string, string> = {
  GET: "text-method-get",
  POST: "text-method-post",
  PUT: "text-method-put",
  PATCH: "text-method-patch",
  DELETE: "text-method-delete",
};

export function MethodBadge({
  method,
  soap,
  className,
}: {
  method?: string;
  soap?: boolean;
  className?: string;
}) {
  const label = soap ? "SOAP" : (method ?? "GET").toUpperCase();
  const color = soap ? "text-method-soap" : (methodColor[label] ?? "text-method-other");
  return (
    <span className={cn("inline-block w-10 shrink-0 font-mono text-[10px] font-bold tracking-tight", color, className)}>
      {label === "DELETE" ? "DEL" : label === "OPTIONS" ? "OPT" : label}
    </span>
  );
}
