import type { TreeNode, WorkspaceTree } from "@/ipc/types";

export function findNode(tree: WorkspaceTree | null, id: string): TreeNode | null {
  if (!tree) return null;
  const stack = [...tree.collections];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...node.children);
  }
  return null;
}

export function ancestorIds(tree: WorkspaceTree, id: string): string[] {
  const path: string[] = [];
  const visit = (nodes: TreeNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === id) return true;
      path.push(node.id);
      if (visit(node.children)) return true;
      path.pop();
    }
    return false;
  };
  return visit(tree.collections) ? path : [];
}

export function collectIds(tree: WorkspaceTree | null): Set<string> {
  const ids = new Set<string>();
  const stack = [...(tree?.collections ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    ids.add(node.id);
    stack.push(...node.children);
  }
  return ids;
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(q)) {
      result.push(node);
      continue;
    }
    const children = filterTree(node.children, q);
    if (children.length) result.push({ ...node, children });
  }
  return result;
}

export function countRequests(tree: WorkspaceTree | null): number {
  let count = 0;
  const stack = [...(tree?.collections ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "request") count++;
    stack.push(...node.children);
  }
  return count;
}
