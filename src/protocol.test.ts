import { test, expect } from "bun:test";
import { encode, decode } from "./protocol.ts";
import type { Request, Response } from "./types.ts";

test("encode produces correct length-prefixed JSON", () => {
  const msg: Request = { id: "abc", cmd: "tab.list" };
  const buf = encode(msg);
  expect(buf.length).toBeGreaterThan(4);

  const length = buf.readUInt32LE(0);
  const payload = buf.subarray(4).toString("utf-8");
  const parsed = JSON.parse(payload) as Request;

  expect(length).toBe(Buffer.byteLength(payload, "utf-8"));
  expect(parsed.id).toBe("abc");
  expect(parsed.cmd).toBe("tab.list");
});

test("decode round-trips a single message", async () => {
  const msg: Response = { id: "xyz", ok: true, data: [1, 2, 3] };
  const buf = encode(msg);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });

  const results: (Request | Response)[] = [];
  for await (const m of decode(stream)) {
    results.push(m);
  }

  expect(results.length).toBe(1);
  expect(results[0]).toEqual(msg);
});

test("decode handles multiple messages in one stream", async () => {
  const msgs: (Request | Response)[] = [
    { id: "a", cmd: "tab.list" },
    { id: "b", ok: true, data: "hello" },
    { id: "c", cmd: "tab.close", args: [42] },
  ];

  const chunks = Buffer.concat(msgs.map(encode));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(chunks));
      controller.close();
    },
  });

  const results: (Request | Response)[] = [];
  for await (const m of decode(stream)) {
    results.push(m);
  }

  expect(results.length).toBe(3);
  expect(results).toEqual(msgs);
});

test("decode handles empty stream", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

  const results: (Request | Response)[] = [];
  for await (const m of decode(stream)) {
    results.push(m);
  }

  expect(results.length).toBe(0);
});

test("decode handles partial reads", async () => {
  const msg: Request = { id: "partial", cmd: "window.list" };
  const buf = encode(msg);

  // Split into tiny chunks
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < buf.length; i++) {
    chunks.push(new Uint8Array(buf.subarray(i, i + 1)));
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const results: (Request | Response)[] = [];
  for await (const m of decode(stream)) {
    results.push(m);
  }

  expect(results.length).toBe(1);
  expect(results[0]).toEqual(msg);
});

test("decode throws on invalid length", async () => {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32LE(20 * 1024 * 1024, 0); // 20MB, exceeds 16MB limit

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });

  await expect(
    (async () => {
      for await (const _ of decode(stream)) {
        // consume
      }
    })()
  ).rejects.toThrow("Invalid message length");
});

test("decode throws on invalid JSON payload", async () => {
  const payload = Buffer.from("not-json{{{", "utf-8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  const buf = Buffer.concat([header, payload]);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });

  await expect(
    (async () => {
      for await (const _ of decode(stream)) {
        // consume
      }
    })()
  ).rejects.toThrow("Invalid JSON");
});
