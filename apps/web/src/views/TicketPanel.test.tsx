// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lane, Ticket } from "@boomerang/core";
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
  epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T10:00:00.000Z",
};

const lanes = [lane({}), lane({ id: "l2", name: "Ready", position: 1 })];

const tokens = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, total });
const emptyMetrics = () => ({
  ticketId: "t1", estimate: true, priceDate: "2026-09-24", seconds: 0, openTimers: 0, tokens: tokens(0), usd: 0, known: 0, unpriced: 0, entries: 0,
  byModel: [], byActor: [], running: [],
});

/** Renders the panel with the gates query held open until `resolveGates` is called. */
function renderPanel(
  opts: {
    entry?: string;
    onClose?: () => void;
    ticket?: Ticket;
    epics?: unknown[];
    tags?: unknown[];
    fields?: unknown[];
    tickets?: unknown[];
    links?: { links: unknown[]; tickets: unknown[] };
    metrics?: Record<string, unknown>;
  } = {},
) {
  const {
    entry = "/t/t1",
    onClose = () => {},
    ticket: currentTicket = ticket,
    epics = [],
    tags = [],
    fields = [],
    tickets = [],
    links = { links: [], tickets: [] },
    metrics = emptyMetrics(),
  } = opts;
  let resolveGates!: (v: Record<string, unknown>) => void;
  const gates = new Promise<Record<string, unknown>>((resolve) => { resolveGates = resolve; });
  vi.mocked(api).mockImplementation((async (method: string, path: string, body?: unknown) => {
    if (method === "GET" && path === "/api/v1/tickets/t1") return currentTicket;
    if (method === "GET" && path === "/api/v1/projects/p1/lanes") return lanes;
    if (method === "GET" && path === "/api/v1/agents") return [];
    if (method === "GET" && path === "/api/v1/evidence-types") return [];
    if (method === "GET" && path === "/api/v1/tickets/t1/thread") return { comments: [], attachments: [], evidence: [], actors: [] };
    if (method === "GET" && path === "/api/v1/tickets/t1/gates") return gates;
    if (method === "GET" && path === "/api/v1/epics?projectId=p1") return epics;
    if (method === "GET" && path === "/api/v1/tags?projectId=p1") return tags;
    if (method === "GET" && path === "/api/v1/fields?projectId=p1") return fields;
    if (method === "GET" && path === "/api/v1/tickets?projectId=p1") return tickets;
    if (method === "GET" && path === "/api/v1/tickets/t1/links") return links;
    if (method === "GET" && path === "/api/v1/tickets/t1/metrics") return metrics;
    if (method === "PATCH" && path === "/api/v1/tickets/t1") return { ...currentTicket, ...(body as object) };
    if (method === "POST" && /^\/api\/v1\/tickets\/.+\/links$/.test(path)) {
      return { id: "link1", projectId: "p1", fromId: path.split("/")[4], toId: (body as any)?.toId, kind: (body as any)?.kind, createdAt: "" };
    }
    if (method === "DELETE" && /^\/api\/v1\/tickets\/.+\/links\/.+$/.test(path)) return { ok: true };
    throw new Error(`unexpected ${method} ${path}`);
  }) as any);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TicketPanel id="t1" onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { resolveGates };
}

function openLanePicker() {
  fireEvent.click(screen.getByRole("button", { name: "Lane" }));
}

const option = (name: string) => screen.getByRole("option", { name });
const disabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true";

describe("TicketPanel lane picker", () => {
  it("offers only the current lane until the gates are known, then opens the rest", async () => {
    const { resolveGates } = renderPanel();
    await screen.findByRole("button", { name: "Lane" });
    openLanePicker();
    await screen.findByRole("option", { name: "Ready" });

    // The gates have not come back yet: nothing is known about what Ready needs, so it stays shut.
    expect(disabled(option("Ready"))).toBe(true);
    expect(disabled(option("Backlog"))).toBe(false);

    resolveGates({ l1: [], l2: [] });
    await waitFor(() => expect(disabled(option("Ready"))).toBe(false));
  });

  it("keeps a lane shut when the gates say it is missing evidence", async () => {
    const { resolveGates } = renderPanel();
    await screen.findByRole("button", { name: "Lane" });
    openLanePicker();
    await screen.findByRole("option", { name: "Ready" });

    resolveGates({ l1: [], l2: [{ typeId: "et_test_run", name: "Test run", need: 1, have: 0 }] });
    // Wait for the gates to actually land (not just the already-true "still pending" disabled
    // state) by watching the reason text settle onto the specific missing requirement.
    await waitFor(() => expect(option("Ready").getAttribute("title")).toBe("Ready (needs Test run)"));
    expect(disabled(option("Ready"))).toBe(true);
  });
});

