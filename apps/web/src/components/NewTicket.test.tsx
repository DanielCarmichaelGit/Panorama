// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor, Board, Lane } from "@panorama/core";
import { api } from "../lib/api";
import { uploadFile } from "../lib/attachments";
import { NewTicket } from "./NewTicket";

// TipTap's ProseMirror view measures text layout on mount, which jsdom does not implement.
(Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null });
(Range.prototype as any).getBoundingClientRect = () => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {},
});

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

vi.mock("../lib/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/attachments")>();
  return { ...actual, uploadFile: vi.fn() };
});

afterEach(cleanup);

const board = (over: Partial<Board>): Board => ({
  id: "b1", projectId: "p1", name: "Panorama", description: null, family: "stone", position: 0, createdAt: "", ...over,
});

const lane = (over: Partial<Lane>): Lane => ({
  id: "l1", projectId: "p1", name: "Backlog", position: 0, family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [], ...over,
});

const agent = (over: Partial<Actor>): Actor => ({
  id: "a1", kind: "agent", name: "worker", publicKey: "", scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: "", ...over,
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function editor(): any {
  return (window as any).__panEditor;
}

function renderDialog(opts: {
  boards?: Board[];
  lanes?: Lane[];
  agents?: Actor[];
  returnTo?: "queue" | "board";
  onClose?: (t?: any) => void;
  apiImpl?: (method: string, path: string, body?: unknown) => Promise<unknown>;
} = {}) {
  const boards = opts.boards ?? [board({})];
  const lanes = opts.lanes ?? [lane({})];
  const agents = opts.agents ?? [agent({})];
  const onClose = opts.onClose ?? vi.fn();

  vi.mocked(api).mockImplementation(
    opts.apiImpl ??
      (async (method: string, path: string, body?: unknown) => {
        if (method === "GET" && path === "/api/v1/projects/p1/boards") return boards;
        if (method === "GET" && path === "/api/v1/projects/p1/lanes") return lanes;
        if (method === "GET" && path === "/api/v1/agents") return agents;
        if (method === "POST" && path === "/api/v1/tickets") {
          return { id: "t1", projectId: "p1", boardId: (body as any).boardId ?? boards[0].id, key: "PAN-1", title: (body as any).title, laneId: (body as any).laneId ?? lanes[0].id, number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
        }
        if (method === "PATCH" && path === "/api/v1/tickets/t1") return { id: "t1" };
        if (method === "POST" && path === "/api/v1/tickets/t1/flags") return { id: "t1" };
        if (method === "POST" && path === "/api/v1/comments") return { id: "c1", ticketId: "t1", actorId: "human", body: (body as any).body, attachmentIds: [], createdAt: "" };
        throw new Error(`unexpected ${method} ${path}`);
      }),
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NewTicket projectId="p1" boardId={boards[0].id} returnTo={opts.returnTo ?? "queue"} onClose={onClose} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe("NewTicket", () => {
  it("renders through a portal onto document.body", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "New ticket" });
    expect(dialog.closest("body")).toBe(document.body);
  });

  it("hides the board select with only one board, shows it with two", async () => {
    renderDialog({ boards: [board({})] });
    await screen.findByText("Backlog"); // waits for the lane select's options, i.e. data loaded
    expect(screen.queryByLabelText("Board")).toBeNull();
    cleanup();

    renderDialog({ boards: [board({ id: "b1", name: "Panorama" }), board({ id: "b2", name: "Growth", position: 1 })] });
    await screen.findByLabelText("Board");
    expect(screen.getByLabelText("Board")).toBeTruthy();
  });

  it("disables Create while the title is empty", async () => {
    renderDialog();
    await screen.findByRole("dialog", { name: "New ticket" });
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("creates the ticket, then uploads each attachment, then posts the description, in order, and navigates to /t/:id", async () => {
    let order: string[] = [];
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [];
      if (method === "POST" && path === "/api/v1/tickets") {
        order.push("create");
        return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: (body as any).title, laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      }
      if (method === "POST" && path === "/api/v1/comments") {
        order.push("comment");
        return { id: "c1", ticketId: "t1", actorId: "human", body: (body as any).body, attachmentIds: (body as any).attachmentIds ?? [], createdAt: "" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    vi.mocked(uploadFile).mockImplementation(async (_ticketId: string, file: File) => {
      order.push("upload");
      return { id: `att-${file.name}`, ticketId: "t1", commentId: null, actorId: "human", filename: file.name, mime: "text/plain", size: file.size, sha256: "", createdAt: "" };
    });

    renderDialog({ boards: [board({})], agents: [], apiImpl });
    await screen.findByRole("dialog", { name: "New ticket" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });

    const fileInput = document.getElementById("nt-file-input") as HTMLInputElement;
    const file1 = new File(["a"], "a.txt", { type: "text/plain" });
    const file2 = new File(["b"], "b.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file1, file2] } });
    });
    expect(screen.getByText("a.txt")).toBeTruthy();
    expect(screen.getByText("b.txt")).toBeTruthy();

    await act(async () => {
      editor().commands.setContent("<p>All the details</p>");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(order).toEqual(["create", "upload", "upload", "comment"]));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    expect(vi.mocked(api)).toHaveBeenCalledWith("POST", "/api/v1/comments", {
      ticketId: "t1",
      body: "All the details",
      attachmentIds: ["att-a.txt", "att-b.txt"],
    });
  });

  it("navigates to /board/t/:id when opened from the board", async () => {
    renderDialog({ returnTo: "board" });
    await screen.findByRole("dialog", { name: "New ticket" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/board/t/t1"));
  });

  it("saves assignee, dates, and needs human via PATCH and the flag endpoint before posting", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [agent({ id: "a1", name: "worker" })];
      if (method === "POST" && path === "/api/v1/tickets") return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: "x", laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      if (method === "PATCH" && path === "/api/v1/tickets/t1") return { id: "t1" };
      if (method === "POST" && path === "/api/v1/tickets/t1/flags") return { id: "t1" };
      throw new Error(`unexpected ${method} ${path}`);
    };

    renderDialog({ agents: [agent({ id: "a1", name: "worker" })], apiImpl });
    await screen.findByRole("dialog", { name: "New ticket" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-24" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByLabelText("Needs human"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    const patch = calls.find((c) => c.method === "PATCH" && c.path === "/api/v1/tickets/t1");
    expect(patch?.body).toEqual({ assigneeId: "a1", startDate: "2026-09-24", dueDate: "2026-09-30" });
    const flag = calls.find((c) => c.method === "POST" && c.path === "/api/v1/tickets/t1/flags");
    expect(flag?.body).toEqual({ flag: "needs_human", on: true });
  });
});
