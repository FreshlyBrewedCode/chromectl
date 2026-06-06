import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getChromeProfileDir,
  getHostScriptPath,
  getManifestPath,
  buildManifest,
  validateManifest,
  validateHostPath,
  setup,
  getExtensionDir,
} from "./setup.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "chromectl-test-"));
}

function makeTempExecutable(): string {
  const dir = makeTempDir();
  const path = join(dir, "chromectl-host");
  writeFileSync(path, "#!/usr/bin/env sh\necho test", "utf-8");
  chmodSync(path, 0o755);
  return path;
}

test("getChromeProfileDir returns expected path for current platform", () => {
  const dir = getChromeProfileDir();
  expect(typeof dir).toBe("string");
  expect(dir.length).toBeGreaterThan(0);

  const platform = process.platform;
  if (platform === "darwin") {
    expect(dir).toContain("Library/Application Support/Google/Chrome");
  } else if (platform === "linux") {
    expect(dir).toContain(".config/google-chrome");
  } else if (platform === "win32") {
    expect(dir).toContain("Google/Chrome/User Data");
  }
});

test("getHostScriptPath returns an absolute path ending in host.ts or chromectl-host", () => {
  const path = getHostScriptPath();
  const isHostTs = path.endsWith("host.ts");
  const isBinary = path.endsWith("chromectl-host") || path.endsWith("chromectl-host.exe");
  expect(isHostTs || isBinary).toBe(true);
  expect(path.startsWith("/")).toBe(true);
});

test("getManifestPath defaults to Chrome profile + NativeMessagingHosts", () => {
  const defaultPath = getManifestPath();
  expect(defaultPath).toContain("NativeMessagingHosts");
  expect(defaultPath.endsWith("com.chromectl.host.json")).toBe(true);
});

test("getManifestPath accepts custom chromeDir override", () => {
  const custom = getManifestPath("/some/path");
  expect(custom).toBe("/some/path/NativeMessagingHosts/com.chromectl.host.json");
});

test("buildManifest with no extId uses placeholder", () => {
  const manifest = buildManifest("/path/to/host");
  expect(manifest.name).toBe("com.chromectl.host");
  expect(manifest.path).toBe("/path/to/host");
  expect(manifest.type).toBe("stdio");
  expect(manifest.allowed_origins).toEqual(["chrome-extension://<EXTENSION_ID>/"]);
});

test("buildManifest with extId injects the real ID", () => {
  const manifest = buildManifest("/path/to/host", "abc123def456");
  expect(manifest.allowed_origins).toEqual(["chrome-extension://abc123def456/"]);
});

test("setup creates the manifest file in the correct location", () => {
  const tempDir = makeTempDir();
  const hostPath = makeTempExecutable();

  try {
    const manifestPath = setup({ chromeDir: tempDir, hostPath });
    expect(existsSync(manifestPath)).toBe(true);
    expect(manifestPath).toBe(
      join(tempDir, "NativeMessagingHosts", "com.chromectl.host.json")
    );

    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe("com.chromectl.host");
    expect(parsed.type).toBe("stdio");
    expect(parsed.path).toBe(hostPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(hostPath, { recursive: true, force: true });
  }
});

test("setup with extId updates the manifest with the correct ID", () => {
  const tempDir = makeTempDir();
  const hostPath = makeTempExecutable();

  try {
    const manifestPath = setup({ chromeDir: tempDir, extId: "testid123456", hostPath });
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.allowed_origins).toEqual(["chrome-extension://testid123456/"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(hostPath, { recursive: true, force: true });
  }
});

test("setup validates that the manifest exists after writing", () => {
  const tempDir = makeTempDir();
  const hostPath = makeTempExecutable();

  try {
    const manifestPath = setup({ chromeDir: tempDir, hostPath });
    expect(() => validateManifest(manifestPath)).not.toThrow();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(hostPath, { recursive: true, force: true });
  }
});

test("validateManifest throws when file is missing", () => {
  expect(() => validateManifest("/nonexistent/path/manifest.json")).toThrow();
});

test("validateManifest throws when file has invalid JSON", () => {
  const tempDir = makeTempDir();
  const badPath = join(tempDir, "bad.json");

  try {
    writeFileSync(badPath, "not json", "utf-8");
    expect(() => validateManifest(badPath)).toThrow();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("validateHostPath throws when file is missing", () => {
  expect(() => validateHostPath("/nonexistent/path/chromectl-host")).toThrow();
});

test("validateHostPath throws when file is not executable", () => {
  if (process.platform === "win32") {
    // Skip executable check on Windows
    return;
  }

  const tempDir = makeTempDir();
  const nonExecutable = join(tempDir, "not-executable");

  try {
    writeFileSync(nonExecutable, "#!/bin/sh\necho test", "utf-8");
    chmodSync(nonExecutable, 0o644);
    expect(() => validateHostPath(nonExecutable)).toThrow();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("validateHostPath succeeds for executable file", () => {
  const hostPath = makeTempExecutable();
  try {
    expect(() => validateHostPath(hostPath)).not.toThrow();
  } finally {
    rmSync(hostPath, { recursive: true, force: true });
  }
});

test("getExtensionDir returns an absolute path ending in extension", () => {
  const dir = getExtensionDir();
  expect(dir.endsWith("extension")).toBe(true);
  expect(dir.startsWith("/")).toBe(true);
});
