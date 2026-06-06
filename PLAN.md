# chromectl — Implementation Plan

> Build a Bun CLI + Chrome Extension pair that controls Chromium via Native Messaging.

---

## Chunk 0: Project Bootstrap
**Goal:** Initialize the repo, dependencies, and shared foundations.

- [x] **0.1** Create `package.json`
  - Bun runtime. `bin`: `"chromectl": "./src/cli.ts"`.
  - Runtime dependency: `mri`. Dev: `@types/bun`, `@types/chrome`, `typescript`.
  - Scripts: `dev`, `build`, `typecheck`, `test`, `prepublishOnly`.
- [x] **0.2** Create `tsconfig.json`
  - `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"strict": true`, `"target": "ES2022"`.
- [x] **0.3** Create `src/types.ts`
  - Export `Request { id: string; cmd: string; args?: unknown[]; opts?: object }`.
  - Export `Response { id: string; ok: boolean; data?: unknown; error?: string }`.
- [x] **0.4** Create `src/protocol.ts`
  - `encode(msg: Request | Response): Buffer` — 4-byte unsigned little-endian length + UTF-8 JSON.
  - `decode(readable: ReadableStream<Uint8Array> | NodeJS.ReadableStream): AsyncGenerator<Request | Response>`.
- [x] **0.5** Write `src/protocol.test.ts`
  - Round-trip tests for encode/decode, empty stream, multi-message stream, invalid length handling.
  - **Result:** 7 tests passing.

---

## Chunk 1: Native Messaging Host
**Goal:** Build the stdin/stdout bridge that Chrome spawns, plus a local socket so the short-lived CLI can reach it.

- [x] **1.1** Create `src/host.ts`
  - Detect host mode vs CLI mode via `--host` flag or `!process.stdin.isTTY`.
  - In host mode:
    1. Use `src/protocol.ts` to read length-prefixed JSON from `process.stdin` (messages from the Chrome extension).
    2. Use `src/protocol.ts` to write length-prefixed JSON to `process.stdout` (responses back to the extension).
    3. Create a Unix domain socket (macOS/Linux) or named pipe (Windows) at a known path (`~/.chromectl/chromectl.sock` or `\\.\pipe\chromectl`).
    4. Accept connections from the CLI on that socket. Each socket message is a `Request`; forward it to the extension over the Chrome pipe, await the response, then send it back on the socket.
    5. If the extension disconnects (stdin closes), clean up the socket and exit.
  - `TIMEOUT_MS` configurable via `CHROMECTL_TIMEOUT` env var.
- [x] **1.2** Create `src/client.ts`
  - `send(req: Request): Promise<Response>`
  - Connect to the domain socket / named pipe.
  - If missing: throw a clear error telling the user to run `chromectl setup` and load the extension.
  - Write the request as plain UTF-8 JSON + newline (simple line protocol for the local socket; not the binary length-prefix, which is only for the Chrome-managed pipe).
  - Await one line of JSON response, parse as `Response`, close socket, return.
- [x] **1.3** Create `src/host.test.ts`
  - Spawn host in a test harness using Bun’s `Bun.spawn`. Pipe fake extension messages via stdin, connect to the local socket, and verify round-trip forwarding.
  - **Result:** 3 tests passing (round-trip, timeout, cleanup).

> **Design note:** The DESIGN.md diagram shows the CLI talking to the Host via stdin/stdout. In practice Chrome spawns the host and owns that pipe. We insert a lightweight local socket so the short-lived CLI can communicate with the Chrome-spawned host. This preserves "no TCP ports / no remote debugging" and keeps the CLI ephemeral.

---

## Chunk 2: CLI Argument Parsing & Command Dispatch
**Goal:** Build the user-facing Bun CLI entrypoint.

- [x] **2.1** Create `src/commands.ts`
  - Export a flat map: `Record<string, { desc: string; usage: string }>`.
  - Keys: `tab.list`, `tab.open`, `tab.close`, `tab.focus`, `tab.group`, `group.list`, `group.collapse`, `group.expand`, `window.list`, `window.focus`, `raw`, `setup`.
  - Include a generic `help` renderer.
