// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board as BoardType, Lane, Project, Ticket } from "@panorama/core";
import { api } from "../lib/api";
import { Board, groupByLane } from "./Board";

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

const project: Project = { id: "p1", key: "PAN", name: "Panorama", createdAt: "" };

const lane = (over: Partial<Lane>): Lane => ({
  id: "l1", projectId: "p1", name: "Backlog", position: 1, family: "stone",
  setsNeedsHuman: false, isDone: false, evidenceRequirements: [], ...over,
});

const lanes = [
  lane({ id: "l1", name: "Backlog", position: 1 }),
  lane({
    id: "l2", name: "Ready for Production", position: 2, family: "mint", setsNeedsHuman: true,
    evidenceRequirements: [{ typeId: "et_eval_score", count: 1 }],
  }),
];

const ticket = (over: Partial<Ticket>): Ticket => ({
  id: "t1", projectId: "p1", boardId: "b1", number: 1, key: "PAN-1", title: "Fix bug", laneId: "l1", position: 1,
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false,
  createdAt: "", updatedAt: "", ...over,
});

const board = (over: Partial<BoardType>): BoardType => ({
  id: "b1", projectId: "p1", name: "Panorama", description: null, family: "stone", position: 0, createdAt: "", ...over,
});

describe("groupByLane", () => {
  it("groups tickets under their lane in position order", () => {
    const t1 = ticket({ id: "t1", laneId: "l1", position: 2 });
    const t2 = ticket({ id: "t2", laneId: "l1", position: 1 });
    const t3 = ticket({ id: "t3", laneId: "l2", position: 1 });

    const groups = groupByLane([t1, t2, t3], lanes);

    expect(groups.l1.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(groups.l2.map((t) => t.id)).toEqual(["t3"]);
  });

  it("gives an empty array for a lane with no tickets", () => {
    expect(groupByLane([], lanes)).toEqual({ l1: [], l2: [] });
  });
});

function renderBoard(tickets: Ticket[], boards: BoardType[] = [board({})]) {
  outletContext = { project, lanes };
  vi.mocked(api).mockImplementation(async (method: string, path: string) => {
    if (path === `/api/v1/tickets?projectId=${project.id}`) return tickets;
    if (path === `/api/v1/projects/${project.id}/boards`) return boards;
    if (path === "/api/v1/agents") return [];
    if (path === "/api/v1/evidence-types") return [];
    if (path.endsWith("/gates")) return {};
    throw new Error(`unexpected ${method} ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Board />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Board", () => {
  it("renders a column per lane with its count and a card link into the board route", async () => {
    renderBoard([
      ticket({ id: "t1", laneId: "l1", key: "PAN-1" }),
      ticket({ id: "t2", laneId: "l2", key: "PAN-2", title: "Ship it" }),
    ]);

    const backlogHeading = await screen.findByRole("heading", { name: "Backlog" });
    const backlogLane = backlogHeading.closest("section")!;
    expect(await within(backlogLane).findByText("1")).toBeTruthy();

    const prodHeading = screen.getByRole("heading", { name: "Ready for Production" });
    const prodLane = prodHeading.closest("section")!;
    expect(await within(prodLane).findByText("1")).toBeTruthy();

    const link = screen.getByRole("link", { name: /PAN-1/ });
    expect(link.getAttribute("href")).toBe("/board/t/t1");
  });

  it("renders every lane with No tickets when the board is empty", async () => {
    renderBoard([]);

    const backlogHeading = await screen.findByRole("heading", { name: "Backlog" });
    expect(within(backlogHeading.closest("section")!).getByText("No tickets")).toBeTruthy();
    const prodHeading = screen.getByRole("heading", { name: "Ready for Production" });
    expect(within(prodHeading.closest("section")!).getByText("No tickets")).toBeTruthy();
  });

  it("renders the board select defaulting to the project's one board, with a New board option", async () => {
    renderBoard([]);
    await screen.findByRole("heading", { name: "Backlog" });

    const select = screen.getByLabelText("Board") as HTMLSelectElement;
    expect(select.value).toBe("b1");
    const options = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).textContent);
    expect(options).toEqual(["Panorama", "New board"]);
  });

  it("with two boards, filters cards and counts to the selected one", async () => {
    const boards = [board({ id: "b1", name: "Panorama", position: 0 }), board({ id: "b2", name: "Growth", position: 1 })];
    renderBoard(
      [
        ticket({ id: "t1", laneId: "l1", key: "PAN-1", boardId: "b1" }),
        ticket({ id: "t2", laneId: "l1", key: "PAN-2", title: "On growth", boardId: "b2" }),
      ],
      boards,
    );

    const backlogHeading = await screen.findByRole("heading", { name: "Backlog" });
    const backlogLane = backlogHeading.closest("section")!;
    expect(await within(backlogLane).findByText("1")).toBeTruthy();
    expect(screen.getByRole("link", { name: /PAN-1/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /PAN-2/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Board"), { target: { value: "b2" } });

    await screen.findByRole("link", { name: /PAN-2/ });
    expect(screen.queryByRole("link", { name: /PAN-1/ })).toBeNull();
    expect(within(backlogHeading.closest("section")!).getByText("1")).toBeTruthy();
  });
});
