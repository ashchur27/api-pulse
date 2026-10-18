import { describe, expect, it } from "vitest";
import type { RequestDef } from "@/ipc/types";
import { isCurl, parseCurl, toCurl, tokenize } from "./curl";

describe("curl parsing", () => {
  it("tokenizes bash quoting and continuations", () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n -H $'x\\ny'`)).toEqual(["curl", "a b", 'c "d"', "e f", "-H", "x\ny"]);
  });

  it("parses a chrome bash export", () => {
    const p = parseCurl(`curl 'https://api.test/users?limit=5' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  --data-raw '{"name":"Ann"}' \\
  --compressed`);
    expect(p.method).toBe("POST");
    expect(p.url).toBe("https://api.test/users?limit=5");
    expect(p.headers).toEqual([{ key: "accept", value: "application/json", enabled: true }]);
    expect(p.auth).toEqual({ type: "bearer", token: "abc.def" });
    expect(p.body).toEqual({ type: "json", raw: '{"name":"Ann"}' });
  });

  it("parses windows cmd exports", () => {
    const p = parseCurl(`curl ^"https://api.test/x^" ^
  -H ^"content-type: text/xml^" ^
  --data-raw ^"^<a^>1^</a^>^"`);
    expect(p.url).toBe("https://api.test/x");
    expect(p.body).toEqual({ type: "xml", raw: "<a>1</a>" });
  });

  it("handles forms, basic auth, flags and -G", () => {
    const form = parseCurl(`curl -sSLk -u user:p@ss -F 'file=@/tmp/a.png;type=image/png' -F name=x https://h/upload`);
    expect(form.insecure).toBe(true);
    expect(form.followRedirects).toBe(true);
    expect(form.auth).toEqual({ type: "basic", username: "user", password: "p@ss" });
    expect(form.body).toEqual({
      type: "multipart",
      fields: [
        { key: "file", kind: "file", filePath: "/tmp/a.png", contentType: "image/png", enabled: true },
        { key: "name", kind: "text", value: "x", enabled: true },
      ],
    });
    const urlencoded = parseCurl(`curl -X PUT https://h/p -d 'a=1&b=hello%20world'`);
    expect(urlencoded.method).toBe("PUT");
    expect(urlencoded.body).toEqual({
      type: "formUrlEncoded",
      fields: [
        { key: "a", value: "1", enabled: true },
        { key: "b", value: "hello world", enabled: true },
      ],
    });
    const get = parseCurl(`curl -G https://h/s -d q=1 -d r=2`);
    expect(get.method).toBe("GET");
    expect(get.url).toBe("https://h/s?q=1&r=2");
  });

  it("detects curl text", () => {
    expect(isCurl("  curl https://x")).toBe(true);
    expect(isCurl("https://curl.se")).toBe(false);
  });
});

describe("curl export", () => {
  const base: RequestDef = {
    id: "1",
    type: "http",
    name: "R",
    order: 0,
    method: "POST",
    url: "{{baseUrl}}/users",
    params: { query: [], path: [] },
    headers: [{ key: "X-Id", value: "it's", enabled: true }],
    auth: { type: "bearer", token: "{{token}}" },
    body: { type: "json", raw: '{"a":1}' },
    settings: { timeoutMs: null, followRedirects: null, verifyTls: false },
    extract: [],
    dbChecks: [],
    assertions: [],
  };

  it("round-trips through the parser", () => {
    const text = toCurl(base);
    expect(text).toContain(`-H 'X-Id: it'\\''s'`);
    const parsed = parseCurl(text);
    expect(parsed.method).toBe("POST");
    expect(parsed.url).toBe("{{baseUrl}}/users");
    expect(parsed.auth).toEqual({ type: "bearer", token: "{{token}}" });
    expect(parsed.body).toEqual({ type: "json", raw: '{"a":1}' });
    expect(parsed.insecure).toBe(true);
  });
});
