// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Lane, Project, Rule, Ticket } from "@boomerang/core";
import { ApiError, api } from "../lib/api";
import { Automations } from "./Automations";
import { Shell } from "./Shell";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});
// The Shell opens the live stream; not under test here.
vi.mock("../lib/stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/stream")>();
  return { ...actual, connectStream: vi.fn(() => new Promise<void>(() => {})) };
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
      if (c.method === "POST" && c.path === "/api/v1/rules/r1/test") {
        return {
          matched: true,
          nodeIds: ["event", "c1", "a1"],
          actions: [{ type: "move_to_lane", laneId: "l3" }],
          refusals: [
            {
              action: { type: "move_to_lane", laneId: "l3" },
              laneId: "l3",
              missing: [
                { typeId: "et1", name: "Eval score", need: 1, have: 0 },
                { typeId: "link", name: "Blocked by STU-2", need: 0, have: 0 },
              ],
            },
          ],
        };
      }
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
    expect(status.textContent).toContain("Move to Ready for Production would be refused: needs Eval score (0 of 1), Blocked by STU-2");
    expect(calls.filter((c) => c.method === "PATCH" || (c.method === "POST" && !c.path.endsWith("/test")))).toHaveLength(0);
  });

  it("selecting a node keeps the error rings and the bar; changing the drawing clears them", async () => {
    mockApi([disconnected]);
    renderView("/automations/r2");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(2));
    fireEvent.change(screen.getByRole("textbox", { name: "Rule name" }), { target: { value: "Loose action, renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(nodeEl("a1")?.querySelector(".rnode")?.classList.contains("has-error")).toBe(true);
    // A click on the node selects it, and a nudge moves it; neither changes what the drawing means, so the ring stays.
    await act(async () => {
      fireEvent.click(nodeEl("a1")!);
    });
    await waitFor(() => expect(nodeEl("a1")?.classList.contains("selected")).toBe(true));
    await act(async () => {
      fireEvent.keyDown(nodeEl("a1")!, { key: "ArrowRight" });
    });
    expect(nodeEl("a1")?.querySelector(".rnode")?.classList.contains("has-error")).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
    // Changing what the node means clears it.
    fireEvent.click(within(nodeEl("a1")!).getByRole("button", { name: "Action" }));
    fireEvent.click(await screen.findByRole("option", { name: "Set a flag" }));
    await waitFor(() => expect(nodeEl("a1")?.querySelector(".rnode")?.classList.contains("has-error")).toBe(false));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/** A rule that starts on a schedule, drawn as the builder reads it. */
const scheduled = rule({
  id: "r3",
  name: "Morning sweep",
  event: { type: "schedule", cron: "0 9 * * 1-5", timezone: "Europe/London", missed: "run_once" },
  conditions: [],
  actions: [{ type: "emit_webhook", destinationId: "d1" }],
  canvas: {
    nodes: [
      { id: "schedule", kind: "schedule", position: { x: 0, y: 0 }, data: { cron: "0 9 * * 1-5", timezone: "Europe/London", missed: "run_once" } },
      { id: "a1", kind: "action", position: { x: 288, y: 0 }, data: { type: "emit_webhook", destinationId: "d1" } },
    ],
    edges: [{ id: "schedule-a1", source: "schedule", target: "a1" }],
  },
});

const destinations = [
  { id: "d1", projectId: "p1", name: "Slack relay", url: "https://hooks.example.com/a", archived: false, createdAt: "" },
  { id: "d2", projectId: "p1", name: "Old relay", url: "https://old.example.com/b", archived: true, createdAt: "" },
];

describe("Schedule node", () => {
  it("reads the cron as a preset with its fields, titles the node in words, and rewrites the cron when the preset changes", async () => {
    mockApi([scheduled]);
    renderView("/automations/r3");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(2));
    const node = nodeEl("schedule")!;
    expect(node.querySelector(".rnode-kind")?.textContent).toBe("Every");
    expect(node.querySelector(".rnode-title")?.textContent).toBe("Every weekday at 09:00, Europe/London");
    expect(within(node).getByRole("button", { name: "Repeats" }).textContent).toBe("Every weekday");
    expect(within(node).getByRole("button", { name: "Hour" }).textContent).toBe("09:00");
    expect((within(node).getByLabelText("Minute") as HTMLInputElement).value).toBe("0");
    expect(within(node).getByRole("button", { name: "Missed runs" }).textContent).toBe("Run once");
    expect(within(node).queryByLabelText("Cron, five fields")).toBeNull();

    fireEvent.click(within(node).getByRole("button", { name: "Repeats" }));
    fireEvent.click(await screen.findByRole("option", { name: "Every week" }));
    await waitFor(() => expect(nodeEl("schedule")?.querySelector(".rnode-title")?.textContent).toBe("Every Monday at 09:00, Europe/London"));
    fireEvent.click(within(nodeEl("schedule")!).getByRole("button", { name: "Weekday" }));
    fireEvent.click(await screen.findByRole("option", { name: "Friday" }));
    await waitFor(() => expect(nodeEl("schedule")?.querySelector(".rnode-title")?.textContent).toBe("Every Friday at 09:00, Europe/London"));

    fireEvent.click(within(nodeEl("schedule")!).getByRole("button", { name: "Missed runs" }));
    fireEvent.click(await screen.findByRole("option", { name: "Skip" }));
    await waitFor(() => expect(within(nodeEl("schedule")!).getByRole("button", { name: "Missed runs" }).textContent).toBe("Skip"));
  });

  it("custom shows the cron in mono with a live description, and says when it is not a schedule", async () => {
    mockApi([scheduled]);
    renderView("/automations/r3");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(2));
    fireEvent.click(within(nodeEl("schedule")!).getByRole("button", { name: "Repeats" }));
    fireEvent.click(await screen.findByRole("option", { name: "Custom" }));
    const cron = within(nodeEl("schedule")!).getByLabelText("Cron, five fields") as HTMLInputElement;
    expect(cron.classList.contains("mono-input")).toBe(true);
    expect(cron.value).toBe("0 9 * * 1-5");
    expect(within(nodeEl("schedule")!).getByText("Every weekday at 09:00")).toBeTruthy();

    fireEvent.change(cron, { target: { value: "*/15 * * * *" } });
    fireEvent.blur(cron);
    await waitFor(() => expect(nodeEl("schedule")?.querySelector(".rnode-title")?.textContent).toBe("Every 15 minutes, Europe/London"));
    expect(within(nodeEl("schedule")!).getByText("Every 15 minutes")).toBeTruthy();

    fireEvent.change(cron, { target: { value: "0 9 * *" } });
    fireEvent.blur(cron);
    await waitFor(() => expect(nodeEl("schedule")?.querySelector(".rnode-title")?.textContent).toBe("Not a valid schedule, Europe/London"));
    expect(within(nodeEl("schedule")!).getByText("Not a valid schedule").classList.contains("rnode-invalid")).toBe(true);
  });
});

describe("notify node", () => {
  it("offers only live destinations and links to the Destinations tab", async () => {
    mockApi([scheduled], (c) => (c.path.startsWith("/api/v1/destinations?") ? destinations : undefined));
    renderView("/automations/r3");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(2));
    const node = nodeEl("a1")!;
    expect(node.querySelector(".rnode-title")?.textContent).toBe("Send to Slack relay");
    const link = within(node).getByRole("link", { name: "Manage destinations" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings?tab=destinations");
    fireEvent.click(within(node).getByRole("button", { name: "Destination" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options.some((t) => t?.includes("Slack relay"))).toBe(true);
    expect(options.some((t) => t?.includes("Old relay"))).toBe(false);
  });
});

describe("keyboard inside nodes", () => {
  async function drawn() {
    mockApi([rule({})]);
    renderView("/automations/r1");
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(3));
    const event = nodeEl("event")!;
    await act(async () => {
      event.focus();
    });
    return event;
  }

  it("Tab from a focused node reaches its first Picker, then the second, and Escape returns to the node", async () => {
    const event = await drawn();
    fireEvent.keyDown(event, { key: "Tab" });
    const first = within(event).getByRole("button", { name: "Event" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab" });
    const second = within(event).getByRole("button", { name: "From lane" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(document.activeElement).toBe(event);
  });

  it("Enter on a Picker does not reopen the first, and Delete on a Picker trigger does not delete the node", async () => {
    const event = await drawn();
    const second = within(event).getByRole("button", { name: "From lane" });
    await act(async () => {
      second.focus();
    });
    // Enter belongs to the Picker it lands on: that one opens, the first stays shut.
    fireEvent.keyDown(second, { key: "Enter" });
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(within(event).getByRole("button", { name: "Event" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(second.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      second.focus();
    });
    fireEvent.keyDown(second, { key: "Delete" });
    fireEvent.keyDown(second, { key: "Backspace" });
    expect(document.querySelectorAll(".rnode")).toHaveLength(3);
    // Letters inside a control type, they do not draw.
    fireEvent.keyDown(second, { key: "c" });
    expect(document.querySelectorAll(".rnode")).toHaveLength(3);
  });

  it("after c the new node takes focus, and e selects the existing event node instead of adding one", async () => {
    const event = await drawn();
    fireEvent.keyDown(event, { key: "c" });
    await waitFor(() => expect(document.querySelectorAll(".rnode-condition")).toHaveLength(2));
    const added = Array.from(document.querySelectorAll<HTMLElement>(".react-flow__node")).find((n) => n.dataset.id !== "event" && n.dataset.id !== "c1" && n.dataset.id !== "a1")!;
    await waitFor(() => expect(document.activeElement).toBe(added));
    fireEvent.keyDown(added, { key: "e" });
    expect(document.querySelectorAll(".rnode-event")).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(nodeEl("event")));
  });

  it("Delete on a focused, unselected node removes it, focus moves to the node before it, and Ctrl+Z from there brings it back", async () => {
    await drawn();
    const a1 = nodeEl("a1")!;
    await act(async () => {
      a1.focus();
    });
    expect(a1.classList.contains("selected")).toBe(false);
    fireEvent.keyDown(a1, { key: "Delete" });
    await waitFor(() => expect(nodeEl("a1")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(nodeEl("c1")));
    fireEvent.keyDown(document.activeElement!, { key: "z", ctrlKey: true });
    await waitFor(() => expect(nodeEl("a1")).toBeTruthy());
  });

  it("deleting the first node focuses the next one; deleting the only node focuses the canvas", async () => {
    const event = await drawn();
    fireEvent.keyDown(event, { key: "Delete" });
    await waitFor(() => expect(nodeEl("event")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(nodeEl("c1")));
    fireEvent.keyDown(nodeEl("c1")!, { key: "Delete" });
    await waitFor(() => expect(nodeEl("c1")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(nodeEl("a1")));
    fireEvent.keyDown(nodeEl("a1")!, { key: "Delete" });
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(0));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("application", { name: "Rule canvas" })));
  });

  it("Escape out of a node's Picker closes the popover and keeps the node selected", async () => {
    const event = await drawn();
    await act(async () => {
      fireEvent.click(event);
    });
    await waitFor(() => expect(event.classList.contains("selected")).toBe(true));
    const trigger = within(event).getByRole("button", { name: "Event" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(nodeEl("event")!.classList.contains("selected")).toBe(true);
  });
});

describe("enable switch while busy", () => {
  it("ignores a second click while the PATCH is in flight and keeps focus on the switch", async () => {
    let release!: () => void;
    const calls = mockApi([rule({})], (c) => (c.method === "PATCH" ? new Promise((r) => { release = () => r({ ...rule({}), enabled: false }); }) : undefined));
    renderView("/automations");
    const sw = await screen.findByRole("switch", { name: "Promote on eval pass enabled" });
    await act(async () => {
      sw.focus();
      fireEvent.click(sw);
    });
    await waitFor(() => expect(sw.getAttribute("aria-disabled")).toBe("true"));
    expect(sw.hasAttribute("disabled")).toBe(false);
    fireEvent.click(sw);
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(document.activeElement).toBe(sw);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(sw.getAttribute("aria-disabled")).toBeNull());
    expect(document.activeElement).toBe(sw);
  });
});

/** The view under the Shell, so its shortcuts and sidebar links are the ones leaving the rule. */
function renderShell(path: string, rules: Rule[] = []) {
  const calls = mockApi(rules, (c) => (c.path === "/api/v1/projects" ? [project] : c.path === "/api/v1/projects/p1/lanes" ? lanes : undefined));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Shell status={{ state: "unlocked" }} chainOk={true} />}>
            <Route path="/" element={<div>Queue view</div>} />
            <Route path="/board" element={<div>Board view</div>} />
            <Route path="/agents" element={<div>Agents view</div>} />
            <Route path="/automations" element={<Automations />} />
            <Route path="/automations/:ruleId" element={<Automations />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return calls;
}

describe("leaving a dirty rule", () => {
  afterEach(() => vi.restoreAllMocks());

  async function dirtyDraft() {
    renderShell("/automations");
    fireEvent.click(await screen.findByRole("button", { name: "New rule" }));
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(1));
  }

  it("g b asks first and stays when cancelled; confirmed, it goes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await dirtyDraft();
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "b" });
    expect(confirm).toHaveBeenCalledWith("You have unsaved changes. Leave this rule?");
    expect(screen.queryByText("Board view")).toBeNull();
    expect(screen.getByRole("region", { name: "New rule" })).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "b" });
    expect(await screen.findByText("Board view")).toBeTruthy();
  });

  it("a sidebar link asks too and stays when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await dirtyDraft();
    fireEvent.click(screen.getByRole("link", { name: "Board" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Board view")).toBeNull();
    expect(screen.getByRole("region", { name: "New rule" })).toBeTruthy();
  });

  it("g then a inside the canvas adds an action node and does not leave for Agents", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await dirtyDraft();
    const event = nodeEl("event")!;
    await act(async () => {
      event.focus();
      fireEvent.keyDown(event, { key: "g" });
      fireEvent.keyDown(event, { key: "a" });
    });
    await waitFor(() => expect(document.querySelectorAll(".rnode-action")).toHaveLength(1));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Agents view")).toBeNull();
  });

  it("a clean rule leaves without asking", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderShell("/automations/r1", [rule({})]);
    await waitFor(() => expect(document.querySelectorAll(".rnode")).toHaveLength(3));
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "b" });
    expect(await screen.findByText("Board view")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });
});
