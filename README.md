# chromectl

Command-line control for your Chromium browser. Tabs, groups, and windows — from the terminal.

## Install

chromectl requires [Bun](https://bun.sh) (>= 1.0.0).

```bash
bun install -g chromectl
```

You can also install via npm (Bun is still required at runtime):

```bash
npm install -g chromectl
```

## Setup (one-time)

chromectl uses Chrome's **Native Messaging** API to talk to a companion browser extension. Run the setup command to install the native host manifest:

```bash
chromectl setup
```

This writes the native host manifest to your Chrome profile directory. Then load the extension:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the extension directory shown in the setup output (usually the `extension/` folder from this package)
5. Copy the **Extension ID** shown in Chrome
6. Run: `chromectl setup --ext-id <EXTENSION_ID>` to update the manifest with your real extension ID

After setup, the extension auto-connects whenever Chrome starts.

## Usage

```bash
# Tabs
chromectl tab list
chromectl tab open <url>
chromectl tab close <id>
chromectl tab focus <id>
chromectl tab group <id> <group-name>

# Groups
chromectl group list
chromectl group collapse <name>
chromectl group expand <name>

# Windows
chromectl window list
chromectl window focus <id>

# Raw chrome.* API passthrough
chromectl raw tabs query {}
```

### Tab ID resolution

Anywhere an `<id>` is expected, you can use:

- A **numeric** Chrome tab ID: `42`
- A **URL substring**: `github.com`
- A **title substring**: `"My Project"`

The extension resolves the first match automatically.

```bash
chromectl tab close github.com
chromectl tab focus "My Project"
chromectl tab group 42 "Reading"
```

## How it works

```
┌─────────────┐      stdin/stdout      ┌──────────────┐      chrome.* APIs      ┌─────────┐
│   Bun CLI   │ ◄────────────────────► │ Native Host  │ ◄────────────────────► │ Extension │
│  (chromectl)│   length-prefixed JSON │ (node script)│   (runtime messages)   │ (service  │
└─────────────┘                        └──────────────┘                        │  worker)  │
                                                                              └─────────┘
```

1. **CLI** — Bun executable, parses arguments, spawns the native host, writes a request, prints the response.
2. **Native Messaging Host** — A Node.js/Bun script registered with Chrome. Bridges the binary native messaging protocol to the extension via `runtime.connectNative()`.
3. **Extension** — Manifest V3 service worker that calls `chrome.tabs`, `chrome.tabGroups`, `chrome.windows` and returns results.

The browser manages the stdin/stdout pipe. No open ports, no remote debugging flags, no WebSocket servers.

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Build compiled binary and extension assets
bun run build
```

## License

MIT
