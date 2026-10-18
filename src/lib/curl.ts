import type { Auth, Body, KeyValue, MultipartField, RequestDef } from "@/ipc/types";

export interface ParsedCurl {
  method: string;
  url: string;
  headers: KeyValue[];
  body?: Body;
  auth?: Auth;
  insecure: boolean;
  followRedirects: boolean;
  timeoutMs?: number;
}

const VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "-x",
  "--proxy",
  "--connect-timeout",
  "--retry",
  "-w",
  "--write-out",
  "-c",
  "--cookie-jar",
  "-r",
  "--range",
  "--cacert",
  "--cert",
  "--key",
  "-E",
  "--resolve",
  "--limit-rate",
]);
const BOOL_SHORT = new Set(["s", "S", "L", "k", "i", "v", "G", "I", "f", "N", "#", "g", "j", "O", "q", "4", "6"]);

export function isCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text);
}

export function tokenize(input: string): string[] {
  let text = input.replace(/\\\r?\n/g, " ").replace(/`\r?\n/g, " ");
  if (/\^"/.test(text) || /\^\r?\n/.test(text)) {
    text = text.replace(/\^\r?\n/g, " ").replace(/\^(.)/g, "$1");
  }
  const tokens: string[] = [];
  let current = "";
  let has = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (has) tokens.push(current);
      current = "";
      has = false;
      i++;
    } else if (c === "'" || (c === "$" && text[i + 1] === "'")) {
      const ansi = c === "$";
      i += ansi ? 2 : 1;
      while (i < text.length && text[i] !== "'") {
        if (ansi && text[i] === "\\" && i + 1 < text.length) {
          const n = text[i + 1];
          current += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
          i += 2;
        } else {
          current += text[i++];
        }
      }
      i++;
      has = true;
    } else if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) {
          current += text[i + 1];
          i += 2;
        } else {
          current += text[i++];
        }
      }
      i++;
      has = true;
    } else if (c === "\\" && i + 1 < text.length) {
      current += text[i + 1];
      i += 2;
      has = true;
    } else {
      current += c;
      i++;
      has = true;
    }
  }
  if (has) tokens.push(current);
  return tokens;
}

function header(line: string): KeyValue | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), enabled: true };
}

function findHeader(headers: KeyValue[], name: string): KeyValue | undefined {
  return headers.find((h) => h.key.toLowerCase() === name.toLowerCase());
}

function bodyFromData(data: string, contentType: string | undefined): Body {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return { type: "json", raw: data };
  if (ct.includes("xml")) return { type: "xml", raw: data };
  if (ct.includes("x-www-form-urlencoded") || (!ct && /^[^\s{[<]+=[^\s]*(&[^\s=]+=[^\s]*)*$/.test(data))) {
    return {
      type: "formUrlEncoded",
      fields: data
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf("=");
          const decode = (s: string) => {
            try {
              return decodeURIComponent(s.replace(/\+/g, " "));
            } catch {
              return s;
            }
          };
          return eq < 0 ? { key: decode(pair), value: "", enabled: true } : { key: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)), enabled: true };
        }),
    };
  }
  const trimmed = data.trim();
  if (!ct && (trimmed.startsWith("{") || trimmed.startsWith("["))) return { type: "json", raw: data };
  if (!ct && trimmed.startsWith("<")) return { type: "xml", raw: data };
  return { type: "text", raw: data };
}

export function parseCurl(input: string): ParsedCurl {
  const tokens = tokenize(input.trim());
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) throw new Error("Not a cURL command");

  let method: string | undefined;
  let url = "";
  const headers: KeyValue[] = [];
  const data: string[] = [];
  let binaryFile: string | undefined;
  const form: MultipartField[] = [];
  let auth: Auth | undefined;
  let insecure = false;
  let follow = false;
  let getMode = false;
  let head = false;
  let timeoutMs: number | undefined;

  for (let i = 1; i < tokens.length; i++) {
    let token = tokens[i];
    let inline: string | undefined;
    if (token.startsWith("--") && token.includes("=")) {
      const eq = token.indexOf("=");
      inline = token.slice(eq + 1);
      token = token.slice(0, eq);
    }
    const next = () => inline ?? tokens[++i] ?? "";
    switch (token) {
      case "-X":
      case "--request":
        method = next().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = header(next());
        if (h) headers.push(h);
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-ascii":
      case "--data-urlencode":
        data.push(next());
        break;
      case "--data-binary": {
        const v = next();
        if (v.startsWith("@")) binaryFile = v.slice(1);
        else data.push(v);
        break;
      }
      case "--json":
        data.push(next());
        if (!findHeader(headers, "Content-Type")) headers.push({ key: "Content-Type", value: "application/json", enabled: true });
        if (!findHeader(headers, "Accept")) headers.push({ key: "Accept", value: "application/json", enabled: true });
        break;
      case "-F":
      case "--form":
      case "--form-string": {
        const v = next();
        const eq = v.indexOf("=");
        const key = eq < 0 ? v : v.slice(0, eq);
        const raw = eq < 0 ? "" : v.slice(eq + 1);
        if (raw.startsWith("@") && token !== "--form-string") {
          const [path, ...attrs] = raw.slice(1).split(";");
          const type = attrs.find((a) => a.startsWith("type="))?.slice(5);
          form.push({ key, kind: "file", filePath: path, contentType: type, enabled: true });
        } else {
          form.push({ key, kind: "text", value: raw, enabled: true });
        }
        break;
      }
      case "-u":
      case "--user": {
        const v = next();
        const idx = v.indexOf(":");
        auth = { type: "basic", username: idx < 0 ? v : v.slice(0, idx), password: idx < 0 ? "" : v.slice(idx + 1) };
        break;
      }
      case "-b":
      case "--cookie":
        headers.push({ key: "Cookie", value: next(), enabled: true });
        break;
      case "-A":
      case "--user-agent":
        headers.push({ key: "User-Agent", value: next(), enabled: true });
        break;
      case "-e":
      case "--referer":
        headers.push({ key: "Referer", value: next(), enabled: true });
        break;
      case "--url":
        url = next();
        break;
      case "-m":
      case "--max-time":
        timeoutMs = Math.round(Number(next()) * 1000) || undefined;
        break;
      case "-k":
      case "--insecure":
        insecure = true;
        break;
      case "-L":
      case "--location":
        follow = true;
        break;
      case "-G":
      case "--get":
        getMode = true;
        break;
      case "-I":
      case "--head":
        head = true;
        break;
      default:
        if (VALUE_FLAGS.has(token)) {
          next();
        } else if (/^-[A-Za-z0-9#]{2,}$/.test(token) && [...token.slice(1)].every((c) => BOOL_SHORT.has(c))) {
          for (const c of token.slice(1)) {
            if (c === "k") insecure = true;
            if (c === "L") follow = true;
            if (c === "G") getMode = true;
            if (c === "I") head = true;
          }
        } else if (!token.startsWith("-") && !url) {
          url = token;
        }
    }
  }

  if (!url) throw new Error("cURL command has no URL");
  const joined = data.join("&");
  let body: Body | undefined;
  if (getMode && joined) {
    url += (url.includes("?") ? "&" : "?") + joined;
  } else if (form.length) {
    body = { type: "multipart", fields: form };
  } else if (binaryFile !== undefined) {
    body = { type: "binary", filePath: binaryFile };
  } else if (data.length) {
    body = bodyFromData(joined, findHeader(headers, "Content-Type")?.value);
  }

  const authHeader = findHeader(headers, "Authorization");
  if (!auth && authHeader && /^bearer\s+/i.test(authHeader.value)) {
    auth = { type: "bearer", token: authHeader.value.replace(/^bearer\s+/i, "") };
    headers.splice(headers.indexOf(authHeader), 1);
  }

  return {
    method: method ?? (head ? "HEAD" : body ? "POST" : "GET"),
    url,
    headers,
    body,
    auth,
    insecure,
    followRedirects: follow,
    timeoutMs,
  };
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(req: RequestDef): string {
  const parts: string[] = ["curl"];
  const headers = req.headers.filter((h) => h.enabled && h.key);
  const has = (name: string) => headers.some((h) => h.key.toLowerCase() === name.toLowerCase());
  let url = req.url;
  const extra: string[] = [];

  if (req.type === "soap") {
    parts.push("-X POST");
    const version = req.soap?.version ?? "1.1";
    const action = req.soap?.action ?? "";
    if (!has("Content-Type")) {
      extra.push(`-H ${q(version === "1.2" ? `Content-Type: application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ""}` : "Content-Type: text/xml; charset=utf-8")}`);
    }
    if (version !== "1.2" && !has("SOAPAction")) extra.push(`-H ${q(`SOAPAction: "${action}"`)}`);
  } else {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET") parts.push(method === "HEAD" ? "-I" : `-X ${method}`);
  }

  const auth = req.auth;
  if (auth.type === "basic") extra.push(`-u ${q(`${auth.username}:${auth.password}`)}`);
  if (auth.type === "bearer" && !has("Authorization")) extra.push(`-H ${q(`Authorization: Bearer ${auth.token}`)}`);
  if (auth.type === "apiKey" && auth.key) {
    if (auth.in === "header") extra.push(`-H ${q(`${auth.key}: ${auth.value}`)}`);
    else url += `${url.includes("?") ? "&" : "?"}${auth.key}=${auth.value}`;
  }

  parts.push(q(url));
  for (const h of headers) parts.push(`-H ${q(`${h.key}: ${h.value}`)}`);
  parts.push(...extra);

  if (req.type === "soap") {
    parts.push(`--data-raw ${q(req.envelope ?? "")}`);
  } else {
    const body = req.body;
    if (body && "raw" in body && body.raw) {
      const ct = { json: "application/json", xml: "application/xml", text: "text/plain" }[body.type];
      if (!has("Content-Type")) parts.push(`-H ${q(`Content-Type: ${ct}`)}`);
      parts.push(`--data-raw ${q(body.raw)}`);
    } else if (body?.type === "formUrlEncoded") {
      for (const f of body.fields.filter((f) => f.enabled && f.key)) parts.push(`--data-urlencode ${q(`${f.key}=${f.value}`)}`);
    } else if (body?.type === "multipart") {
      for (const f of body.fields.filter((f) => f.enabled && f.key)) {
        const value = f.kind === "file" ? `@${f.filePath ?? ""}${f.contentType ? `;type=${f.contentType}` : ""}` : (f.value ?? "");
        parts.push(`-F ${q(`${f.key}=${value}`)}`);
      }
    } else if (body?.type === "binary" && body.filePath) {
      parts.push(`--data-binary ${q(`@${body.filePath}`)}`);
    }
  }

  if (req.settings.verifyTls === false) parts.push("-k");
  if (req.settings.followRedirects !== false) parts.push("-L");
  return parts.join(" \\\n  ");
}
