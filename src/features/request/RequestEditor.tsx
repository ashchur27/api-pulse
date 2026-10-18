import { ChevronDown, ClipboardPaste, FileCode2, Loader2, MoreHorizontal, Save, Send, Terminal, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { VariableInput } from "@/components/code/VariableInput";
import { CodeEditor } from "@/components/code/CodeEditor";
import { EmptyState } from "@/components/common/EmptyState";
import { KeyValueTable } from "@/components/common/KeyValueTable";
import { MethodBadge } from "@/components/common/MethodBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import type { KeyValue, RequestDef, ScopeVar, SoapConfig } from "@/ipc/types";
import { isCurl, parseCurl, toCurl } from "@/lib/curl";
import { queryFromUrl, syncPathParams, urlWithQuery } from "@/lib/url";
import { cancelRequest, sendRequest, useResponses } from "@/stores/responses";
import { isDirty, useTabs } from "@/stores/tabs";
import { saveRequest } from "@/stores/workspace";
import { AuthEditor } from "./editors/AuthEditor";
import { BodyEditor } from "./editors/BodyEditor";
import { SettingsEditor } from "./editors/SettingsEditor";
import { WsdlOperationDialog } from "@/features/soap/WsdlOperationDialog";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

const COMMON_HEADERS = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-Match",
  "If-None-Match",
  "Origin",
  "Referer",
  "SOAPAction",
  "User-Agent",
  "X-Api-Key",
  "X-Correlation-Id",
  "X-Request-Id",
];

function count(items: KeyValue[]) {
  const n = items.filter((i) => i.enabled && i.key).length;
  return n ? <span className="text-xs text-muted-foreground">({n})</span> : null;
}

function upcoming(phase: number, text: string) {
  return <EmptyState title={`Coming in phase ${phase}`} description={text} />;
}

