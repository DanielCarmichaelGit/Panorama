// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Lane, Project, Rule, Ticket } from "@boomerang/core";
import { ApiError, api } from "../lib/api";
import { Automations } from "./Automations";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

// jsdom lays nothing out. React Flow measures nodes through ResizeObserver, offsetWidth and
// offsetHeight, reads the viewport transform through DOMMatrixReadOnly, and edge labels
// through getBBox; these stubs give it a 272 by 120 node so edges and labels render.
beforeAll(() => {
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      this.cb([{ target: el, contentRect: { width: 272, height: 120 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  class DOMMatrixReadOnlyStub {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }
  (globalThis as unknown as { DOMMatrixReadOnly: unknown }).DOMMatrixReadOnly = DOMMatrixReadOnlyStub;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 272 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 120 });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 24, height: 12 }) as DOMRect;
});

afterEach(cleanup);

const project: Project = { id: "p1", key: "PAN", name: "Boomerang", createdAt: "" };
const lane = (over: Partial<Lane>): Lane => ({ id: "l1", projectId: "p1", name: "Backlog", position: 1, family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [], ...over });
const lanes = [lane({}), lane({ id: "l2", name: "Eval", family: "lilac", position: 2 }), lane({ id: "l3", name: "Ready for Production", family: "mint", position: 3 })];
const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1", projectId: "p1", boardId: "b1", number: 1, key: "PAN-1", title: "Fix bug", laneId: "l1", position: 1, epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "", ...over,
});

const rule = (over: Partial<Rule>): Rule => ({
  id: "r1", projectId: "p1", name: "Promote on eval pass", enabled: true,
  event: { type: "ticket.moved", toLaneId: "l2" },
  conditions: [{ kind: "evidence", typeId: "et1", result: "pass", op: "exists" }],
  actions: [{ type: "move_to_lane", laneId: "l3" }],
  canvas: {
    nodes: [
      { id: "event", kind: "event", position: { x: 0, y: 0 }, data: { type: "ticket.moved", toLaneId: "l2" } },
      { id: "c1", kind: "condition", position: { x: 288, y: 0 }, data: { kind: "evidence", typeId: "et1", result: "pass", op: "exists" } },
      { id: "a1", kind: "action", position: { x: 576, y: 0 }, data: { type: "move_to_lane", laneId: "l3" } },
    ],
    edges: [
      { id: "event-c1", source: "event", target: "c1" },
      { id: "c1-a1", source: "c1", target: "a1" },
    ],
  },
  createdAt: "2026-09-25T10:00:00.000Z", updatedAt: "2026-09-25T10:00:00.000Z", ...over,
});

/** A rule whose action node was never wired up. */
const disconnected = rule({
  id: "r2",
  name: "Loose action",
  canvas: {
    nodes: [
      { id: "event", kind: "event", position: { x: 0, y: 0 }, data: { type: "ticket.created" } },
      { id: "a1", kind: "action", position: { x: 576, y: 0 }, data: { type: "move_to_lane", laneId: "l3" } },
    ],
    edges: [],
  },
});

type Call = { method: string; path: string; body?: unknown };

function mockApi(rules: Rule[], extra?: (c: Call) => unknown | undefined) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    const custom = extra?.(call);
    if (custom !== undefined) return custom;
    if (path.startsWith("/api/v1/rules?")) return rules;
    if (/^\/api\/v1\/rules\/[^/]+\/runs/.test(path)) return [];
    if (method === "PATCH" && path.startsWith("/api/v1/rules/")) return { ...rules[0], ...(body as object) };
    if (path.startsWith("/api/v1/tickets?")) return [ticket({}), ticket({ id: "t2", key: "PAN-2", title: "Ship it" })];
    if (path === "/api/v1/evidence-types") return [{ id: "et1", name: "Eval score", kind: "eval_score", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" }];
    return [];
  });
  return calls;
}

function renderView(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ project, lanes }} />}>
            <Route path="/automations" element={<Automations />} />
            <Route path="/automations/:ruleId" element={<Automations />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const nodeEl = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);

