# chromectl — Design Document

## Overview

`chromectl` is a Bun-based CLI that controls a running Chromium browser via a companion extension using Chrome's **Native Messaging** API. The CLI spawns no long-running daemon; each invocation starts, sends a request, waits for the response, and exits.

## Architecture

```
┌─────────────┐      stdin/stdout      ┌──────────────┐      chrome.* APIs      ┌─────────┐
│   Bun CLI   │ ◄────────────────────► │ Native Host  │ ◄────────────────────► │ Extension │
│  (chromectl)│   length-prefixed JSON │ (node script)│   (runtime messages)   │ (service  │
└─────────────┘                        └──────────────┘                        │  worker)  │
                                                                             └─────────┘
```

Three components:

1. **CLI** — Bun executable, parses arguments, spawns the native host, writes a request, prints the response.
2. **Native Messaging Host** — A thin Node.js script registered with the browser. It bridges the binary native messaging protocol to the Chrome extension via `runtime.connectNative()`.
3. **Extension** — Manifest V3 service worker that calls `chrome.tabs`, `chrome.tabGroups`, `chrome.windows` and returns results.

## Native Messaging Protocol

The browser manages the pipe. Messages are **length-prefixed JSON**:

- **Host → Extension:** 4-byte unsigned little-endian length + UTF-8 JSON payload
- **Extension → Host:** Same format

The host script reads from `process.stdin`, writes to `process.stdout`. No networking, no file permissions beyond the host manifest.

### Message Format

```typescript
type Request = {
  id: string;        // UUIDv4, for matching response
  cmd: string;       // e.g. "tab.list", "tab.close", "group.create"
  args?: unknown[];  // positional arguments
  opts?: object;     // named options
};

type Response = {
  id: string;        // matches request.id
  ok: boolean;
  data?: unknown;
  error?: string;
};
```

## CLI

Built with Bun. Single binary via `bun build --compile`.

### Entrypoint

```bash
chromectl <domain> <action> [args...] [options]
```

Domains: `tab`, `group`, `window`, `raw`

### Example flow

```bash
$ chromectl tab list
# 1. Parse args → { cmd: "tab.list", args: [], opts: {} }
# 2. Spawn host process
# 3. Write request to host stdin
# 4. Block on stdout for response
# 5. Print formatted data (or error) to user
# 6. Exit with 0 or 1
```

### Tab ID resolution

The CLI accepts either:
- Numeric Chrome tab ID
- URL substring (first match)
- Title substring (first match)

Resolution happens in the extension, not the CLI, because the extension has the canonical tab list.

## Extension (Manifest V3)

**Permissions:** `tabs`, `tabGroups`, `nativeMessaging`
**Background:** Service worker (`background.js`)
**No content scripts.** No host permissions. No `<all_urls>`.

### Background worker logic

1. On startup, connect to native host: `chrome.runtime.connectNative("com.chromectl.host")`
2. Listen for `onMessage` on the port.
3. Route by `cmd` to handler functions.
4. Call `chrome.tabs.*` or `chrome.tabGroups.*` APIs.
5. Post response back through the port.

### Command handlers

```typescript
type Handler = (args: unknown[], opts: object) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  "tab.list": async () => chrome.tabs.query({}),
  "tab.close": async ([id]) => chrome.tabs.remove(await resolveId(id)),
  "tab.focus": async ([id]) => chrome.tabs.update(await resolveId(id), { active: true }),
  "tab.group": async ([id, name]) => { ... },
  "group.list": async () => chrome.tabGroups.query({}),
  "group.collapse": async ([name]) => { ... },
  "group.expand": async ([name]) => { ... },
  "window.list": async () => chrome.windows.getAll({ populate: true }),
  "window.focus": async ([id]) => chrome.windows.update(id, { focused: true }),
  "raw": async ([api, ...args]) => { /* generic chrome.* passthrough */ },
};
```

## Native Host Manifest

The browser needs a host manifest file to know which binary to spawn.

**Location:**
- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chromectl.host.json`
- Linux: `~/.config/google-chrome/NativeMessagingHosts/com.chromectl.host.json`
- Windows: Registry key + manifest path

**Manifest contents:**
```json
{
  "name": "com.chromectl.host",
  "description": "chromectl native messaging host",
  "path": "/absolute/path/to/chromectl-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<EXTENSION_ID>/"
  ]
}
```

The `chromectl` CLI includes a `setup` subcommand that writes this manifest and the extension manifest key.

## Installation Flow

1. User installs `chromectl` via npm/bun: `bun install -g chromectl`
2. First run: `chromectl setup`
   - Detects Chrome profile directory
   - Writes native host manifest pointing to the bundled host script
   - Prints instructions to load the unpacked extension from `chromectl`'s package directory
3. User loads extension at `chrome://extensions/` → Developer mode → Load unpacked
4. Extension auto-connects to host. Host stays idle until CLI spawns it.

## Project Structure

```
chromectl/
├── README.md
├── DESIGN.md
├── package.json
├── bun.lock
├── src/
│   ├── cli.ts              # argument parsing, entrypoint
│   ├── commands.ts         # command definitions and help text
│   ├── host.ts             # native messaging host (stdin/stdout bridge)
│   ├── protocol.ts         # message framing (4-byte length + JSON)
│   ├── client.ts           # spawns host, sends request, awaits response
│   └── types.ts            # shared Request/Response types
├── extension/
│   ├── manifest.json
│   ├── background.ts       # service worker, command router
│   └── handlers.ts         # chrome.* API wrappers
└── scripts/
    └── build.ts            # bun build --compile + copy extension assets
```

## Bun Specifics

- **Runtime:** Bun executes `src/cli.ts` directly in development.
- **Bundler:** `bun build --compile src/cli.ts --outfile chromectl` produces a single native binary.
- **Host script:** The native host is a separate Bun/Node script (`src/host.ts`). It must remain a script (not compiled) because the native host manifest points to a file path, and compiled binaries have platform-specific quirks with stdio on some platforms. The CLI and host share the `protocol.ts` module.
- **Package manager:** `bun install` for dependencies. The only runtime dependency is a lightweight argument parser (e.g., `mri` or `sade`). No heavy frameworks.

## Error Handling

- **Host not found:** CLI prints setup instructions and exits 1.
- **Extension not connected:** Host times out after 5s, returns error.
- **Invalid tab ID / no match:** Extension returns descriptive error, CLI prints to stderr.
- **Non-zero exit codes:** All error responses cause the CLI to exit with code 1.

## Security Notes

- The native host manifest restricts `allowed_origins` to the exact extension ID.
- No file system access from the extension beyond the NativeMessaging API.
- The host does not eval or execute arbitrary code; it only validates messages against a known command table and forwards them to the extension.
- No network listeners. The communication channel is the browser-managed stdin/stdout pipe.
