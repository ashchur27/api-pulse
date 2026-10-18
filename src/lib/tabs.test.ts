import { describe, expect, it } from "vitest";
import { closeTabs, cycleTab, idsToTheRight, openTab, pinTab, type TabsModel } from "./tabs";

const empty: TabsModel = { tabs: [], activeId: null };

describe("tabs model", () => {
  it("replaces the preview tab instead of adding a new one", () => {
    let m = openTab(empty, "a", "request", true);
    m = openTab(m, "b", "request", true);
    expect(m.tabs.map((t) => t.id)).toEqual(["b"]);
    expect(m.activeId).toBe("b");
  });

  it("keeps pinned tabs and adds a preview next to them", () => {
    let m = openTab(empty, "a", "request", false);
    m = openTab(m, "b", "request", true);
    m = openTab(m, "c", "request", true);
    expect(m.tabs.map((t) => [t.id, t.preview])).toEqual([
      ["a", false],
      ["c", true],
    ]);
  });

  it("pins a preview tab when opened permanently or edited", () => {
    let m = openTab(empty, "a", "request", true);
    m = openTab(m, "a", "request", false);
    expect(m.tabs[0].preview).toBe(false);
    m = openTab(m, "b", "request", true);
    m = pinTab(m, "b");
    m = openTab(m, "c", "request", true);
    expect(m.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("activates the right neighbour after closing, then the left one", () => {
    let m: TabsModel = {
      tabs: ["a", "b", "c"].map((id) => ({ id, kind: "request", preview: false })),
      activeId: "b",
    };
    m = closeTabs(m, ["b"]);
    expect(m.activeId).toBe("c");
    m = closeTabs(m, ["c"]);
    expect(m.activeId).toBe("a");
    m = closeTabs(m, ["a"]);
    expect(m).toEqual(empty);
  });

  it("keeps the active tab when closing others", () => {
    const m: TabsModel = {
      tabs: ["a", "b", "c"].map((id) => ({ id, kind: "request", preview: false })),
      activeId: "a",
    };
    expect(closeTabs(m, idsToTheRight(m, "a")).tabs.map((t) => t.id)).toEqual(["a"]);
    expect(cycleTab(m, -1).activeId).toBe("c");
    expect(cycleTab(m, 1).activeId).toBe("b");
  });
});
