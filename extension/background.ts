import type { Request, Response } from "./types";
import { handlers } from "./handlers";

const HOST_NAME = "com.chromectl.host";
const RETRY_DELAY_MS = 5000;

let port: chrome.runtime.Port | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (err) {
    console.error("[chromectl] Failed to connect to native host:", err);
    scheduleRetry();
    return;
  }

  port.onMessage.addListener((msg: unknown) => {
    (async () => {
      try {
        const req = msg as Request;
        const handler = handlers[req.cmd];

        let res: Response;
        if (!handler) {
          res = {
            id: req.id,
            ok: false,
            error: `Unknown command: ${req.cmd}`,
          };
        } else {
          try {
            const data = await handler(req.args ?? [], req.opts ?? {});
            res = { id: req.id, ok: true, data };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res = { id: req.id, ok: false, error: message };
          }
        }

        try {
          port?.postMessage(res);
        } catch (postErr) {
          console.error("[chromectl] Failed to post response:", postErr);
        }
      } catch (unexpectedErr) {
        console.error("[chromectl] Unexpected error handling native message:", unexpectedErr);
      }
    })();
  });

  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    console.error(
      "[chromectl] Native host disconnected:",
      error?.message ?? "unknown error"
    );
    port = null;
    scheduleRetry();
  });

  console.log("[chromectl] Connected to native host");
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, RETRY_DELAY_MS);
}

// Defer the initial connection so it doesn't block service worker registration.
// In Brave (and Chrome), if chrome.runtime.connectNative throws during the
// synchronous evaluation phase of the background script, the service worker
// fails to register with "Status code: 3". A deferred connection lets the
// registration complete first, and repeated failures are handled gracefully
// by scheduleRetry() without crashing the worker.
try {
  setTimeout(connect, 100);
} catch (err) {
  console.error("[chromectl] Failed to schedule initial connection:", err);
}
