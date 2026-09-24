// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lane, Ticket } from "@panorama/core";
import { api } from "../lib/api";
import { TicketPanel } from "./TicketPanel";

// TipTap's ProseMirror view measures text layout on mount, which jsdom does not implement.
(Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null });
(Range.prototype as any).getBoundingClientRect = () => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {},
});

vi.mock("../lib/api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));

afterEach(cleanup);

const lane = (over: Partial<Lane>): Lane => ({
  id: "l1", projectId: "p1", name: "Backlog", position: 0, family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [], ...over,
});

const ticket: Ticket = {
  id: "t1", projectId: "p1", boardId: "b1", number: 1, key: "PAN-1", title: "Ship it", laneId: "l1", position: 1,
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T10:00:00.000Z",
};

const lanes = [lane({}), lane({ id: "l2", name: "Ready", position: 1 })];

/** Renders the panel with the gates query held open until `resolveGates` is called. */
function renderPanel(entry = "/t/t1") {
  let resolveGates!: (v: Record<string, unknown>) => void;
  const gates = new Promise<Record<string, unknown>>((resolve) => { resolveGates = resolve; });
  vi.mocked(api).mockImplementation((async (method: string, path: string) => {
    if (method === "GET" && path === "/api/v1/tickets/t1") return ticket;
    if (method === "GET" && path === "/api/v1/projects/p1/lanes") return lanes;
    if (method === "GET" && path === "/api/v1/agents") return [];
    if (method === "GET" && path === "/api/v1/evidence-types") return [];
    if (method === "GET" && path === "/api/v1/tickets/t1/thread") return { comments: [], attachments: [], evidence: [], actors: [] };
    if (method === "GET" && path === "/api/v1/tickets/t1/gates") return gates;
    throw new Error(`unexpected ${method} ${path}`);
  }) as any);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TicketPanel id="t1" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { resolveGates };
}

const option = (name: string) => screen.getByRole("option", { name }) as HTMLOptionElement;

describe("TicketPanel lane select", () => {
  it("offers only the current lane until the gates are known, then opens the rest", async () => {
    const { resolveGates } = renderPanel();
    await screen.findByRole("option", { name: "Ready" });

    // The gates have not come back yet: nothing is known about what Ready needs, so it stays shut.
    expect(option("Ready").disabled).toBe(true);
    expect(option("Backlog").disabled).toBe(false);

    resolveGates({ l1: [], l2: [] });
    await waitFor(() => expect(option("Ready").disabled).toBe(false));
  });

  it("keeps a lane shut when the gates say it is missing evidence", async () => {
    const { resolveGates } = renderPanel();
    await screen.findByRole("option", { name: "Ready" });

    resolveGates({ l1: [], l2: [{ typeId: "et_test_run", name: "Test run", need: 1, have: 0 }] });
    await waitFor(() => expect(option("Ready (needs Test run)").disabled).toBe(true));
  });
});

describe("TicketPanel notice", () => {
  it("says what did not save when the ticket arrives from a half-finished create", async () => {
    renderPanel("/t/t1?notice=partial");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Ticket created; some details did not save");
  });

  it("shows nothing when there is no notice", async () => {
    renderPanel();
    await screen.findByRole("option", { name: "Ready" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
