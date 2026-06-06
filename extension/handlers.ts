import type { Request, Response } from "./types";

export type Handler = (args: unknown[], opts: object) => Promise<unknown>;

async function resolveId(id: string | number): Promise<number> {
  if (typeof id === "number") {
    return id;
  }
  if (typeof id !== "string") {
    throw new Error(`Invalid tab ID type: ${typeof id}`);
  }
  const tabs = await chrome.tabs.query({});
  const match = tabs.find(
    (t) =>
      (t.url && t.url.includes(id)) ||
      (t.title && t.title.includes(id))
  );
  if (!match || match.id == null) {
    throw new Error(`No tab matching "${id}"`);
  }
  return match.id;
}

async function resolveGroup(name: string): Promise<number> {
  const groups = await chrome.tabGroups.query({});
  const match = groups.find((g) => g.title === name);
  if (!match) {
    throw new Error(`No group named "${name}"`);
  }
  return match.id;
}

async function tabList() {
  return chrome.tabs.query({});
}

async function tabOpen(args: unknown[]) {
  const url = String(args[0] ?? "");
  if (!url) throw new Error("URL required");
  const tab = await chrome.tabs.create({ url });
  if (!tab) throw new Error("Failed to create tab");
  return tab;
}

async function tabClose(args: unknown[]) {
  const id = await resolveId(args[0] as string | number);
  return chrome.tabs.remove(id);
}

async function tabFocus(args: unknown[]) {
  const id = await resolveId(args[0] as string | number);
  const tab = await chrome.tabs.update(id, { active: true });
  if (!tab) throw new Error("Failed to focus tab");
  return tab;
}

async function tabGroup(args: unknown[]) {
  const tabId = await resolveId(args[0] as string | number);
  const name = String(args[1] ?? "");

  // Check if a group with this name already exists
  const groups = await chrome.tabGroups.query({});
  const existing = groups.find((g) => g.title === name);

  if (existing) {
    await chrome.tabs.group({ tabIds: tabId, groupId: existing.id });
    const group = await chrome.tabGroups.update(existing.id, { title: name });
    if (!group) throw new Error("Failed to update group");
    return group;
  }

  const groupId = await chrome.tabs.group({ tabIds: tabId });
  const group = await chrome.tabGroups.update(groupId, { title: name });
  if (!group) throw new Error("Failed to update group");
  return group;
}

async function groupList() {
  return chrome.tabGroups.query({});
}

async function groupCollapse(args: unknown[]) {
  const id = await resolveGroup(String(args[0]));
  const group = await chrome.tabGroups.update(id, { collapsed: true });
  if (!group) throw new Error("Failed to collapse group");
  return group;
}

async function groupExpand(args: unknown[]) {
  const id = await resolveGroup(String(args[0]));
  const group = await chrome.tabGroups.update(id, { collapsed: false });
  if (!group) throw new Error("Failed to expand group");
  return group;
}

async function windowList() {
  return chrome.windows.getAll({ populate: true });
}

async function windowFocus(args: unknown[]) {
  const id = Number(args[0]);
  if (Number.isNaN(id)) throw new Error("Window ID must be a number");
  const win = await chrome.windows.update(id, { focused: true });
  if (!win) throw new Error("Failed to focus window");
  return win;
}

async function raw(args: unknown[]) {
  const api = String(args[0] ?? "");
  const rest = args.slice(1);

  const allowlist = ["tabs", "tabGroups", "windows"];
  if (!allowlist.includes(api)) {
    throw new Error(`API "${api}" is not allowed`);
  }

  const chromeApi = (chrome as Record<string, unknown>)[api];
  if (typeof chromeApi !== "object" || chromeApi == null) {
    throw new Error(`chrome.${api} is not available`);
  }

  const methodName = String(rest[0] ?? "");
  const methodArgs = rest.slice(1);
  const method = (chromeApi as Record<string, unknown>)[methodName];

  if (typeof method !== "function") {
    throw new Error(`chrome.${api}.${methodName} is not a function`);
  }

  return (method as (...args: unknown[]) => unknown)(...methodArgs);
}

export const handlers: Record<string, Handler> = {
  "tab.list": tabList,
  "tab.open": tabOpen,
  "tab.close": tabClose,
  "tab.focus": tabFocus,
  "tab.group": tabGroup,
  "group.list": groupList,
  "group.collapse": groupCollapse,
  "group.expand": groupExpand,
  "window.list": windowList,
  "window.focus": windowFocus,
  "raw": raw,
};
