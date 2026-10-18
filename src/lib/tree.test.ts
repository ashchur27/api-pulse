import { describe, expect, it } from "vitest";
import type { TreeNode, WorkspaceTree } from "@/ipc/types";
import { ancestorIds, collectIds, countRequests, filterTree, findNode } from "./tree";

const req = (id: string, name: string): TreeNode => ({
  id,
  kind: "request",
  name,
  order: 0,
  method: "GET",
  requestType: "http",
  children: [],
});

const tree: WorkspaceTree = {
  id: "ws",
  name: "WS",
  root: "/ws",
  problems: [],
  collections: [
    {
      id: "c1",
      kind: "collection",
      name: "Users API",
      order: 0,
      children: [
        { id: "f1", kind: "folder", name: "Users", order: 0, children: [req("r1", "List users"), req("r2", "Create order")] },
        req("r3", "Health"),
      ],
    },
  ],
};

describe("tree helpers", () => {
  it("finds nodes and ancestors", () => {
    expect(findNode(tree, "r2")?.name).toBe("Create order");
    expect(findNode(tree, "nope")).toBeNull();
    expect(ancestorIds(tree, "r2")).toEqual(["c1", "f1"]);
  });

  it("filters by name keeping ancestors", () => {
    const result = filterTree(tree.collections, "order");
    expect(result[0].children[0].children.map((n) => n.id)).toEqual(["r2"]);
    expect(result[0].children).toHaveLength(1);
  });

  it("counts and collects", () => {
    expect(countRequests(tree)).toBe(3);
    expect(collectIds(tree).size).toBe(5);
  });
});
