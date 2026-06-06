import { createConnection, type Socket } from "net";
import { type Request, type Response } from "./types.ts";
import { getSocketPath } from "./host.ts";

export function send(req: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath();
    const socket = createConnection(socketPath);

    let buffer = "";
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

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
            reject(new Error("Invalid JSON in socket response"));
            return;
          }
        }
      }
    });

    socket.on("error", (err: Error) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new Error(
              "chromectl host not running. Run `chromectl setup` and load the extension."
            )
          );
        } else {
          reject(err);
        }
      }
    });

    socket.on("end", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error("Socket closed before response received"));
      }
    });

    socket.on("timeout", () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error("Socket timeout"));
      }
    });
  });
}
