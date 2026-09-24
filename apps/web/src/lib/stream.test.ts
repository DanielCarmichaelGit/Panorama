import { afterEach, describe, expect, it, vi } from "vitest";
import { ARGON_FAST, deriveKeys } from "@panorama/core";
import { connectStream, invalidationsFor } from "./stream";
import { session } from "./session";

afterEach(() => {
  session.clear();
});

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe("connectStream", () => {
  it("parses SSE frames split across chunks, ignores comments, and stops reconnecting once aborted", async () => {
    const k = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST);
    session.setSeed(k.seed);

    const frame = 'id: 1\nevent: ticket.moved\ndata: {"id":"t1","projectId":"p"}\n\n';
    const body = sseBody([": connected\n\n", frame.slice(0, 20), frame.slice(20)]);
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));

    const events: { type: string; data: unknown }[] = [];
    const statuses: ("open" | "closed")[] = [];
    const controller = new AbortController();

    const done = connectStream({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
    });

    await vi.waitFor(() => expect(statuses).toEqual(["open", "closed"]));
    controller.abort();
    await done;

    expect(events).toEqual([{ type: "ticket.moved", data: { id: "t1", projectId: "p" } }]);
    expect(statuses).toEqual(["open", "closed"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops reconnecting and clears the session on a 423 or 401", async () => {
    const k = await deriveKeys("test-password-123", "00".repeat(16), ARGON_FAST);
    session.setSeed(k.seed);

    const fetchImpl = vi.fn(async () => new Response(null, { status: 423 }));
    const controller = new AbortController();

    await connectStream({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
      onEvent: () => {},
      onStatus: () => {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(session.getSeed()).toBeNull();
  });
});

describe("invalidationsFor", () => {
  it("invalidates ticket keys on a ticket.* event", () => {
    const keys = invalidationsFor("ticket.moved", { id: "t1", projectId: "p" });
    expect(keys).toContainEqual(["queue"]);
    expect(keys).toContainEqual(["tickets"]);
    expect(keys).toContainEqual(["ticket", "t1"]);
    expect(keys).toContainEqual(["gates", "t1"]);
  });

  it("invalidates the thread and queue on comment.added, evidence.added, and attachment.added", () => {
    for (const type of ["comment.added", "evidence.added", "attachment.added"]) {
      const keys = invalidationsFor(type, { ticketId: "t1" });
      expect(keys).toContainEqual(["thread", "t1"]);
      expect(keys).toContainEqual(["ticket", "t1"]);
      expect(keys).toContainEqual(["gates", "t1"]);
      expect(keys).toContainEqual(["queue"]);
    }
  });

  it("invalidates links, gates, and ticket keys for both ends of a ticket.linked or ticket.unlinked event", () => {
    // The link's own id rides in `id`, not a ticket id, so this must not fall into the generic
    // ticket.* branch (which would invalidate ["ticket", <link id>] instead of either real ticket).
    for (const type of ["ticket.linked", "ticket.unlinked"]) {
      const keys = invalidationsFor(type, { id: "link1", fromId: "t1", toId: "t2", kind: "blocks" });
      expect(keys).toContainEqual(["links", "t1"]);
      expect(keys).toContainEqual(["links", "t2"]);
      expect(keys).toContainEqual(["gates", "t1"]);
      expect(keys).toContainEqual(["gates", "t2"]);
      expect(keys).toContainEqual(["ticket", "t1"]);
      expect(keys).toContainEqual(["ticket", "t2"]);
      expect(keys).not.toContainEqual(["ticket", "link1"]);
    }
  });

  it("invalidates agents on an agent.* event", () => {
    expect(invalidationsFor("agent.approved", { id: "a1" })).toEqual([["agents"]]);
  });

  it("invalidates lanes, projects, and gates on lane.* and project.* events", () => {
    expect(invalidationsFor("lane.created", {})).toEqual([["lanes"], ["projects"], ["gates"]]);
    expect(invalidationsFor("project.created", {})).toEqual([["lanes"], ["projects"], ["gates"]]);
  });

  it("invalidates epics, tags, and fields on their own events", () => {
    expect(invalidationsFor("epic.archived", {})).toEqual([["epics"]]);
    expect(invalidationsFor("tag.created", {})).toEqual([["tags"]]);
    expect(invalidationsFor("field.updated", {})).toEqual([["fields"]]);
  });
});