export function RequestEditor({ request, vars }: { request: RequestDef; vars?: ScopeVar[] }) {
  const update = useTabs((s) => s.updateDraft);
  const dirty = useTabs((s) => isDirty(s, request.id));
  const loading = useResponses((s) => s.runs[request.id]?.status === "loading");
  const isSoap = request.type === "soap";
  const [wsdlOpen, setWsdlOpen] = useState(false);
  const set = (patch: Partial<RequestDef>) => update(request.id, (d) => ({ ...d, ...patch }));

  const setUrl = (url: string) => {
    if (!isSoap && isCurl(url)) {
      importCurl(url);
      return;
    }
    update(request.id, (d) => ({
      ...d,
      url,
      params: { query: queryFromUrl(url, d.params.query), path: syncPathParams(url, d.params.path) },
    }));
  };
  const importCurl = (text: string) => {
    try {
      const c = parseCurl(text);
      update(request.id, (d) => ({
        ...d,
        method: c.method,
        url: c.url,
        params: { query: queryFromUrl(c.url, []), path: syncPathParams(c.url, []) },
        headers: c.headers,
        body: c.body ?? { type: "none" },
        auth: c.auth ?? d.auth,
        settings: {
          ...d.settings,
          verifyTls: c.insecure ? false : d.settings.verifyTls,
          timeoutMs: c.timeoutMs ?? d.settings.timeoutMs,
        },
      }));
      toast.success("Imported from cURL");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const copyCurl = async () => {
    await navigator.clipboard.writeText(toCurl(request));
    toast.success("cURL command copied");
  };
  const setQuery = (query: KeyValue[]) =>
    update(request.id, (d) => ({ ...d, url: urlWithQuery(d.url, query), params: { ...d.params, query } }));
  const setSoap = (patch: Partial<SoapConfig>) =>
    update(request.id, (d) => ({ ...d, soap: { version: "1.1", action: "", ...d.soap, ...patch } }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 p-2">
        {isSoap ? (
          <NativeSelect
            value={request.soap?.version ?? "1.1"}
            onChange={(e) => setSoap({ version: e.target.value as "1.1" | "1.2" })}
            className="w-28"
            aria-label="SOAP version"
          >
            <option value="1.1">SOAP 1.1</option>
            <option value="1.2">SOAP 1.2</option>
          </NativeSelect>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-28 justify-between px-2">
                <MethodBadge method={request.method} className="w-auto text-xs" />
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-28">
              {HTTP_METHODS.map((m) => (
                <DropdownMenuItem key={m} onSelect={() => set({ method: m })}>
                  <MethodBadge method={m} className="w-auto text-xs" />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <VariableInput
          value={request.url}
          onChange={setUrl}
          vars={vars}
          onEnter={() => sendRequest(request.id)}
          placeholder={isSoap ? "{{baseUrl}}/Service.svc" : "{{baseUrl}}/resource"}
        />
        {loading ? (
          <Button variant="secondary" onClick={() => cancelRequest(request.id)} className="w-24">
            <Loader2 className="animate-spin" /> Cancel
          </Button>
        ) : (
          <Tooltip content="Send (Ctrl+Enter)">
            <Button onClick={() => sendRequest(request.id)} className="w-24">
              <Send /> Send
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Save (Ctrl+S)">
          <Button variant="outline" size="icon" disabled={!dirty} onClick={() => saveRequest(request.id)} aria-label="Save">
            <Save />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={copyCurl}>
              <Terminal /> Copy as cURL
            </DropdownMenuItem>
            {!isSoap && (
              <DropdownMenuItem
                onSelect={async () => {
                  const text = await navigator.clipboard.readText().catch(() => "");
                  if (isCurl(text)) importCurl(text);
                  else toast.error("Clipboard does not contain a cURL command");
                }}
              >
                <ClipboardPaste /> Import cURL from clipboard
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isSoap && (
        <div className="flex shrink-0 items-center gap-2 px-2 pb-2">
          <span className="w-28 text-right text-xs text-muted-foreground">SOAPAction</span>
          <Input
            value={request.soap?.action ?? ""}
            onChange={(e) => setSoap({ action: e.target.value })}
            placeholder="http://tempuri.org/IService/Operation"
            className="h-7 font-mono text-xs"
          />
          {request.soap?.action && (
            <Button variant="ghost" size="icon-sm" onClick={() => setSoap({ action: "" })} aria-label="Clear action">
              <X />
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setWsdlOpen(true)}>
            <FileCode2 /> From WSDL…
          </Button>
          <WsdlOperationDialog request={request} open={wsdlOpen} onOpenChange={setWsdlOpen} />
        </div>
      )}

      <Tabs defaultValue={isSoap ? "body" : "params"} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="params">Params {count([...request.params.query, ...request.params.path])}</TabsTrigger>
          <TabsTrigger value="headers">Headers {count(request.headers)}</TabsTrigger>
          <TabsTrigger value="auth">Auth</TabsTrigger>
          <TabsTrigger value="body">{isSoap ? "Envelope" : "Body"}</TabsTrigger>
          <TabsTrigger value="extract">Extract</TabsTrigger>
          <TabsTrigger value="checks">Checks &amp; Asserts</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="params">
          <SectionTitle>Query parameters</SectionTitle>
          <KeyValueTable items={request.params.query} onChange={setQuery} />
          {request.params.path.length > 0 && (
            <>
              <SectionTitle>Path variables</SectionTitle>
              <KeyValueTable
                items={request.params.path}
                onChange={(path) => set({ params: { ...request.params, path } })}
                fixedKeys
                allowBulk={false}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="headers">
          <KeyValueTable items={request.headers} onChange={(headers) => set({ headers })} keySuggestions={COMMON_HEADERS} />
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Headers from parent folders and the collection are added automatically. Content-Type
            {isSoap ? ", SOAPAction" : ""} and User-Agent are generated unless you set them here.
          </p>
        </TabsContent>
        <TabsContent value="auth">
          <AuthEditor auth={request.auth} onChange={(auth) => set({ auth })} vars={vars} />
        </TabsContent>
        <TabsContent value="body" className="flex flex-col overflow-hidden">
          {isSoap ? (
            <div className="h-full p-2">
              <div className="h-full overflow-hidden rounded-md border">
                <CodeEditor value={request.envelope ?? ""} onChange={(envelope) => set({ envelope })} language="xml" vars={vars} />
              </div>
            </div>
          ) : (
            <BodyEditor body={request.body} onChange={(body) => set({ body })} vars={vars} />
          )}
        </TabsContent>
        <TabsContent value="extract">{upcoming(4, "Save values from the response into variables.")}</TabsContent>
        <TabsContent value="checks">{upcoming(4, "DB checks and no-code assertions.")}</TabsContent>
        <TabsContent value="settings">
          <SettingsEditor settings={request.settings} onChange={(settings) => set({ settings })} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</div>;
}
