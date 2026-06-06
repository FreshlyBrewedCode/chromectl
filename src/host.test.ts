import { test, expect } from "bun:test";
import { createConnection } from "net";
import { existsSync } from "fs";
import { encode, decode } from "./protocol.ts";
import { type Request, type Response } from "./types.ts";
import { getSocketPath, cleanupSocket } from "./host.ts";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSocket(maxMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (existsSync(getSocketPath())) {
      // Try to connect to ensure it's actually accepting connections
      try {
        const conn = createConnection(getSocketPath());
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            conn.destroy();
            reject(new Error("Connection timeout"));
          }, 200);
          conn.once("connect", () => {
            clearTimeout(timer);
            conn.destroy();
            resolve();
          });
          conn.once("error", (err: Error) => {
            clearTimeout(timer);
            conn.destroy();
            reject(err);
          });
        });
        return;
      } catch {
        // Socket file exists but not ready yet, keep polling
      }
    }
    await sleep(50);
  }
  throw new Error("Socket did not become available in time");
}

function socketSend(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(getSocketPath());
    let buffer = "";
    let resolved = false;

    socket.on("connect", () => {
      socket.write(JSON.stringify(req) + "\n");
    });

    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res = JSON.parse(line) as Response;
          if (!resolved) {
            resolved = true;
            socket.destroy();
            resolve(res);
            return;
          }
        } catch {
          if (!resolved) {
            resolved = true;
            socket.destroy();
            reject(new Error("Invalid JSON response"));
            return;
          }
        }
      }
    });

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(err);
      }
    });

    socket.on("end", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error("Socket closed before response"));
      }
    });
  });
}

test("host round-trips a request via socket", async () => {
  cleanupSocket();

  const host = Bun.spawn({
    cmd: ["bun", "run", "src/host.ts", "--host"],
    cwd: "/mnt/shares/research/chromectl",
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForSocket(3000);

  const req: Request = {
    id: "test-1",
    cmd: "tab.list",
    args: [],
    opts: {},
  };

  const res: Response = {
    id: "test-1",
    ok: true,
    data: [{ id: 1, title: "Test" }],
  };

  // Listen on host.stdout for the forwarded request, then reply
  (async () => {
    try {
      for await (const msg of decode(host.stdout)) {
        if ((msg as Request).id === req.id) {
          host.stdin.write(encode(res));
          break;
        }
      }
    } catch {
      // ignore
    }
  })();

  const result = await socketSend(req);

  expect(result.id).toBe("test-1");
  expect(result.ok).toBe(true);
  expect(result.data).toEqual([{ id: 1, title: "Test" }]);

  host.stdin.end();
  host.kill();
  await sleep(300);
  cleanupSocket();
});

test("host times out when no extension response", async () => {
  cleanupSocket();

  const host = Bun.spawn({
    cmd: ["bun", "run", "src/host.ts", "--host"],
    cwd: "/mnt/shares/research/chromectl",
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CHROMECTL_TIMEOUT: "100" },
  });

  await waitForSocket(3000);

  const req: Request = {
    id: "test-timeout",
    cmd: "tab.list",
    args: [],
    opts: {},
  };

  const result = await socketSend(req);

  expect(result.id).toBe("test-timeout");
  expect(result.ok).toBe(false);
  expect(result.error).toContain("timed out");

  host.stdin.end();
  host.kill();
  await sleep(300);
  cleanupSocket();
});

test("host cleans up socket on exit", async () => {
  cleanupSocket();

  const host = Bun.spawn({
    cmd: ["bun", "run", "src/host.ts", "--host"],
    cwd: "/mnt/shares/research/chromectl",
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForSocket(3000);

  {
    const conn = createConnection(getSocketPath());
    conn.on("error", () => {});
    conn.destroy();
  }

  host.stdin.end();
  await host.exited;

  expect(existsSync(getSocketPath())).toBe(false);
  cleanupSocket();
});
