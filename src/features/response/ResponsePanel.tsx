import { AlertTriangle, Ban, Copy, Loader2, Send, WrapText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code/CodeEditor";
import { EmptyState, Kbd } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import type { HttpResponse, SendResult } from "@/ipc/types";
import { detectLanguage, formatBytes, formatMs, prettyBody, soapFault, statusTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelRequest, useResponses } from "@/stores/responses";

const HIGHLIGHT_LIMIT = 2 * 1024 * 1024;

const toneClass = {
  success: "text-method-get",
  redirect: "text-method-put",
  client: "text-method-post",
  server: "text-method-delete",
  info: "text-muted-foreground",
};

export function ResponsePanel({ requestId }: { requestId: string }) {
  const run = useResponses((s) => s.runs[requestId]);

  if (!run) {
    return (
      <EmptyState
        icon={<Send />}
        title="Send a request to see the response"
        description={
          <>
            <Kbd>Ctrl+Enter</Kbd> to send, <Kbd>Esc</Kbd> to cancel
          </>
        }
      />
    );
  }
  if (run.status === "loading") return <Loading startedAt={run.startedAt} onCancel={() => cancelRequest(requestId)} />;
  if (run.status === "cancelled") return <EmptyState icon={<Ban />} title="Request cancelled" />;
  if (run.status === "error") {
    return (
      <div className="p-4">
        <div className="max-w-3xl rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="size-4" /> {run.error.message}
          </div>
          {run.error.details && <pre className="mt-2 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">{run.error.details}</pre>}
          {run.error.code === "HTTP" && (
            <p className="mt-3 text-xs text-muted-foreground">Check the URL, VPN/proxy settings and that the server is running.</p>
          )}
        </div>
      </div>
    );
  }
  return <ResponseView result={run.result} />;
}

function Loading({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed(performance.now() - startedAt), 100);
    return () => clearInterval(t);
  }, [startedAt]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
      <div className="font-mono text-xs">{formatMs(elapsed)}</div>
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel <Kbd>Esc</Kbd>
      </Button>
    </div>
  );
}

