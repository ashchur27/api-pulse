export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export type BodyLanguage = "json" | "xml" | "html" | "text";

export function detectLanguage(contentType: string | undefined, text: string): BodyLanguage {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return /^<!doctype html|^<html/i.test(trimmed) ? "html" : "xml";
  return "text";
}

export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function prettyXml(text: string): string | null {
  const source = text.trim();
  if (!source.startsWith("<")) return null;
  const tokens = source.replace(/>\s+</g, "><").split(/(<[^>]+>)/).filter((t) => t.length > 0);
  let depth = 0;
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const pad = "  ".repeat(depth);
    if (token.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      lines.push("  ".repeat(depth) + token);
    } else if (token.startsWith("<?") || token.startsWith("<!") || token.endsWith("/>")) {
      lines.push(pad + token);
    } else if (token.startsWith("<")) {
      const text = tokens[i + 1];
      const close = tokens[i + 2];
      if (text !== undefined && !text.startsWith("<") && close?.startsWith("</")) {
        lines.push(pad + token + text + close);
        i += 2;
      } else {
        lines.push(pad + token);
        depth++;
      }
    } else {
      lines.push(pad + token.trim());
    }
  }
  return lines.join("\n");
}

export function prettyBody(text: string, language: BodyLanguage): string {
  if (language === "json") return prettyJson(text) ?? text;
  if (language === "xml") return prettyXml(text) ?? text;
  return text;
}

export function soapFault(text: string): { code: string; message: string } | null {
  if (!/<(?:[\w-]+:)?Fault[\s>]/.test(text)) return null;
  const pick = (...names: string[]) => {
    for (const name of names) {
      const m = text.match(new RegExp(`<(?:[\\w-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`));
      if (m) return m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    return "";
  };
  return { code: pick("faultcode", "Code"), message: pick("faultstring", "Reason") };
}

export function statusTone(status: number): "success" | "redirect" | "client" | "server" | "info" {
  if (status >= 500) return "server";
  if (status >= 400) return "client";
  if (status >= 300) return "redirect";
  if (status >= 200) return "success";
  return "info";
}
