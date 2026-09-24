import { signRequest } from "@panorama/core";
import { session } from "./session";

export interface StreamHandlers {
  fetchImpl?: typeof fetch;
  signal: AbortSignal;
  onEvent: (e: { type: string; data: any }) => void;
  onStatus: (s: "open" | "closed") => void;
}

const BACKOFFS_MS = [1000, 2000, 4000, 15000];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseFrame(frame: string): { type: string; data: unknown } | null {
  let type: string | undefined;
  let dataLine: string | undefined;
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
  }
  if (!type || dataLine === undefined) return null;
  try {
    return { type, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

/** One connection attempt: opens the stream, reads until it ends, and reports what happened. */
async function once(
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  onEvent: (e: { type: string; data: any }) => void,
  onStatus: (s: "open" | "closed") => void,
): Promise<{ stop: boolean; opened: boolean }> {
  const seed = session.getSeed();
  if (!seed) return { stop: true, opened: false };

  const headers = await signRequest(seed, "human", "GET", "/api/v1/stream", "");
  let res: Response;
  try {
    res = await fetchImpl("/api/v1/stream", { headers, signal });
  } catch {
    return { stop: false, opened: false };
  }

  if (res.status === 423 || res.status === 401) {
    session.clear();
    return { stop: true, opened: false };
  }
  if (!res.ok || !res.body) return { stop: false, opened: false };

  onStatus("open");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!frame || frame.startsWith(":")) continue;
        const parsed = parseFrame(frame);
        if (parsed) onEvent(parsed);
      }
    }
  } catch {
    // connection dropped mid-read; fall through and report closed so the loop reconnects
  } finally {
    onStatus("closed");
  }
  return { stop: false, opened: true };
}

/**
 * Opens the authenticated SSE connection and keeps it open, reconnecting with backoff
 * (1s, 2s, 4s, capped at 15s; reset after any successful open) until `signal` aborts.
 * Stops for good on a 401 or 423, since those mean the session is no longer valid.
 */
export async function connectStream(opts: StreamHandlers): Promise<void> {
  const { signal, onEvent, onStatus } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  let attempt = 0;

  while (!signal.aborted) {
    const { stop, opened } = await once(fetchImpl, signal, onEvent, onStatus);
    if (stop) return;
    if (opened) attempt = 0;
    if (signal.aborted) return;
    const delay = BACKOFFS_MS[Math.min(attempt, BACKOFFS_MS.length - 1)];
    attempt++;
    await sleep(delay, signal);
  }
}

/** Pure mapping from a stream event to the query keys it should invalidate. */
export function invalidationsFor(type: string, data: any): unknown[][] {
  if (type.startsWith("ticket.")) {
    return [["queue"], ["tickets"], ["ticket", data.id], ["gates", data.id]];
  }
  if (type === "comment.added" || type === "evidence.added" || type === "attachment.added") {
    return [["thread", data.ticketId], ["ticket", data.ticketId], ["gates", data.ticketId], ["queue"]];
  }
  if (type.startsWith("agent.")) {
    return [["agents"]];
  }
  if (type.startsWith("lane.") || type.startsWith("project.")) {
    return [["lanes"], ["projects"], ["gates"]];
  }
  if (type.startsWith("board.")) {
    return [["boards", data.projectId]];
  }
  if (type.startsWith("epic.")) {
    return [["epics"]];
  }
  if (type.startsWith("tag.")) {
    return [["tags"]];
  }
  if (type.startsWith("field.")) {
    return [["fields"]];
  }
  return [];
}
