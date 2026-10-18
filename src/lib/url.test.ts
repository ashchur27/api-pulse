import { describe, expect, it } from "vitest";
import { parseQuery, pathParamNames, queryFromUrl, syncPathParams, urlWithQuery } from "./url";

describe("url helpers", () => {
  it("parses query keeping raw text and variables", () => {
    expect(parseQuery("{{baseUrl}}/users?limit={{n}}&flag&q=a%20b#top")).toEqual([
      { key: "limit", value: "{{n}}" },
      { key: "flag", value: "" },
      { key: "q", value: "a%20b" },
    ]);
    expect(parseQuery("http://x/y")).toEqual([]);
  });

  it("keeps disabled params when the url changes", () => {
    const prev = [
      { key: "a", value: "1", enabled: true, description: "first" },
      { key: "off", value: "x", enabled: false },
    ];
    expect(queryFromUrl("http://h/p?a=2&b=3", prev)).toEqual([
      { key: "a", value: "2", enabled: true, description: "first" },
      { key: "b", value: "3", enabled: true },
      { key: "off", value: "x", enabled: false },
    ]);
  });

  it("rebuilds url from enabled params and keeps the hash", () => {
    const query = [
      { key: "a", value: "1", enabled: true },
      { key: "b", value: "", enabled: true },
      { key: "c", value: "3", enabled: false },
    ];
    expect(urlWithQuery("http://h/p?old=1#frag", query)).toBe("http://h/p?a=1&b#frag");
    expect(urlWithQuery("http://h/p?old=1", [])).toBe("http://h/p");
  });

  it("detects path params", () => {
    expect(pathParamNames("{{base}}/users/:id/orders/:orderId?x=:no")).toEqual(["id", "orderId"]);
    expect(syncPathParams("/users/:id", [{ key: "id", value: "7", enabled: true }, { key: "gone", value: "", enabled: true }])).toEqual([
      { key: "id", value: "7", enabled: true },
    ]);
  });
});
