export const commands: Record<string, { desc: string; usage: string }> = {
  "tab.list": { desc: "List all tabs", usage: "chromectl tab list" },
  "tab.open": { desc: "Open a new tab with the given URL", usage: "chromectl tab open <url>" },
  "tab.close": { desc: "Close a tab by ID, URL, or title", usage: "chromectl tab close <id>" },
  "tab.focus": { desc: "Focus a tab by ID, URL, or title", usage: "chromectl tab focus <id>" },
  "tab.group": { desc: "Add a tab to a named group", usage: "chromectl tab group <id> <group-name>" },
  "group.list": { desc: "List all tab groups", usage: "chromectl group list" },
  "group.collapse": { desc: "Collapse a group by name", usage: "chromectl group collapse <name>" },
  "group.expand": { desc: "Expand a group by name", usage: "chromectl group expand <name>" },
  "window.list": { desc: "List all windows", usage: "chromectl window list" },
  "window.focus": { desc: "Focus a window by ID", usage: "chromectl window focus <id>" },
  "raw": { desc: "Raw chrome.* API passthrough", usage: "chromectl raw <api> <method> [args...]" },
  "setup": { desc: "Install the native host manifest", usage: "chromectl setup [--ext-id <id>]" },
};