export function ResponseView({ result }: { result: SendResult }) {
  const { response, warnings } = result;
  const tone = statusTone(response.status);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-4 border-b px-3 text-xs">
        <span className={cn("font-mono text-sm font-semibold", toneClass[tone])}>
          {response.status} {response.statusText}
        </span>
        <Tooltip
          content={
            <div className="font-mono">
              TTFB {formatMs(response.timings.ttfbMs)} · Download {formatMs(response.timings.downloadMs)}
            </div>
          }
        >
          <span className="text-muted-foreground">{formatMs(response.timings.totalMs)}</span>
        </Tooltip>
        <Tooltip content={<div className="font-mono">Headers {formatBytes(response.size.headers)} · Body {formatBytes(response.size.body)}</div>}>
          <span className="text-muted-foreground">{formatBytes(response.size.body)}</span>
        </Tooltip>
        <span className="text-muted-foreground">{response.httpVersion}</span>
      </div>
      {warnings.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>{warnings.join(" · ")}</span>
        </div>
      )}
      <Tabs defaultValue="body" className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="headers">
            Headers <span className="text-xs text-muted-foreground">({response.headers.length})</span>
          </TabsTrigger>
          <TabsTrigger value="cookies">
            Cookies <span className="text-xs text-muted-foreground">({response.cookies.length})</span>
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="body" className="flex flex-col overflow-hidden">
          <BodyView response={response} />
        </TabsContent>
        <TabsContent value="headers">
          <PairsTable rows={response.headers} />
        </TabsContent>
        <TabsContent value="cookies">
          {response.cookies.length === 0 ? (
            <EmptyState title="No cookies" />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  {["Name", "Value", "Domain", "Path", "Expires", "HttpOnly", "Secure"].map((h) => (
                    <th key={h} className="px-3 py-1 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {response.cookies.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1">{c.name}</td>
                    <td className="px-3 py-1 break-all select-text">{c.value}</td>
                    <td className="px-3 py-1">{c.domain}</td>
                    <td className="px-3 py-1">{c.path}</td>
                    <td className="px-3 py-1">{c.expires}</td>
                    <td className="px-3 py-1">{c.httpOnly ? "✓" : ""}</td>
                    <td className="px-3 py-1">{c.secure ? "✓" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabsContent>
        <TabsContent value="timeline">
          <Timeline result={result} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type BodyMode = "pretty" | "raw" | "preview";

function BodyView({ response }: { response: HttpResponse }) {
  const [mode, setMode] = useState<BodyMode>(response.body.kind === "binary" ? "preview" : "pretty");
  const [wrap, setWrap] = useState(false);
  const body = response.body;
  const text = body.kind === "text" ? body.text : "";
  const language = useMemo(() => detectLanguage(response.contentType, text), [response.contentType, text]);
  const large = text.length > HIGHLIGHT_LIMIT;
  const pretty = useMemo(() => (mode === "pretty" && !large ? prettyBody(text, language) : text), [mode, large, text, language]);
  const fault = useMemo(() => (language === "xml" ? soapFault(text) : null), [language, text]);
  const isImage = (response.contentType ?? "").startsWith("image/");
  const canPreview = language === "html" || isImage;

  if (body.kind === "binary" && !isImage) {
    return <EmptyState title="Binary response" description={`${response.contentType ?? "unknown type"} · ${formatBytes(response.size.body)}`} />;
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 px-2 pt-1.5">
        {(["pretty", "raw", "preview"] as const)
          .filter((m) => m !== "preview" || canPreview)
          .filter((m) => body.kind === "text" || m === "preview")
          .map((m) => (
            <Button key={m} size="sm" variant={mode === m ? "secondary" : "ghost"} onClick={() => setMode(m)} className="capitalize">
              {m}
            </Button>
          ))}
        <div className="flex-1" />
        {(body.truncated || large) && (
          <span className="mr-2 text-xs text-amber-600 dark:text-amber-400">
            {body.truncated ? "Truncated for display" : "Large body: highlighting off"}
          </span>
        )}
        <Tooltip content="Wrap lines">
          <Button size="icon-sm" variant={wrap ? "secondary" : "ghost"} onClick={() => setWrap(!wrap)} aria-label="Wrap lines">
            <WrapText />
          </Button>
        </Tooltip>
        <Tooltip content="Copy body">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy body"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              toast.success("Copied");
            }}
          >
            <Copy />
          </Button>
        </Tooltip>
      </div>
      {fault && (
        <div className="mx-2 mt-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <span className="font-semibold text-destructive">SOAP Fault</span>
          {fault.code && <span className="ml-2 font-mono">{fault.code}</span>}
          {fault.message && <div className="mt-0.5">{fault.message}</div>}
        </div>
      )}
      <div className="min-h-0 flex-1 p-2">
        {mode === "preview" && canPreview ? (
          isImage && body.kind === "binary" ? (
            <div className="flex h-full items-center justify-center overflow-auto">
              <img src={`data:${response.contentType};base64,${body.base64}`} alt="Response" className="max-h-full max-w-full" />
            </div>
          ) : (
            <iframe title="HTML preview" sandbox="" srcDoc={text} className="h-full w-full rounded-md border bg-white" />
          )
        ) : (
          <div className="h-full overflow-hidden rounded-md border">
            <CodeEditor value={mode === "pretty" ? pretty : text} readOnly language={large ? "text" : language} wrap={wrap} />
          </div>
        )}
      </div>
    </>
  );
}

function PairsTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-xs">
      <tbody className="font-mono">
        {rows.map(([k, v], i) => (
          <tr key={i} className="border-b">
            <td className="w-1/3 px-3 py-1 align-top text-muted-foreground">{k}</td>
            <td className="px-3 py-1 break-all select-text">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Timeline({ result }: { result: SendResult }) {
  const { request, response } = result;
  const { ttfbMs, downloadMs, totalMs } = response.timings;
  const pct = (v: number) => `${totalMs > 0 ? Math.max(1, (v / totalMs) * 100) : 0}%`;
  const bodyText =
    request.body?.kind === "text"
      ? request.body.text
      : request.body?.kind === "form"
        ? request.body.fields.map(([k, v]) => `${k}=${v}`).join("&")
        : request.body?.kind === "multipart"
          ? request.body.parts.map((p) => `${p.name}: ${p.filePath ?? p.value ?? ""}`).join("\n")
          : request.body?.kind === "file"
            ? `<file ${request.body.path}>`
            : "";

  return (
    <div className="space-y-4 p-3 text-xs">
      <div className="space-y-1.5">
        <div className="flex h-3 overflow-hidden rounded bg-muted">
          <div className="bg-method-put/70" style={{ width: pct(ttfbMs) }} />
          <div className="bg-method-get/70" style={{ width: pct(downloadMs) }} />
        </div>
        <div className="flex gap-4 text-muted-foreground">
          <span>Waiting (TTFB) {formatMs(ttfbMs)}</span>
          <span>Download {formatMs(downloadMs)}</span>
          <span>Total {formatMs(totalMs)}</span>
          {response.remoteAddr && <span>Remote {response.remoteAddr}</span>}
        </div>
      </div>
      <div>
        <div className="mb-1 font-semibold text-muted-foreground uppercase">Request sent</div>
        <pre className="rounded-md border bg-muted/40 p-2 font-mono break-all whitespace-pre-wrap select-text">
          {`${request.method} ${request.url}\n`}
          {request.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
          {bodyText ? `\n\n${bodyText}` : ""}
        </pre>
      </div>
      {response.url !== request.url && (
        <div className="text-muted-foreground">
          Final URL after redirects: <span className="font-mono">{response.url}</span>
        </div>
      )}
    </div>
  );
}
