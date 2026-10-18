import { describe, expect, it } from "vitest";
import { detectLanguage, formatBytes, prettyJson, prettyXml, soapFault } from "./format";

describe("format helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("detects language", () => {
    expect(detectLanguage("application/json; charset=utf-8", "")).toBe("json");
    expect(detectLanguage("text/xml", "")).toBe("xml");
    expect(detectLanguage(undefined, "  [1]")).toBe("json");
    expect(detectLanguage(undefined, "<!DOCTYPE html><html>")).toBe("html");
  });

  it("pretty prints json and xml", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson("{bad")).toBeNull();
    expect(prettyXml('<?xml version="1.0"?><a><b>1</b><c/><d><e>x</e></d></a>')).toBe(
      '<?xml version="1.0"?>\n<a>\n  <b>1</b>\n  <c/>\n  <d>\n    <e>x</e>\n  </d>\n</a>',
    );
  });

  it("detects soap faults", () => {
    const fault =
      '<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring xml:lang="en">Bad id</faultstring></s:Fault></s:Body></s:Envelope>';
    expect(soapFault(fault)).toEqual({ code: "s:Client", message: "Bad id" });
    expect(soapFault("<a/>")).toBeNull();
  });
});