- [x] **2.2** Create `src/cli.ts`
  - Parse `process.argv.slice(2)` with `mri`.
  - Expected shape: `chromectl <domain> <action> [args...]`.
  - Map `domain.action` to a `Request.cmd`.
  - Collect positional args into `args`, flags into `opts`.
  - Call `client.send(req)`.
  - On success (`ok === true`): pretty-print `data` as formatted JSON.
  - On error: print `error` to stderr and return exit code 1.
  - If invocation is malformed, print usage from `commands.ts` and exit 1.
  - Special case: `setup` command handled directly (writes manifest, prints instructions).
- [x] **2.3** Add tab-ID resolution hint in CLI help text: explain that IDs can be numeric, URL substrings, or title substrings. Actual resolution happens in the extension.
- [x] **2.4** Add a `chromectl --version` flag.
- [x] **2.5** Create `src/cli.test.ts`
  - Unit tests for `--help`, `--version`, no args, unknown command, missing action, setup command, and send-error paths.
  - **Result:** 9 tests passing.

---

## Chunk 3: Browser Extension (Manifest V3)
**Goal:** Build the Chrome extension that calls `chrome.tabs`, `chrome.tabGroups`, and `chrome.windows`.

- [x] **3.1** Create `extension/manifest.json`
  - `manifest_version: 3`.
  - `permissions`: `["tabs", "tabGroups", "nativeMessaging"]`.
  - `background.service_worker`: `"background.js"`.
  - `host_permissions`: `[]` (no `<all_urls>`).
- [x] **3.2** Create `extension/background.ts`
  - On service-worker startup, connect to native host: `chrome.runtime.connectNative('com.chromectl.host')`.
  - Listen `port.onMessage` for incoming `Request` objects.
  - Route `cmd` through a handler map.
  - Send `Response` back via `port.postMessage`.
  - Handle `port.onDisconnect`: log error, retry connection after 5s.
- [x] **3.3** Create `extension/handlers.ts`
  - Implement each handler as an async function.
  - `tab.list`: `chrome.tabs.query({})`.
  - `tab.open`: `chrome.tabs.create({ url })`.
  - `tab.close`: resolve ID → `chrome.tabs.remove(id)`.
  - `tab.focus`: resolve ID → `chrome.tabs.update(id, { active: true })`.
  - `tab.group`: resolve ID, then create or add to named group via `chrome.tabs.group` + `chrome.tabGroups.update`.
  - `group.list`: `chrome.tabGroups.query({})`.
  - `group.collapse`: resolve group by name → `chrome.tabGroups.update(id, { collapsed: true })`.
  - `group.expand`: resolve group by name → `chrome.tabGroups.update(id, { collapsed: false })`.
  - `window.list`: `chrome.windows.getAll({ populate: true })`.
  - `window.focus`: `chrome.windows.update(id, { focused: true })`.
  - `raw`: generic passthrough `chrome[api](...args)` with basic allowlist.
- [x] **3.4** Implement `resolveId(id: string | number)` helper in `extension/handlers.ts`
  - If numeric, return as number.
  - If string, `chrome.tabs.query({})`, then find first tab where URL or title includes the substring.
  - Throw descriptive error if no match.
- [x] **3.5** Implement `resolveGroup(name: string)` helper in `extension/handlers.ts`
  - Query groups, match by `title`, return `group.id`.
  - Throw if no match.

---

## Chunk 4: Setup & Native Host Manifest
**Goal:** Automate installation of the native host manifest so Chrome knows how to spawn the host.

