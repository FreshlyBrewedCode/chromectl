import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { mkdirSync, writeFileSync, readFileSync, accessSync, constants } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getChromeProfileDir(): string {
  const platform = process.platform;
  const home = homedir();

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

  throw new Error(`Unsupported platform: ${platform}`);
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

export function printSetupInstructions(manifestPath: string, extId?: string): void {
  const extensionDir = getExtensionDir();

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
  console.log("1. Open Chrome and navigate to chrome://extensions/");
  console.log("2. Enable Developer mode (toggle in the top-right)");
  console.log("3. Click 'Load unpacked'");
  console.log(`4. Select the extension directory: ${extensionDir}`);
  console.log("5. Copy the extension ID shown in Chrome");
  console.log("6. Run: chromectl setup --ext-id <EXTENSION_ID>");
}
