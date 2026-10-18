export type TabKind = "request" | "settings" | "environment" | "container" | "history" | "database" | "sql";

export interface Tab {
  id: string;
  kind: TabKind;
  preview: boolean;
}

export interface TabsModel {
  tabs: Tab[];
  activeId: string | null;
}

export function openTab(model: TabsModel, id: string, kind: TabKind, preview: boolean): TabsModel {
  const existing = model.tabs.find((t) => t.id === id);
  if (existing) {
    const tabs = !preview && existing.preview ? model.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) : model.tabs;
    return { tabs, activeId: id };
  }
  const tab: Tab = { id, kind, preview };
  if (preview) {
    const previewIndex = model.tabs.findIndex((t) => t.preview);
    if (previewIndex >= 0) {
      const tabs = [...model.tabs];
      tabs[previewIndex] = tab;
      return { tabs, activeId: id };
    }
  }
  return { tabs: [...model.tabs, tab], activeId: id };
}

export function pinTab(model: TabsModel, id: string): TabsModel {
  if (!model.tabs.some((t) => t.id === id && t.preview)) return model;
  return { ...model, tabs: model.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) };
}

export function closeTabs(model: TabsModel, ids: string[]): TabsModel {
  if (ids.length === 0) return model;
  const remove = new Set(ids);
  const tabs = model.tabs.filter((t) => !remove.has(t.id));
  let activeId = model.activeId;
  if (activeId && remove.has(activeId)) {
    const oldIndex = model.tabs.findIndex((t) => t.id === activeId);
    const right = model.tabs.slice(oldIndex + 1).find((t) => !remove.has(t.id));
    const left = model.tabs
      .slice(0, oldIndex)
      .reverse()
      .find((t) => !remove.has(t.id));
    activeId = (right ?? left)?.id ?? null;
  }
  return { tabs, activeId };
}

export function cycleTab(model: TabsModel, direction: 1 | -1): TabsModel {
  if (model.tabs.length < 2) return model;
  const index = model.tabs.findIndex((t) => t.id === model.activeId);
  const next = (index + direction + model.tabs.length) % model.tabs.length;
  return { ...model, activeId: model.tabs[next].id };
}

export function idsToTheRight(model: TabsModel, id: string): string[] {
  const index = model.tabs.findIndex((t) => t.id === id);
  return index < 0 ? [] : model.tabs.slice(index + 1).map((t) => t.id);
}