- [x] **4.1** Create `src/setup.ts`
  - `chromectl setup` command handler.
  - Detect OS: macOS, Linux, Windows.
  - Find Chrome profile directory:
    - macOS: `~/Library/Application Support/Google/Chrome`
    - Linux: `~/.config/google-chrome`
    - Windows: `%LOCALAPPDATA%\Google\Chrome\User Data`
  - Write the native host manifest JSON to `.../NativeMessagingHosts/com.chromectl.host.json`.
  - Manifest contents:
    ```json
    {
      "name": "com.chromectl.host",
      "description": "chromectl native messaging host",
      "path": "/absolute/path/to/chromectl-host",
      "type": "stdio",
      "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
    }
    ```
  - Resolve the absolute path to the host script (`src/host.ts`, runnable by Bun/Node).
  - Print the exact `allowed_origins` line instructing the user to replace `<EXTENSION_ID>` after they load the unpacked extension.
  - Print step-by-step instructions to load `extension/` as an unpacked extension at `chrome://extensions/`.
- [x] **4.2** Add a `chromectl setup --ext-id <id>` flag so users can inject their real extension ID into the manifest after loading it.
- [x] **4.3** Validate setup: check that the manifest file exists and is readable.
  - `validateManifest()` checks file existence, readability, and required fields.
- [x] **4.4** Create `src/setup.test.ts`
  - Tests for profile dir detection, manifest path resolution, manifest building, setup with/without ext-id, validation.
  - **Result:** 12 tests passing.

---

## Chunk 5: Build, Packaging & Polish
**Goal:** Produce a shippable npm/bun package with a compiled CLI and bundled extension.

- [x] **5.1** Create `scripts/build.ts`
  - Run `bun build --compile src/cli.ts --outfile dist/chromectl` to produce a single native binary.
  - Copy `extension/` into `dist/extension/`.
  - Compile extension TS to JS via `tsc`.
  - Copy host script dependencies to `dist/`.
- [x] **5.2** Wire `package.json` scripts:
  - `"build": "bun run scripts/build.ts"`
  - `"prepublishOnly": "bun run build"`
- [x] **5.3** Add a `.gitignore`:
  - `node_modules/`, `dist/`, `chromectl`, `*.log`, `.DS_Store`, `extension/*.js`.
- [x] **5.4** Update `package.json` with `files` field for npm publishing.
- [x] **5.5** Run `bun test`, fix any failing tests.
  - **Result:** 31 tests passing (7 protocol + 3 host + 12 setup + 9 CLI).
- [x] **5.6** Run `bun run typecheck` (or `tsc --noEmit`) and clear all TypeScript errors.
  - **Result:** 0 errors.
- [x] **5.7** Smoke test: `bun src/cli.ts --help`, `bun src/cli.ts setup --help`.
  - **Result:** Both work. Compiled binary `./dist/chromectl --help` also works.

---

## Chunk 6: Extension Asset Bundling (Optional but Recommended)
**Goal:** Compile TypeScript extension sources into the JS Chrome expects.

- [x] **6.1** Use `tsc` to compile `extension/background.ts`, `extension/handlers.ts`, and `extension/types.ts` into `dist/extension/*.js`.
  - `extension/tsconfig.json` updated: removed `"noEmit": true`, removed `"allowImportingTsExtensions": true`.
- [x] **6.2** Update `extension/manifest.json` to support ESM service worker (`"type": "module"` in background).
- [x] **6.3** Add `extension/tsconfig.json` with `"lib": ["ES2022", "DOM"]` and `chrome` types via `@types/chrome`.
  - Already existed; adjusted for emit.
- [x] **6.4** Create `extension/types.ts`
  - Copied Request/Response types from `src/types.ts` to make the extension self-contained (no imports outside `extension/`).

---

## Recommended Execution Order

1. **Chunk 0** — you can’t test anything without types and protocol.
2. **Chunk 1** — host + client are the communication backbone.
3. **Chunk 3** — build the extension so the host has something to talk to.
4. **Chunk 2** — CLI is just a thin wrapper over the client; it needs the client to exist.
5. **Chunk 4** — setup automates the manual manifest wiring.
6. **Chunk 6** — only if you want compiled extension JS; otherwise plain `.js` files work.
7. **Chunk 5** — build scripts, tests, polish, ship.
