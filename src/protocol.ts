import type { Request, Response } from "./types.ts";

export function encode(msg: Request | Response): Buffer {
  const json = JSON.stringify(msg);
  const payload = Buffer.from(json, "utf-8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export async function* decode(
  readable: ReadableStream<Uint8Array> | NodeJS.ReadableStream
): AsyncGenerator<Request | Response> {
  let buffer = Buffer.alloc(0);

  const reader =
    "getReader" in readable
      ? readable.getReader()
      : null;

  while (true) {
    let chunk: Uint8Array | null = null;

    if (reader) {
      const result = await reader.read();
      if (result.done) break;
      chunk = result.value;
    } else {
      const nodeReadable = readable as NodeJS.ReadableStream;
      const data = await new Promise<Buffer | null>((resolve) => {
        nodeReadable.once("data", (d: Buffer) => resolve(d));
        nodeReadable.once("end", () => resolve(null));
        nodeReadable.once("error", () => resolve(null));
      });
      if (data === null) break;
      chunk = new Uint8Array(data);
    }

    if (!chunk) break;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > 16 * 1024 * 1024) {
        throw new Error(`Invalid message length: ${length}`);
      }
      if (buffer.length < 4 + length) break;

      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);

      const text = payload.toString("utf-8");
      let msg: Request | Response;
      try {
        msg = JSON.parse(text) as Request | Response;
      } catch {
        throw new Error("Invalid JSON in message payload");
      }
      yield msg;
    }
  }
}
