import { test, expect, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock the client module so send() throws without connecting to a real socket
mock.module("./client.ts", () => ({
  send: async () => {
    throw new Error("Connection failed");
  },
}));

import { main } from "./cli.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "chromectl-cli-test-"));
}

function captureOutput(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];

  const origLog = console.log;
  const origError = console.error;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };

  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

test("--help returns 0 and prints usage", async () => {
  const capture = captureOutput();
  try {
    const code = await main(["--help"]);
    expect(code).toBe(0);
    const output = capture.logs.join("\n");
    expect(output).toContain("Usage:");
    expect(output).toContain("chromectl");
  } finally {
    capture.restore();
  }
});

test("--version returns 0 and prints version", async () => {
  const capture = captureOutput();
  try {
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(capture.logs.length).toBeGreaterThan(0);
    expect(capture.logs[0]).toContain("chromectl");
    expect(capture.logs[0]).toMatch(/\d+\.\d+\.\d+/);
  } finally {
    capture.restore();
  }
});

test("no arguments returns 1 and prints usage", async () => {
  const capture = captureOutput();
  try {
    const code = await main([]);
    expect(code).toBe(1);
    const output = capture.logs.join("\n");
    expect(output).toContain("Usage:");
  } finally {
    capture.restore();
  }
});

test("unknown command returns 1 and prints error", async () => {
  const capture = captureOutput();
  try {
    const code = await main(["tab", "nonexistent"]);
    expect(code).toBe(1);
    const errOutput = capture.errors.join("\n");
    expect(errOutput).toContain("unknown command");
  } finally {
    capture.restore();
  }
});

test("missing action returns 1 and prints error", async () => {
  const capture = captureOutput();
  try {
    const code = await main(["tab"]);
    expect(code).toBe(1);
    const errOutput = capture.errors.join("\n");
    expect(errOutput).toContain("expected <domain> <action>");
  } finally {
    capture.restore();
  }
});

test("setup command works correctly with temp dir", async () => {
  const tempDir = makeTempDir();
  const capture = captureOutput();

  try {
    const code = await main(["setup", "--chrome-dir", tempDir]);
    expect(code).toBe(0);

    const manifestPath = join(tempDir, "NativeMessagingHosts", "com.chromectl.host.json");
    expect(existsSync(manifestPath)).toBe(true);

    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe("com.chromectl.host");
    expect(parsed.type).toBe("stdio");
    expect(parsed.path.endsWith("host.ts")).toBe(true);

    const output = capture.logs.join("\n");
    expect(output).toContain("Native host manifest written to");
    expect(output).toContain(manifestPath);
  } finally {
    capture.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("setup command with ext-id works correctly", async () => {
  const tempDir = makeTempDir();
  const capture = captureOutput();

  try {
    const code = await main(["setup", "--chrome-dir", tempDir, "--ext-id", "testextid123"]);
    expect(code).toBe(0);

    const manifestPath = join(tempDir, "NativeMessagingHosts", "com.chromectl.host.json");
    const content = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.allowed_origins).toEqual(["chrome-extension://testextid123/"]);

    const output = capture.logs.join("\n");
    expect(output).toContain("testextid123");
  } finally {
    capture.restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("malformed command still attempts to send and returns error", async () => {
  const capture = captureOutput();
  try {
    // tab open requires a URL, but we don't provide one
    const code = await main(["tab", "open"]);
    // send() mock throws, which main catches and returns 1
    expect(code).toBe(1);
    const errOutput = capture.errors.join("\n");
    expect(errOutput.length).toBeGreaterThan(0);
  } finally {
    capture.restore();
  }
});

test("valid command without host returns error because send fails", async () => {
  const capture = captureOutput();
  try {
    const code = await main(["tab", "list"]);
    expect(code).toBe(1);
    const errOutput = capture.errors.join("\n");
    expect(errOutput.length).toBeGreaterThan(0);
  } finally {
    capture.restore();
  }
});
