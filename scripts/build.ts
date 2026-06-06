import { mkdirSync, cpSync, existsSync, rmSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");
const DIST_DIR = join(ROOT, "dist");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

async function runBuild(): Promise<void> {
  console.log("Building chromectl...");

  // Clean and ensure dist directory
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true, force: true });
  }
  ensureDir(DIST_DIR);

  // Compile CLI binary
  console.log("Compiling CLI binary...");
  const proc = Bun.spawn({
    cmd: ["bun", "build", "--compile", "src/cli.ts", "--outfile", "dist/chromectl"],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`bun build --compile failed with exit code ${exitCode}`);
  }

  // Copy extension files
  console.log("Copying extension files...");
  cpSync(join(ROOT, "extension"), join(DIST_DIR, "extension"), {
    recursive: true,
    force: true,
  });

  // Compile extension TypeScript to JavaScript
  console.log("Compiling extension...");
  const extProc = Bun.spawn({
    cmd: ["tsc", "--project", "extension/tsconfig.json", "--outDir", "dist/extension"],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const extExit = await extProc.exited;
  if (extExit !== 0) {
    throw new Error(`Extension compilation failed with exit code ${extExit}`);
  }

  // Compile host binary
  console.log("Compiling host binary...");
  const hostOutfile = process.platform === "win32" ? "dist/chromectl-host.exe" : "dist/chromectl-host";
  const hostProc = Bun.spawn({
    cmd: ["bun", "build", "--compile", "src/host.ts", "--outfile", hostOutfile],
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  const hostExitCode = await hostProc.exited;
  if (hostExitCode !== 0) {
    throw new Error(`Host binary compilation failed with exit code ${hostExitCode}`);
  }

  // Copy host script and its local dependencies into dist/
  // so that when the compiled binary runs, getHostScriptPath() can fall back
  console.log("Copying host script dependencies...");
  for (const file of ["host.ts", "protocol.ts", "types.ts"]) {
    const src = join(ROOT, "src", file);
    const dest = join(DIST_DIR, file);
    cpSync(src, dest, { force: true });
  }

  console.log("\nBuild complete!");
  console.log(`  Binary: ${join(DIST_DIR, "chromectl")}`);
  console.log(`  Host: ${join(DIST_DIR, process.platform === "win32" ? "chromectl-host.exe" : "chromectl-host")}`);
  console.log(`  Extension: ${join(DIST_DIR, "extension")}`);
}

runBuild().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
