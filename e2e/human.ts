// The two modules by path rather than the package index: index.ts also exports the cost
// module, whose JSON import Playwright's Node loader refuses without an import attribute.
import { deriveKeys } from "@boomerang/core/src/keys.ts";
import { signRequest } from "@boomerang/core/src/signing.ts";

/**
 * The owner's own key, outside the browser: the spec asks the server for the salt and the
 * KDF parameters it stored at setup and derives the same seed the browser holds, so it can
 * sign calls the page has no surface for (the chain head, the event stream) and check what
 * a browser action wrote, or did not.
 */

export interface StreamEvent {
  seq: number;
  type: string;
  payload: any;
}

export interface Stream {
  /** Every event received so far, in order. */
  events: StreamEvent[];
  /** The first event that matches, already received or still to come. */
  waitFor(pred: (e: StreamEvent) => boolean, timeoutMs?: number): Promise<StreamEvent>;
  close(): void;
}

function parseFrame(frame: string): StreamEvent | null {
  let seq = 0;
  let type: string | undefined;
  let data: string | undefined;
  for (const line of frame.split("\n")) {
    if (line.startsWith("id:")) seq = Number(line.slice(3).trim());
    else if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (!type || data === undefined) return null;
  try {
    return { seq, type, payload: JSON.parse(data) };
  } catch {
    return null;
  }
}

export async function humanHarness(baseURL: string, password: string) {
  const status = (await (await fetch(`${baseURL}/api/v1/status`)).json()) as { kdfSalt: string; argon: Parameters<typeof deriveKeys>[2] };
  const { seed } = await deriveKeys(password, status.kdfSalt, status.argon);

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { ...(await signRequest(seed, "human", method, path, payload)) };
    if (payload) headers["content-type"] = "application/json";
    const res = await fetch(baseURL + path, { method, headers, body: payload || undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  async function openStream(): Promise<Stream> {
    const controller = new AbortController();
    const headers = await signRequest(seed, "human", "GET", "/api/v1/stream", "");
    const res = await fetch(`${baseURL}/api/v1/stream`, { headers, signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`the stream answered ${res.status}`);
    const events: StreamEvent[] = [];
    const waiters: { pred: (e: StreamEvent) => boolean; resolve: (e: StreamEvent) => void }[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let at: number;
          while ((at = buffer.indexOf("\n\n")) >= 0) {
            const ev = parseFrame(buffer.slice(0, at));
            buffer = buffer.slice(at + 2);
            if (!ev) continue;
            events.push(ev);
            for (const w of [...waiters]) {
              if (!w.pred(ev)) continue;
              waiters.splice(waiters.indexOf(w), 1);
              w.resolve(ev);
            }
          }
        }
      } catch {
        // closed
      }
    })();
    return {
      events,
      waitFor(pred, timeoutMs = 15_000) {
        const hit = events.find(pred);
        if (hit) return Promise.resolve(hit);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no matching event on the stream within ${timeoutMs} ms; saw ${events.map((e) => e.type).join(", ")}`)), timeoutMs);
          waiters.push({ pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
        });
      },
      close: () => controller.abort(),
    };
  }

  return { call, openStream };
}
