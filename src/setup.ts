import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, readFileSync, accessSync, constants } from "fs";
import * as p from "@clack/prompts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type Browser = "chrome" | "edge" | "brave";

export function getBrowserProfileDir(browser: Browser): string {
  const platform = process.platform;
  const home = homedir();

  switch (browser) {
    case "chrome": {
      if (platform === "darwin") {
        return join(home, "Library", "Application Support", "Google", "Chrome");
      }
      if (platform === "linux") {
        return join(home, ".config", "google-chrome");
      }
      if (platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
        return join(localAppData, "Google", "Chrome", "User Data");
      }
      break;
    }
    case "edge": {
      if (platform === "darwin") {
        return join(home, "Library", "Application Support", "Microsoft Edge");
      }
      if (platform === "linux") {
        return join(home, ".config", "microsoft-edge");
      }
      if (platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
        return join(localAppData, "Microsoft", "Edge", "User Data");
      }
      break;
    }
    case "brave": {
      if (platform === "darwin") {
        return join(home, "Library", "Application Support", "BraveSoftware", "Brave-Browser");
      }
      if (platform === "linux") {
        return join(home, ".config", "BraveSoftware", "Brave-Browser");
      }
      if (platform === "win32") {
        const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
        return join(localAppData, "BraveSoftware", "Brave-Browser", "User Data");
      }
      break;
    }
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/** @deprecated Use getBrowserProfileDir("chrome") instead. */
export function getChromeProfileDir(): string {
  return getBrowserProfileDir("chrome");
}

export function getHostScriptPath(): string {
  return resolve(join(__dirname, "host.ts"));
}

export function getExtensionDir(): string {
  return resolve(join(__dirname, "..", "extension"));
}

export function getManifestPath(chromeDir?: string): string {
  const dir = chromeDir || getChromeProfileDir();
  return join(dir, "NativeMessagingHosts", "com.chromectl.host.json");
}

export interface Manifest {
  name: string;
  description: string;
  path: string;
  type: string;
  allowed_origins: string[];
}

export function buildManifest(hostPath: string, extId?: string): Manifest {
  return {
    name: "com.chromectl.host",
    description: "chromectl native messaging host",
    path: hostPath,
    type: "stdio",
    allowed_origins: [
      `chrome-extension://${extId || "<EXTENSION_ID>"}/`,
    ],
  };
}

export function writeManifest(manifestPath: string, manifest: Manifest): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

export function validateManifest(manifestPath: string): void {
  try {
    accessSync(manifestPath, constants.F_OK | constants.R_OK);
  } catch {
    throw new Error(`Manifest file is not readable: ${manifestPath}`);
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content) as Manifest;
    if (!parsed.name || !parsed.path || !parsed.type) {
      throw new Error("Manifest file is missing required fields");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("not readable")) {
      throw err;
    }
    throw new Error(`Manifest file is invalid JSON or malformed: ${manifestPath}`);
  }
}

export function setup(opts: { extId?: string; chromeDir?: string } = {}): string {
  const hostPath = getHostScriptPath();
  const manifestPath = getManifestPath(opts.chromeDir);
  const manifest = buildManifest(hostPath, opts.extId);

  writeManifest(manifestPath, manifest);
  validateManifest(manifestPath);

  return manifestPath;
}

export function printSetupInstructions(manifestPath: string, extId?: string, browser?: Browser): void {
  const extensionDir = getExtensionDir();
  const browserName = browser ? browser.charAt(0).toUpperCase() + browser.slice(1) : "Chrome";
  const extProtocol = browser === "edge" ? "edge://extensions/" : "chrome://extensions/";

  console.log(`Native host manifest written to:`);
  console.log(`  ${manifestPath}`);
  console.log();
  console.log(`Manifest allowed_origins:`);
  console.log(`  "chrome-extension://${extId || "<EXTENSION_ID>"}/"`);
  console.log();
  if (!extId) {
    console.log("NOTE: Replace <EXTENSION_ID> with your actual extension ID after loading it.");
  }
  console.log();
  console.log("Next steps:");
  console.log(`1. Open ${browserName} and navigate to ${extProtocol}`);
  console.log("2. Enable Developer mode (toggle in the top-right)");
  console.log("3. Click 'Load unpacked'");
  console.log(`4. Select the extension directory: ${extensionDir}`);
  console.log("5. Copy the extension ID shown in the browser");
  console.log("6. Run: chromectl setup --ext-id <EXTENSION_ID>");
}

export async function interactiveSetup(): Promise<{ manifestPath: string; browser: Browser; extId?: string }> {
  p.intro("chromectl setup");

  const browser = await p.select({
    message: "Which browser do you want to set up?",
    options: [
      { value: "chrome", label: "Google Chrome" },
      { value: "edge", label: "Microsoft Edge" },
      { value: "brave", label: "Brave" },
    ],
  });

  if (p.isCancel(browser)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const selectedBrowser = browser as Browser;

  const hasExtId = await p.confirm({
    message: "Do you already have the extension ID?",
    initialValue: false,
  });

  if (p.isCancel(hasExtId)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  let extId: string | undefined;
  if (hasExtId) {
    const id = await p.text({
      message: "Enter the extension ID:",
      validate: (value) => {
        if (!value || value.trim().length === 0) return "Extension ID is required.";
        if (value.trim().length !== 32) return "Extension ID should be 32 characters.";
        return undefined;
      },
    });

    if (p.isCancel(id)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    extId = id.trim();
  }

  const chromeDir = getBrowserProfileDir(selectedBrowser);
  const manifestPath = setup({ extId, chromeDir });

  p.outro(`Setup complete for ${selectedBrowser.charAt(0).toUpperCase() + selectedBrowser.slice(1)}.`);

  return { manifestPath, browser: selectedBrowser, extId };
}
