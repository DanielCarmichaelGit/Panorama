// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lane, Ticket } from "@panorama/core";
import { api } from "../lib/api";
import { BoardCard } from "./BoardCard";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

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

const ticket: Ticket = {
  id: "t1", projectId: "p1", boardId: "b1", number: 1, key: "PAN-1", title: "Fix bug", laneId: "l1", position: 1,
  epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false,
  createdAt: "", updatedAt: "",
};

function renderCard(overrides: Partial<Ticket> = {}, epics: any[] = [], tags: any[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BoardCard ticket={{ ...ticket, ...overrides }} lanes={lanes} agents={[]} types={[]} epics={epics} tags={tags} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BoardCard keyboard move", () => {
  it("opens the Move to Picker immediately on 'm', shows the gate refusal inline, and keeps focus on the card's move control when the move is rejected", async () => {
    const { ApiError } = await import("../lib/api");
    vi.mocked(api).mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.endsWith("/gates")) return {};
      if (method === "POST" && path.endsWith("/move")) {
        throw new ApiError(422, "gate", "Cannot move", {
          laneId: "l1",
          missing: [{ typeId: "et_eval_score", name: "Eval score", need: 1, have: 0 }],
        });
      }
      throw new Error(`unexpected ${method} ${path}`);
    });

    renderCard();
    const link = screen.getByRole("link", { name: /PAN-1/ });
    fireEvent.keyDown(link, { key: "m" });

    // autoOpen: the popover is already showing, no click or arrow key needed.
    const trigger = await screen.findByRole("button", { name: "Move to" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    // The gates fetch resolves with no known requirements, so the option opens up client-side
    // even though the server (mocked below) still refuses the move: a genuine client/server race.
    await waitFor(() => expect(screen.getByRole("option", { name: "Ready for Production" }).getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(screen.getByRole("option", { name: "Ready for Production" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Eval score needed first");

    // The move control stays mounted (not silently closed) and focus never left it.
    expect(screen.getByRole("button", { name: "Move to" })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes the Move to Picker and returns focus to the card", async () => {
    vi.mocked(api).mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.endsWith("/gates")) return {};
      throw new Error(`unexpected ${method} ${path}`);
    });

    renderCard();
    const link = screen.getByRole("link", { name: /PAN-1/ });
    fireEvent.keyDown(link, { key: "m" });

    const trigger = await screen.findByRole("button", { name: "Move to" });
    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Move to" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(link));
  });
});

describe("BoardCard chips", () => {
  it("shows the epic chip on the card", () => {
    vi.mocked(api).mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.endsWith("/gates")) return {};
      throw new Error(`unexpected ${method} ${path}`);
    });
    const epics = [{ id: "e1", projectId: "p1", name: "Growth", description: null, family: "sky", position: 0, archived: false, createdAt: "" }];

    renderCard({ epicId: "e1" }, epics);

    expect(screen.getByText("Growth")).toBeTruthy();
  });
});
