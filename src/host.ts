import { createServer, createConnection, type Server, type Socket } from "net";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";
import { type Request, type Response } from "./types.ts";
import { encode, decode } from "./protocol.ts";

const SOCKET_PATH = join(homedir(), ".chromectl", "chromectl.sock");
const TIMEOUT_MS = Number(process.env.CHROMECTL_TIMEOUT) || 5000;

export function getSocketPath(): string {
  return process.platform === "win32"
    ? "\\\\.\\pipe\\chromectl"
    : SOCKET_PATH;
}

export function ensureSocketDir(): void {
  if (process.platform !== "win32") {
    mkdirSync(join(homedir(), ".chromectl"), { recursive: true });
  }
}

export function cleanupSocket(): void {
  if (process.platform !== "win32") {
    try {
      rmSync(SOCKET_PATH, { force: true });
    } catch {
      // ignore
    }
  }
}

export function isHostMode(): boolean {
  return process.argv.includes("--host") || !process.stdin.isTTY;
}

export function createExtensionPort(): chrome.runtime.Port | null {
  // This is only used in the browser extension context.
  // In Node.js host mode, we read stdin directly.
  return null;
}

export function startHost(): {
  server: Server;
  pendingRequests: Map<string, (res: Response) => void>;
} {
  cleanupSocket();
  ensureSocketDir();

  const pendingRequests = new Map<string, (res: Response) => void>();
  let server: Server;

  const handleCliConnection = (socket: Socket) => {
    let buffer = "";

    socket.on("data", (data: Buffer) => {
      buffer += data.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let req: Request;
        try {
          req = JSON.parse(line) as Request;
        } catch {
          const errRes: Response = {
            id: "",
            ok: false,
            error: "Invalid JSON in socket request",
          };
          socket.write(JSON.stringify(errRes) + "\n");
          continue;
        }

        // Forward to extension via stdin/stdout
        const timeout = setTimeout(() => {
          if (pendingRequests.has(req.id)) {
            pendingRequests.delete(req.id);
            const errRes: Response = {
              id: req.id,
              ok: false,
              error: "Extension disconnected or timed out",
            };
            socket.write(JSON.stringify(errRes) + "\n");
          }
        }, TIMEOUT_MS);

        pendingRequests.set(req.id, (res: Response) => {
          clearTimeout(timeout);
          pendingRequests.delete(req.id);
          socket.write(JSON.stringify(res) + "\n");
        });

        const encoded = encode(req);
        process.stdout.write(encoded);
      }
    });

    socket.on("error", () => {
      // ignore socket errors
    });
  };

  server = createServer(handleCliConnection);

  server.listen(getSocketPath(), () => {
    console.error("[chromectl] Host listening on", getSocketPath());
  });

  // Read from stdin (Chrome extension → host)
  (async () => {
    try {
      for await (const res of decode(process.stdin)) {
        const typed = res as Response;
        const handler = pendingRequests.get(typed.id);
        if (handler) {
          handler(typed);
        }
      }
    } catch (err) {
      console.error("[chromectl] Protocol error:", err);
    } finally {
      console.error("[chromectl] Extension disconnected, shutting down.");
      cleanupSocket();
      server.close();
      process.exit(0);
    }
  })();

  return { server, pendingRequests };
}

if (import.meta.main && isHostMode()) {
  startHost();
}
