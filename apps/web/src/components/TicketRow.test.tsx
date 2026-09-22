// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { laneFamily, TicketRow } from "./TicketRow";

afterEach(cleanup);

const lanes = [{ id: "l1", projectId: "p", name: "In Progress", position: 2, family: "sky", setsNeedsHuman: false, isDone: false }] as any;
const base = { id: "t1", projectId: "p", number: 7, key: "PAN-7", title: "A very long title that must truncate rather than wrap the row", laneId: "l1", position: 1, flags: [], assigneeId: "a1", startDate: null, dueDate: null, metadata: { tokens: 184220 }, archived: false, createdAt: "", updatedAt: "" } as any;
const agents = [{ id: "a1", name: "claude-worker-2" }] as any;

const renderRow = (ticket: any = base) =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TicketRow ticket={ticket} lanes={lanes} agents={agents} />
    </MemoryRouter>
  );

describe("TicketRow", () => {
  it("shows key, title, agent, tokens, and the lane as state", () => {
    renderRow();
    expect(screen.getByText("PAN-7")).toBeTruthy();
    expect(screen.getByText("claude-worker-2")).toBeTruthy();
    expect(screen.getByText("184,220 tok")).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
  });
  it("shows Needs human in coral when flagged", () => {
    expect(laneFamily({ ...base, flags: ["needs_human"] }, lanes)).toBe("coral");
    renderRow({ ...base, flags: ["needs_human"] });
    expect(screen.getByText("Needs human")).toBeTruthy();
  });
  it("is a real link to the ticket, so a middle click opens it in a tab", () => {
    renderRow();
    const row = screen.getByRole("link");
    expect(row.getAttribute("href")).toBe("/t/t1");
    expect(row.getAttribute("data-ticket")).toBe("t1");
  });
});
