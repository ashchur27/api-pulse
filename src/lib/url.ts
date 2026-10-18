import type { KeyValue } from "@/ipc/types";

interface UrlParts {
  base: string;
  query: string | null;
  hash: string;
}

function splitUrl(url: string): UrlParts {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const noHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = noHash.indexOf("?");
  if (queryIndex < 0) return { base: noHash, query: null, hash };
  return { base: noHash.slice(0, queryIndex), query: noHash.slice(queryIndex + 1), hash };
}

export function parseQuery(url: string): { key: string; value: string }[] {
  const { query } = splitUrl(url);
  if (!query) return [];
  return query
    .split("&")
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq < 0 ? { key: pair, value: "" } : { key: pair.slice(0, eq), value: pair.slice(eq + 1) };
    });
}

export function queryFromUrl(url: string, previous: KeyValue[]): KeyValue[] {
  const enabled = parseQuery(url).map((p, i) => {
    const prev = previous.filter((q) => q.enabled)[i];
    return { key: p.key, value: p.value, enabled: true, description: prev?.key === p.key ? prev.description : undefined };
  });
  return [...enabled, ...previous.filter((q) => !q.enabled)].map(stripEmptyDescription);
}

export function urlWithQuery(url: string, query: KeyValue[]): string {
  const { base, hash } = splitUrl(url);
  const pairs = query.filter((q) => q.enabled && (q.key || q.value)).map((q) => (q.value === "" && !q.key.includes("=") ? q.key : `${q.key}=${q.value}`));
  return pairs.length ? `${base}?${pairs.join("&")}${hash}` : `${base}${hash}`;
}

export function pathParamNames(url: string): string[] {
  const { base } = splitUrl(url);
  const names: string[] = [];
  for (const m of base.matchAll(/\/:([A-Za-z_][A-Za-z0-9_]*)(?=\/|$)/g)) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export function syncPathParams(url: string, previous: KeyValue[]): KeyValue[] {
  return pathParamNames(url).map(
    (name) => previous.find((p) => p.key === name) ?? { key: name, value: "", enabled: true },
  );
}

function stripEmptyDescription(kv: KeyValue): KeyValue {
  if (kv.description) return kv;
  const { description: _, ...rest } = kv;
  return rest;
}
