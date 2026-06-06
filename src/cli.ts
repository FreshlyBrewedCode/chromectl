import mri from "mri";
import { commands } from "./commands.ts";
import { send } from "./client.ts";
import { printSetupInstructions, setup } from "./setup.ts";
import { version } from "../package.json" assert { type: "json" };

function printUsage(): void {
  console.log(`chromectl v${version}

Usage: chromectl <domain> <action> [args...] [options]

Domains: tab, group, window, raw

Commands:`);
  for (const [cmd, info] of Object.entries(commands)) {
    console.log(`  ${cmd.padEnd(18)} ${info.desc}`);
  }
  console.log(`
Options:
  --version          Show version
  --help             Show this help

Tab ID resolution:
  IDs can be numeric Chrome tab IDs, URL substrings, or title substrings.
  Resolution happens in the browser extension.`);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function main(argv: string[]): Promise<number> {
  const parsed = mri(argv, {
    alias: { h: "help", v: "version" },
    boolean: ["help", "version"],
    string: ["ext-id", "chrome-dir"],
  });

  if (parsed.version) {
    console.log(`chromectl v${version}`);
    return 0;
  }

  if (parsed.help) {
    printUsage();
    return 0;
  }

  const positional = parsed._;

  if (positional.length === 0) {
    printUsage();
    return 1;
  }

  // Special case: setup is a top-level command
  if (positional[0] === "setup") {
    try {
      const opts: { extId?: string; chromeDir?: string } = {};
      if (parsed["ext-id"]) opts.extId = String(parsed["ext-id"]);
      if (parsed["chrome-dir"]) opts.chromeDir = String(parsed["chrome-dir"]);
      const manifestPath = setup(opts);
      printSetupInstructions(manifestPath, opts.extId);
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      return 1;
    }
  }

  if (positional.length < 2) {
    console.error("Error: expected <domain> <action>");
    printUsage();
    return 1;
  }

  const domain = positional[0];
  const action = positional[1];
  const cmdKey = `${domain}.${action}`;

  if (!commands[cmdKey]) {
    console.error(`Error: unknown command "${cmdKey}"`);
    printUsage();
    return 1;
  }

  const args = positional.slice(2);
  const opts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "_" || key === "help" || key === "version") continue;
    opts[key] = value;
  }

  const req = {
    id: generateId(),
    cmd: cmdKey,
    args,
    opts,
  };

  try {
    const res = await send(req);
    if (res.ok) {
      if (res.data !== undefined) {
        console.log(JSON.stringify(res.data, null, 2));
      }
      return 0;
    } else {
      console.error(res.error ?? "Unknown error");
      return 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
