// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lane, Project, Ticket } from "@boomerang/core";
import { api } from "../lib/api";
import { Queue } from "./Queue";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

let outletContext: { project: Project; lanes: Lane[] };
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useOutletContext: () => outletContext };
});

afterEach(cleanup);

const project: Project = { id: "p1", key: "PAN", name: "Boomerang", createdAt: "" };
const lanes: Lane[] = [
  { id: "l1", projectId: "p1", name: "Backlog", position: 1, family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
];

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1", projectId: "p1", boardId: "b1", number: 1, key: "PAN-1", title: "Fix bug", laneId: "l1", position: 1,
  epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: ["needs_human"], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false,
  createdAt: "", updatedAt: "", ...over,
});

const tokens = (total: number) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, total });
const total = (over: Record<string, unknown> = {}) => ({ seconds: 7500, openTimers: 0, tokens: tokens(12_345), usd: 9.4, known: 9.4, unpriced: 0, entries: 3, ...over });

function renderQueue(opts: { needsHuman?: Ticket[]; total?: Record<string, unknown>; entry?: string } = {}) {
  const { needsHuman = [], total: figures = total(), entry = "/" } = opts;
  outletContext = { project, lanes };
  const metricsCalls: string[] = [];
  vi.mocked(api).mockImplementation(async (method: string, path: string) => {
    if (path === "/api/v1/queue?projectId=p1") return { needsHuman, active: [] };
    if (path === "/api/v1/tickets?projectId=p1") return needsHuman;
    if (path === "/api/v1/projects/p1/boards") return [];
    if (path === "/api/v1/agents") return [];
    if (path === "/api/v1/epics?projectId=p1") return [];
    if (path === "/api/v1/tags?projectId=p1") return [];
    if (path.startsWith("/api/v1/metrics?")) {
      metricsCalls.push(path);
      const period = new URLSearchParams(path.split("?")[1]).get("period");
      return { projectId: "p1", estimate: true, priceDate: "2026-09-24", period: { kind: period, from: null, to: null }, groupBy: "project", total: figures, groups: [] };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Queue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { metricsCalls };
}

describe("Queue figures", () => {
  it("shows this week's time, tokens and estimated cost under the title, with the price date on hover", async () => {
    renderQueue({ needsHuman: [ticket({})] });
    await screen.findByRole("heading", { name: /need you/ });
    const cost = await screen.findByText("~$9.40");
    expect(cost.getAttribute("title")).toBe("Estimate from models.dev prices dated 2026-09-24; this could be lower");
    expect(screen.getByText("2h 5m")).toBeTruthy();
    expect(screen.getByText("12.3k")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Period" }).textContent).toContain("This week");
  });

  it("shows the figures on the empty state too", async () => {
    renderQueue();
    await screen.findByRole("heading", { name: "No agents connected yet" });
    expect(await screen.findByText("~$9.40")).toBeTruthy();
  });

  it("says at least when an unpriced model is among the entries", async () => {
    renderQueue({ total: total({ usd: null, known: 3.2, unpriced: 1 }) });
    expect(await screen.findByText("at least ~$3.20")).toBeTruthy();
  });

  it("reads the period from the URL and asks the server for it", async () => {
    const { metricsCalls } = renderQueue({ entry: "/?period=month" });
    await screen.findByText("~$9.40");
    expect(metricsCalls).toEqual(["/api/v1/metrics?projectId=p1&period=month&groupBy=project"]);
    expect(screen.getByRole("button", { name: "Period" }).textContent).toContain("This month");
  });

  it("picking All time refetches the rollup for every period", async () => {
    const { metricsCalls } = renderQueue();
    await screen.findByText("~$9.40");
    fireEvent.click(screen.getByRole("button", { name: "Period" }));
    fireEvent.click(await screen.findByRole("option", { name: "All time" }));
    await waitFor(() => expect(metricsCalls).toContain("/api/v1/metrics?projectId=p1&period=all&groupBy=project"));
    expect(screen.getByRole("button", { name: "Period" }).textContent).toContain("All time");
  });
});