describe("TicketPanel Escape", () => {
  it("closes only the Lane picker's popover, not the panel underneath it; a second Escape then closes the panel", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    const trigger = await screen.findByRole("button", { name: "Lane" });
    openLanePicker();
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("TicketPanel notice", () => {
  it("says what did not save when the ticket arrives from a half-finished create", async () => {
    renderPanel({ entry: "/t/t1?notice=partial" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Ticket created; some details did not save");
  });

  it("shows nothing when there is no notice", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Lane" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

const fieldDef = (over: Record<string, unknown> = {}) => ({
  id: "f1", projectId: "p1", name: "Severity", key: "severity", kind: "text", options: [], required: true, position: 0, archived: false, createdAt: "", ...over,
});

const otherTicket = (over: Partial<Ticket> = {}): Ticket => ({
  id: "t2", projectId: "p1", boardId: "b1", number: 2, key: "PAN-2", title: "Other ticket", laneId: "l1", position: 2,
  epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T10:00:00.000Z", ...over,
});

describe("TicketPanel Needs fields chip", () => {
  it("shows a coral Needs fields chip next to the title when a required field is empty", async () => {
    renderPanel({ fields: [fieldDef()] });
    await screen.findByRole("button", { name: "Lane" });
    expect(await screen.findByText("Needs fields")).toBeTruthy();
  });

  it("never counts a required checkbox as missing, since an unticked box reads as false", async () => {
    renderPanel({ fields: [fieldDef({ id: "f2", name: "Approved", key: "approved", kind: "checkbox" })] });
    await screen.findByRole("button", { name: "Lane" });
    await screen.findByRole("checkbox", { name: "Approved" });
    expect(screen.queryByText("Needs fields")).toBeNull();
  });

  it("counts an empty required file field, even though create did not require it", async () => {
    renderPanel({ fields: [fieldDef({ id: "f3", name: "Spec", key: "spec", kind: "file" })] });
    await screen.findByRole("button", { name: "Lane" });
    await screen.findByRole("button", { name: "Choose file" });
    expect(await screen.findByText("Needs fields")).toBeTruthy();
  });

  it("does not show the chip once the required field has a value", async () => {
    renderPanel({ fields: [fieldDef()], ticket: { ...ticket, fields: { severity: "high" } } });
    await screen.findByRole("button", { name: "Lane" });
    // Give the fields query a turn to land before asserting its absence.
    await screen.findByRole("textbox", { name: "Severity" });
    expect(screen.queryByText("Needs fields")).toBeNull();
  });

  it("issues no PATCH when a text field is blurred without being changed", async () => {
    renderPanel({ fields: [fieldDef()] });
    const input = await screen.findByRole("textbox", { name: "Severity" });

    fireEvent.blur(input);
    // Let react-query's mutate() dispatch machinery run its course (it calls the mutationFn a
    // tick or two after mutate() itself returns) before asserting nothing was called.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fieldPatches = vi
      .mocked(api)
      .mock.calls.filter(([method, , body]) => method === "PATCH" && !!body && typeof body === "object" && "fields" in (body as object));
    expect(fieldPatches).toHaveLength(0);
  });
});

describe("TicketPanel success criteria", () => {
  it("shows the empty state with an Edit button when there is no success criteria yet", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Lane" });
    expect(screen.getByText("No success criteria yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("ticking a criteria checkbox PATCHes the ticket with the rewritten markdown", async () => {
    renderPanel({ ticket: { ...ticket, successCriteria: "- [ ] Ship it\n" } });
    const checkbox = await screen.findByRole("checkbox");
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("PATCH", "/api/v1/tickets/t1", { successCriteria: "- [x] Ship it\n" }),
    );
  });

  it("two ticks fired before the first PATCH resolves both land: the second PATCH carries both changes", async () => {
    renderPanel({ ticket: { ...ticket, successCriteria: "- [ ] One\n- [ ] Two\n" } });
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2);

    // Neither fireEvent.click awaits anything, so the second fires before the first tick's PATCH
    // (an async mock call) has a chance to resolve: the listener must read the *other* tick's
    // already-toggled markdown, not the stale snapshot from when the listeners were attached.
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);

    // A successful PATCH invalidates and refetches the ticket, so the *last* call overall may be
    // that GET, not the second PATCH; look at the last PATCH specifically.
    await waitFor(() => {
      const patchCalls = vi.mocked(api).mock.calls.filter(([method, path]) => method === "PATCH" && path === "/api/v1/tickets/t1");
      expect(patchCalls.length).toBeGreaterThanOrEqual(2);
      expect(patchCalls[patchCalls.length - 1][2]).toEqual({ successCriteria: "- [x] One\n- [x] Two\n" });
    });
  });

  it("sends the second tick's PATCH only after the first one resolves", async () => {
    renderPanel({ ticket: { ...ticket, successCriteria: "- [ ] One\n- [ ] Two\n" } });
    const boxes = await screen.findAllByRole("checkbox");
    const base = vi.mocked(api).getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const patches: unknown[] = [];
    vi.mocked(api).mockImplementation((async (method: string, path: string, body?: unknown) => {
      if (method === "PATCH" && path === "/api/v1/tickets/t1") {
        patches.push(body);
        if (patches.length === 1) await gate;
      }
      return base(method, path, body);
    }) as any);

    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    await waitFor(() => expect(patches).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(patches).toHaveLength(1);

    release();
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ successCriteria: "- [x] One\n- [x] Two\n" });
  });

  it("ignores a checkbox that the renderer did not stamp, and reads each index from its attribute", async () => {
    renderPanel({ ticket: { ...ticket, successCriteria: "- [ ] One <input type=\"checkbox\">\n- [ ] Two\n" } });
    const boxes = await screen.findAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[1]);
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("PATCH", "/api/v1/tickets/t1", { successCriteria: "- [ ] One <input type=\"checkbox\">\n- [x] Two\n" }),
    );
  });
});

describe("TicketPanel cost block", () => {
  const model = (over: Record<string, unknown>) => ({ model: "anthropic/claude-fable-5-1", tokens: tokens(12_345), usd: 9.4, known: 9.4, unpriced: 0, entries: 3, ...over });
  const actor = (over: Record<string, unknown>) => ({ actorId: "ag1", name: "worker", seconds: 7500, openTimers: 0, tokens: tokens(12_345), usd: 9.4, known: 9.4, unpriced: 0, entries: 3, ...over });

  it("says one muted line when nothing was recorded", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Lane" });
    expect(await screen.findByText("No time or cost recorded")).toBeTruthy();
    expect(screen.queryByText(/Timer running/)).toBeNull();
  });

  it("shows time, tokens and the estimate with its price date on hover, plus the model and actor breakdowns", async () => {
    renderPanel({ metrics: { ...emptyMetrics(), seconds: 7500, tokens: tokens(12_345), usd: 9.4, known: 9.4, entries: 3, byModel: [model({})], byActor: [actor({})] } });
    const heading = await screen.findByRole("heading", { name: "Cost" });
    const block = heading.parentElement!;
    const costs = await within(block).findAllByText("~$9.40");
    expect(costs.length).toBeGreaterThanOrEqual(1);
    for (const c of costs) expect(c.getAttribute("title")).toBe("Estimate from models.dev prices dated 2026-09-24; this could be lower");
    expect(within(block).getAllByText("2h 5m").length).toBeGreaterThanOrEqual(1);
    expect(within(block).getAllByText("12.3k").length).toBeGreaterThanOrEqual(1);
    expect(within(block).getByText("anthropic/claude-fable-5-1")).toBeTruthy();
    expect(within(block).getByText("worker")).toBeTruthy();
    expect(screen.queryByText("No time or cost recorded")).toBeNull();
  });

  it("marks an unpriced model as no price and gives the total as at least the priced part", async () => {
    renderPanel({
      metrics: {
        ...emptyMetrics(), tokens: tokens(2_000_000), usd: null, known: 1.5, unpriced: 1, entries: 2,
        byModel: [model({ usd: 1.5, known: 1.5, tokens: tokens(1_000_000), entries: 1 }), model({ model: "acme/mystery-model-9", usd: null, known: 0, unpriced: 1, tokens: tokens(1_000_000), entries: 1 })],
        byActor: [actor({ seconds: 0, tokens: tokens(2_000_000), usd: null, known: 1.5, unpriced: 1, entries: 2 })],
      },
    });
    // The summary and the actor row both say it; the model row for the priced model says its own figure.
    expect((await screen.findAllByText("at least ~$1.50")).length).toBeGreaterThanOrEqual(1);
    const heading = screen.getByRole("heading", { name: "Cost" });
    const block = heading.parentElement!;
    const row = within(block).getByText("acme/mystery-model-9").closest("li")!;
    expect(within(row).getByText("no price")).toBeTruthy();
  });

  it("says who has a timer running and since when", async () => {
    renderPanel({ metrics: { ...emptyMetrics(), seconds: 90, openTimers: 1, running: [{ actorId: "ag1", name: "worker", startedAt: "2026-09-24T10:00:00.000Z" }], byActor: [actor({ seconds: 90, openTimers: 1, tokens: tokens(0), usd: 0, known: 0, entries: 0 })] } });
    const line = (await screen.findAllByText("worker")).map((el) => el.closest(".running")).find(Boolean)!;
    expect(line.textContent).toContain("Timer running for worker since ");
    expect(line.textContent).toContain(new Date("2026-09-24T10:00:00.000Z").toLocaleString());
    expect(line.querySelectorAll(".mono").length).toBe(2);
  });
});

describe("TicketPanel dependencies", () => {
  it('adding a "Blocked by" link posts the link with kind "blocks" from the other ticket', async () => {
    renderPanel({ tickets: [otherTicket()] });
    await screen.findByRole("button", { name: "Lane" });

    fireEvent.click(screen.getByRole("button", { name: "Blocked by" }));
    fireEvent.click(await screen.findByRole("option", { name: "PAN-2 Other ticket" }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("POST", "/api/v1/tickets/t2/links", { toId: "t1", kind: "blocks" }),
    );
  });
});
