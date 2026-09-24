// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T10:00:00.000Z",
};

const lanes = [lane({}), lane({ id: "l2", name: "Ready", position: 1 })];

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

  it("does not show the chip once the required field has a value", async () => {
    renderPanel({ fields: [fieldDef()], ticket: { ...ticket, fields: { severity: "high" } } });
    await screen.findByRole("button", { name: "Lane" });
    // Give the fields query a turn to land before asserting its absence.
    await screen.findByRole("textbox", { name: "Severity" });
    expect(screen.queryByText("Needs fields")).toBeNull();
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