describe("Automations view", () => {
  it("lists the rules with their event and draws the selected one as cards", async () => {
    mockApi([rule({})]);
    renderView("/automations/r1");
    expect(await screen.findByRole("heading", { name: "Automations" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Rules" });
    expect(within(list).getByText("Promote on eval pass")).toBeTruthy();
    expect(within(list).getByText("A ticket moves")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(3));
    expect(nodeEl("event")?.querySelector(".rnode-kind")?.textContent).toBe("When");
    expect(nodeEl("c1")?.querySelector(".rnode-title")?.textContent).toBe("Evidence Eval score passed");
    expect(nodeEl("a1")?.querySelector(".rnode-title")?.textContent).toBe("Move to Ready for Production");
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge")).toHaveLength(2));
  });

  it("the enable switch PATCHes enabled", async () => {
    const calls = mockApi([rule({})]);
    renderView("/automations");
    const sw = await screen.findByRole("switch", { name: "Promote on eval pass enabled" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.path === "/api/v1/rules/r1")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ enabled: false });
  });

  it("a new rule starts with an event node, and c then a add a connected condition and action", async () => {
    mockApi([]);
    renderView("/automations");
    fireEvent.click(await screen.findByRole("button", { name: "New rule" }));
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(1));
    expect(screen.getByText("Press c to add a condition, a to add an action")).toBeTruthy();
    const event = nodeEl("event")!;
    await act(async () => {
      event.focus();
      fireEvent.keyDown(event, { key: "c" });
    });
    await waitFor(() => expect(document.querySelectorAll(".rnode-condition")).toHaveLength(1));
    const cond = document.querySelector<HTMLElement>(".react-flow__node:has(.rnode-condition)") ?? document.querySelectorAll<HTMLElement>(".react-flow__node")[1];
    await act(async () => {
      cond.focus();
      fireEvent.keyDown(cond, { key: "a" });
    });
    await waitFor(() => expect(document.querySelectorAll(".rnode-action")).toHaveLength(1));
    await waitFor(() => expect(document.querySelectorAll(".react-flow__edge")).toHaveLength(2));
    expect(screen.queryByText("Press c to add a condition, a to add an action")).toBeNull();
  });

  it("a save with a disconnected node highlights it and does not call the api", async () => {
    const calls = mockApi([disconnected]);
    renderView("/automations/r2");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(2));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), { target: { value: "Loose action, renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("The then node (Move to Ready for Production) is not connected to the event.");
    expect(nodeEl("a1")?.querySelector(".rnode")?.classList.contains("has-error")).toBe(true);
    expect(nodeEl("event")?.querySelector(".rnode")?.classList.contains("has-error")).toBe(false);
    expect(calls.filter((c) => c.method === "PATCH" || c.method === "POST")).toHaveLength(0);
  });

  it("maps the server's canvas_invalid answer onto the node it names", async () => {
    const calls = mockApi([rule({})], (c) => {
      if (c.method === "PATCH") throw new ApiError(400, "canvas_invalid", "The drawing cannot run.", { errors: [{ name: "missing_target:a1", code: "missing_target", nodeId: "a1" }] });
      return undefined;
    });
    renderView("/automations/r1");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(3));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), { target: { value: "Promote, renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    await waitFor(() => expect(nodeEl("a1")?.querySelector(".rnode")?.classList.contains("has-error")).toBe(true));
    expect(screen.getByRole("alert").textContent).toContain("The then node has no lane chosen.");
  });

  it("test mode lights the matched nodes and reports the actions without writing", async () => {
    const calls = mockApi([rule({})], (c) => {
      if (c.method === "POST" && c.path === "/api/v1/rules/r1/test") return { matched: true, nodeIds: ["event", "c1", "a1"], actions: [{ type: "move_to_lane", laneId: "l3" }], refusals: ["Ready for Production needs Human sign-off"] };
      return undefined;
    });
    renderView("/automations/r1");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Test on ticket" }));
    fireEvent.click(await screen.findByRole("option", { name: /Ship it/ }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/rules/r1/test")).toBe(true));
    expect(calls.find((c) => c.path === "/api/v1/rules/r1/test")?.body).toEqual({ ticketId: "t2" });
    await waitFor(() => expect(nodeEl("a1")?.querySelector(".rnode")?.classList.contains("is-lit")).toBe(true));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Matched PAN-2. Nothing was written.");
    expect(status.textContent).toContain("Would move to Ready for Production");
    expect(status.textContent).toContain("Refused: Ready for Production needs Human sign-off");
    expect(calls.filter((c) => c.method === "PATCH" || (c.method === "POST" && !c.path.endsWith("/test")))).toHaveLength(0);
  });
});
