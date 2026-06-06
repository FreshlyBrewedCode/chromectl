# Chunk 3 Implementation Report

## Changed Files

### `extension/manifest.json`
Manifest V3 with:
- `manifest_version: 3`
- `name`: "chromectl", `version`: "1.0.0"
- `permissions`: `["tabs", "tabGroups", "nativeMessaging"]`
- `background.service_worker`: `"background.js"`
- `host_permissions`: `[]` (no `<all_urls>`)

### `extension/background.ts`
Service worker that:
- Connects to native host `com.chromectl.host` on startup via `chrome.runtime.connectNative()`
- Listens for `port.onMessage` events containing `Request` objects
- Routes `cmd` through the handler map imported from `handlers.ts`
- Sends `Response` objects back via `port.postMessage` with `{ id, ok, data?, error? }` format
- Handles `port.onDisconnect` by logging to console and scheduling a retry after 5s
- Prevents duplicate retry timers

### `extension/handlers.ts`
Implements all Chrome API wrappers:

| Command | Implementation |
|---------|---------------|
| `tab.list` | `chrome.tabs.query({})` |
| `tab.open` | `chrome.tabs.create({ url })` |
| `tab.close` | `resolveId(id)` → `chrome.tabs.remove(id)` |
| `tab.focus` | `resolveId(id)` → `chrome.tabs.update(id, { active: true })` |
| `tab.group` | `resolveId(id)` → `chrome.tabs.group()` + `chrome.tabGroups.update()` with name |
| `group.list` | `chrome.tabGroups.query({})` |
| `group.collapse` | `resolveGroup(name)` → `chrome.tabGroups.update(id, { collapsed: true })` |
| `group.expand` | `resolveGroup(name)` → `chrome.tabGroups.update(id, { collapsed: false })` |
| `window.list` | `chrome.windows.getAll({ populate: true })` |
| `window.focus` | `chrome.windows.update(id, { focused: true })` |
| `raw` | Passthrough to `chrome[tabs/tabGroups/windows][method](...args)` with allowlist |

**Helpers:**
- `resolveId(id)`: If numeric, returns as-is. If string, queries all tabs and finds first match by URL or title substring. Throws descriptive error on no match.
- `resolveGroup(name)`: Queries all groups, matches by exact title. Throws on no match.

### `extension/tsconfig.json`
Extension-specific TypeScript config:
- `"lib": ["ES2022", "DOM"]`
- `"types": ["chrome"]`
- `"noEmit": true` (type-check only)
- Same strict settings as root config

### Dependencies
- Added `@types/chrome@0.1.43` as dev dependency

## Validation Results

| Command | Exit Code | Result |
|---------|-----------|--------|
| `npx tsc --project extension/tsconfig.json` | 0 | Zero errors |
| `npx tsc --noEmit` | 0 | Zero errors (root config) |
| `bun test` | 0 | 7 pass, 0 fail (Chunk 0 tests still green) |

## Issues Encountered

1. **TypeScript strict null checks on Chrome API returns**: Several Chrome APIs return `Tab \| undefined` or `TabGroup \| undefined`. Fixed by adding explicit null checks that throw descriptive errors before returning.

2. **`chrome.tabs.group` with `groupId` option**: When adding a tab to an existing group, the API doesn't return a TabGroup. Fixed by separating the `group()` call from the `tabGroups.update()` call and handling the return values independently.

## No Breaking Changes
No existing Chunk 0 files were modified.
