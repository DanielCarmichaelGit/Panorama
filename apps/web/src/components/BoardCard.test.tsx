// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false,
  createdAt: "", updatedAt: "",
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BoardCard ticket={ticket} lanes={lanes} agents={[]} types={[]} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BoardCard keyboard move", () => {
  it("shows the gate refusal inline and keeps focus on the card when a keyboard move is rejected", async () => {
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

    const select = await screen.findByLabelText("Move to");
    fireEvent.change(select, { target: { value: "l2" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Eval score needed first");

    // The select stays open (not silently closed) and focus never left the card.
    expect(screen.getByLabelText("Move to")).toBeTruthy();
    expect(document.activeElement?.tagName).toBe("SELECT");
  });
});
