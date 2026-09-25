// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Actor, Board, EvidenceType, Lane } from "@panorama/core";
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

const signoffType: EvidenceType = { id: "et_human_signoff", name: "Human sign-off", kind: "human_signoff", params: {}, humanOnly: true, needsAttachment: false, createdAt: "" };

const agent = (over: Partial<Actor>): Actor => ({
  id: "a1", kind: "agent", name: "worker", publicKey: "", scopes: null, status: "active", lastSeen: null, currentTicketId: null, createdAt: "", ...over,
});

function LocationProbe() {
  const loc = useLocation();
  return (
    <>
      <div data-testid="location">{loc.pathname}</div>
      <div data-testid="search">{loc.search}</div>
    </>
  );
}

/** The draft composer for one labelled field (Description or Success criteria), registered by Composer in test mode. */
function editor(label = "Description"): any {
  return (window as any).__panEditors?.[label];
}

const fieldDef = (over: Record<string, unknown> = {}) => ({
  id: "f1", projectId: "p1", name: "Severity", key: "severity", kind: "text", options: [], required: true, position: 0, archived: false, createdAt: "", ...over,
});
const epic = { id: "e1", projectId: "p1", name: "Launch", description: null, family: "lilac", position: 0, archived: false, createdAt: "" };
const tag = (id: string, name: string) => ({ id, projectId: "p1", name, family: "sky", archived: false, createdAt: "" });
const otherTicket = {
  id: "t2", projectId: "p1", boardId: "b1", number: 2, key: "PAN-2", title: "Other ticket", laneId: "l1", position: 2,
  epicId: null, tagIds: [], successCriteria: "", fields: {},
  flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "",
};

function renderDialog(opts: {
  boards?: Board[];
  lanes?: Lane[];
  agents?: Actor[];
  evidenceTypes?: EvidenceType[];
  epics?: unknown[];
  tags?: unknown[];
  fields?: unknown[];
  tickets?: unknown[];
  returnTo?: "queue" | "board";
  onClose?: (t?: any) => void;
  apiImpl?: (method: string, path: string, body?: unknown) => Promise<unknown>;
} = {}) {
  const boards = opts.boards ?? [board({})];
  const lanes = opts.lanes ?? [lane({})];
  const agents = opts.agents ?? [agent({})];
  const evidenceTypes = opts.evidenceTypes ?? [signoffType];
  const onClose = opts.onClose ?? vi.fn();

  vi.mocked(api).mockImplementation(
    opts.apiImpl ??
      (async (method: string, path: string, body?: unknown) => {
        if (method === "GET" && path === "/api/v1/projects/p1/boards") return boards;
        if (method === "GET" && path === "/api/v1/projects/p1/lanes") return lanes;
        if (method === "GET" && path === "/api/v1/agents") return agents;
        if (method === "GET" && path === "/api/v1/evidence-types") return evidenceTypes;
        if (method === "GET" && path === "/api/v1/epics?projectId=p1") return opts.epics ?? [];
        if (method === "GET" && path === "/api/v1/tags?projectId=p1") return opts.tags ?? [];
        if (method === "GET" && path === "/api/v1/fields?projectId=p1") return opts.fields ?? [];
        if (method === "GET" && path === "/api/v1/tickets?projectId=p1") return opts.tickets ?? [];
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

  it("hides the board picker with only one board, shows it with two", async () => {
    renderDialog({ boards: [board({})] });
    await screen.findByText("Backlog"); // waits for the lane picker's selected value, i.e. data loaded
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
    cleanup();

    renderDialog({ boards: [board({ id: "b1", name: "Panorama" }), board({ id: "b2", name: "Growth", position: 1 })] });
    await screen.findByRole("button", { name: "Board" });
    expect(screen.getByRole("button", { name: "Board" })).toBeTruthy();
  });

  it("disables a lane whose evidence requirements a brand new ticket cannot meet", async () => {
    renderDialog({
      lanes: [lane({}), lane({ id: "l6", name: "Done", position: 5, isDone: true, evidenceRequirements: [{ typeId: "et_human_signoff", count: 1 }] })],
    });
    await screen.findByText("Backlog");
    fireEvent.click(screen.getByRole("button", { name: "Lane" }));
    const done = await screen.findByRole("option", { name: "Done" });
    expect(done.getAttribute("aria-disabled")).toBe("true");
    expect(done.getAttribute("title")).toBe("Done (needs Human sign-off)");
    expect(screen.getByRole("option", { name: "Backlog" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("leaves the Description label pointing at nothing, since the composer labels itself", async () => {
    renderDialog();
    await screen.findByRole("dialog", { name: "New ticket" });
    // The composer is a rich text editor, not a form control a label can be bound to: the label
    // must not claim it, or a screen reader follows the association to a plain div.
    expect(screen.getByText("Description").getAttribute("for")).toBeNull();
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
      if (method === "GET" && path === "/api/v1/evidence-types") return [signoffType];
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

  it("retries only the files still pending after a mid-loop upload failure, without duplicating an already-uploaded attachment", async () => {
    let createCalls = 0;
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [];
      if (method === "GET" && path === "/api/v1/evidence-types") return [signoffType];
      if (method === "POST" && path === "/api/v1/tickets") {
        createCalls++;
        return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: (body as any).title, laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      }
      if (method === "POST" && path === "/api/v1/comments") {
        return { id: "c1", ticketId: "t1", actorId: "human", body: (body as any).body, attachmentIds: (body as any).attachmentIds ?? [], createdAt: "" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    };

    const uploadCalls: string[] = [];
    let bFailedOnce = false;
    vi.mocked(uploadFile).mockImplementation(async (_ticketId: string, file: File) => {
      uploadCalls.push(file.name);
      if (file.name === "b.txt" && !bFailedOnce) {
        bFailedOnce = true;
        throw new Error("network blip");
      }
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

    await act(async () => {
      editor().commands.setContent("<p>Both files</p>");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByRole("alert");
    expect(uploadCalls).toEqual(["a.txt", "b.txt"]);
    // a.txt's upload already succeeded, so it is no longer listed as pending; b.txt failed and
    // stays listed so the retry knows to try it again.
    expect(screen.queryByText("a.txt")).toBeNull();
    expect(screen.getByText("b.txt")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    expect(uploadCalls).toEqual(["a.txt", "b.txt", "b.txt"]); // exactly one more upload, not a re-upload of a.txt
    expect(createCalls).toBe(1); // the retry did not create a second ticket
    expect(vi.mocked(api)).toHaveBeenCalledWith("POST", "/api/v1/comments", {
      ticketId: "t1",
      body: "Both files",
      attachmentIds: ["att-a.txt", "att-b.txt"],
    });
  });

  it("keeps a ticket whose later steps failed and opens it on Cancel, with a notice", async () => {
    const onClose = vi.fn();
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [];
      if (method === "GET" && path === "/api/v1/evidence-types") return [signoffType];
      if (method === "POST" && path === "/api/v1/tickets") {
        return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: (body as any).title, laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      }
      throw new Error(`unexpected ${method} ${path}`);
    };
    vi.mocked(uploadFile).mockRejectedValue(new Error("network blip"));

    renderDialog({ boards: [board({})], agents: [], apiImpl, onClose });
    await screen.findByRole("dialog", { name: "New ticket" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    const fileInput = document.getElementById("nt-file-input") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(["a"], "a.txt", { type: "text/plain" })] } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByRole("alert");

    // The ticket exists on the server; cancelling must open it rather than orphan it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    expect(screen.getByTestId("search").textContent).toBe("?notice=partial");
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("just closes on Cancel when no ticket was created", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findByRole("dialog", { name: "New ticket" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(onClose).toHaveBeenCalledWith();
  });

  it("Escape closes only an open Picker's popover, not the whole dialog; a second Escape then cancels it", async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await screen.findByRole("dialog", { name: "New ticket" });

    const laneTrigger = screen.getByRole("button", { name: "Lane" });
    fireEvent.click(laneTrigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(laneTrigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "New ticket" })).toBeTruthy();

    fireEvent.keyDown(laneTrigger, { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith();
  });

  it("saves assignee, dates, and needs human via PATCH and the flag endpoint before posting", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [agent({ id: "a1", name: "worker" })];
      if (method === "GET" && path === "/api/v1/evidence-types") return [signoffType];
      if (method === "POST" && path === "/api/v1/tickets") return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: "x", laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      if (method === "PATCH" && path === "/api/v1/tickets/t1") return { id: "t1" };
      if (method === "POST" && path === "/api/v1/tickets/t1/flags") return { id: "t1" };
      throw new Error(`unexpected ${method} ${path}`);
    };

    renderDialog({ agents: [agent({ id: "a1", name: "worker" })], apiImpl });
    await screen.findByRole("dialog", { name: "New ticket" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
    fireEvent.click(screen.getByRole("option", { name: "worker" }));
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

describe("NewTicket dialog shell", () => {
  it("is a full-screen, labelled modal dialog", async () => {
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "New ticket" });
    expect(dialog.classList.contains("create-dialog")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("new-ticket-title");
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("NewTicket required fields", () => {
  it("keeps Create disabled and refuses Ctrl+Enter until every required custom field has a value", async () => {
    renderDialog({ fields: [fieldDef()] });
    await screen.findByRole("dialog", { name: "New ticket" });
    const severity = await screen.findByRole("textbox", { name: "Severity" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });

    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    // The api mock is shared across this file's tests; only calls from here on matter.
    vi.mocked(api).mockClear();
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter", ctrlKey: true });
    expect(await screen.findByText("Missing required fields: Severity")).toBeTruthy();
    expect(vi.mocked(api)).not.toHaveBeenCalledWith("POST", "/api/v1/tickets", expect.anything());

    fireEvent.change(severity, { target: { value: "high" } });
    expect(create.disabled).toBe(false);
    expect(screen.queryByText("Missing required fields: Severity")).toBeNull();
  });
});

describe("NewTicket required checkbox", () => {
  it("treats an untouched required checkbox as false: Create stays enabled and the POST carries false for it", async () => {
    const posts: unknown[] = [];
    vi.mocked(api).mockClear();
    renderDialog({ fields: [fieldDef({ id: "f2", name: "Approved", key: "approved", kind: "checkbox" })] });
    await screen.findByRole("dialog", { name: "New ticket" });
    await screen.findByRole("checkbox", { name: "Approved" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });

    const create = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    for (const call of vi.mocked(api).mock.calls) if (call[0] === "POST" && call[1] === "/api/v1/tickets") posts.push(call[2]);
    expect(posts).toHaveLength(1);
    expect((posts[0] as any).fields).toEqual({ approved: false });
  });
});

describe("NewTicket request order", () => {
  it("sends epic, tags, fields and success criteria in the one POST, then the flag, then the dependency link from the other ticket", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [];
      if (method === "GET" && path === "/api/v1/evidence-types") return [signoffType];
      if (method === "GET" && path === "/api/v1/epics?projectId=p1") return [epic];
      if (method === "GET" && path === "/api/v1/tags?projectId=p1") return [tag("tg1", "Backend"), tag("tg2", "Frontend")];
      if (method === "GET" && path === "/api/v1/fields?projectId=p1") return [fieldDef()];
      if (method === "GET" && path === "/api/v1/tickets?projectId=p1") return [otherTicket];
      if (method === "POST" && path === "/api/v1/tickets") {
        return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: (body as any).title, laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      }
      if (method === "POST" && path === "/api/v1/tickets/t1/flags") return { id: "t1" };
      if (method === "POST" && path === "/api/v1/tickets/t2/links") return { id: "link1", projectId: "p1", fromId: "t2", toId: "t1", kind: "blocks", createdAt: "" };
      throw new Error(`unexpected ${method} ${path}`);
    };

    renderDialog({ agents: [], apiImpl });
    await screen.findByRole("dialog", { name: "New ticket" });
    const severity = await screen.findByRole("textbox", { name: "Severity" });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });

    fireEvent.click(screen.getByRole("button", { name: "Epic" }));
    fireEvent.click(await screen.findByRole("option", { name: "Launch" }));

    const tags = screen.getByRole("button", { name: "Tags" });
    fireEvent.click(tags);
    fireEvent.click(await screen.findByRole("option", { name: "Backend" }));
    fireEvent.click(screen.getByRole("option", { name: "Frontend" }));
    fireEvent.keyDown(tags, { key: "Escape" });

    fireEvent.change(severity, { target: { value: "high" } });

    await act(async () => {
      editor("Success criteria").commands.setContent("<p>Tests pass</p>");
    });

    const blockedBy = screen.getByRole("button", { name: "Blocked by" });
    fireEvent.click(blockedBy);
    fireEvent.click(await screen.findByRole("option", { name: "PAN-2 Other ticket" }));
    fireEvent.keyDown(blockedBy, { key: "Escape" });

    fireEvent.click(screen.getByLabelText("Needs human"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/v1/tickets",
      "POST /api/v1/tickets/t1/flags",
      "POST /api/v1/tickets/t2/links",
    ]);
    expect(writes[0].body).toEqual({
      projectId: "p1",
      boardId: "b1",
      laneId: "l1",
      title: "Ship it",
      metadata: {},
      epicId: "e1",
      tagIds: ["tg1", "tg2"],
      successCriteria: "Tests pass",
      fields: { severity: "high" },
    });
    expect(writes[1].body).toEqual({ flag: "needs_human", on: true });
    expect(writes[2].body).toEqual({ toId: "t1", kind: "blocks" });
  });
});

describe("NewTicket request order, Blocks direction", () => {
  it('posts a "Blocks" link from the new ticket\'s own endpoint with the other ticket as toId', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const apiImpl = async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET" && path === "/api/v1/projects/p1/boards") return [board({})];
      if (method === "GET" && path === "/api/v1/projects/p1/lanes") return [lane({})];
      if (method === "GET" && path === "/api/v1/agents") return [];
      if (method === "GET" && path === "/api/v1/evidence-types") return [signoffType];
      if (method === "GET" && path === "/api/v1/epics?projectId=p1") return [];
      if (method === "GET" && path === "/api/v1/tags?projectId=p1") return [];
      if (method === "GET" && path === "/api/v1/fields?projectId=p1") return [];
      if (method === "GET" && path === "/api/v1/tickets?projectId=p1") return [otherTicket];
      if (method === "POST" && path === "/api/v1/tickets") {
        return { id: "t1", projectId: "p1", boardId: "b1", key: "PAN-1", title: (body as any).title, laneId: "l1", number: 1, position: 1, flags: [], assigneeId: null, startDate: null, dueDate: null, metadata: {}, archived: false, createdAt: "", updatedAt: "" };
      }
      if (method === "POST" && path === "/api/v1/tickets/t1/links") return { id: "link1", projectId: "p1", fromId: "t1", toId: "t2", kind: "blocks", createdAt: "" };
      throw new Error(`unexpected ${method} ${path}`);
    };

    renderDialog({ agents: [], apiImpl });
    await screen.findByRole("dialog", { name: "New ticket" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship it" } });

    const blocks = screen.getByRole("button", { name: "Blocks" });
    fireEvent.click(blocks);
    fireEvent.click(await screen.findByRole("option", { name: "PAN-2 Other ticket" }));
    fireEvent.keyDown(blocks, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/t/t1"));
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/v1/tickets", "POST /api/v1/tickets/t1/links"]);
    expect(writes[1].body).toEqual({ toId: "t2", kind: "blocks" });
  });
});

describe("NewTicket automations preview", () => {
  const prType: EvidenceType = { id: "et_pr_link", name: "PR link", kind: "pr_link", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" };
  const testType: EvidenceType = { id: "et_test_run", name: "Test run", kind: "test_run", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" };

  it("names each lane whose requirements gate the ticket, with the requirement names", async () => {
    renderDialog({
      lanes: [
        lane({}),
        lane({ id: "l4", name: "Review", position: 3, family: "lilac", evidenceRequirements: [{ typeId: "et_pr_link", count: 1 }, { typeId: "et_test_run", count: 1 }] }),
        lane({ id: "l6", name: "Done", position: 5, family: "mint", isDone: true, evidenceRequirements: [{ typeId: "et_human_signoff", count: 1 }] }),
      ],
      evidenceTypes: [signoffType, prType, testType],
    });
    expect(await screen.findByText("Gated at Review (PR link, Test run) and Done (Human sign-off).")).toBeTruthy();
  });

  it("leaves out the lane the ticket is created into, even when that lane carries a requirement", async () => {
    renderDialog({
      lanes: [
        lane({ evidenceRequirements: [{ typeId: "et_pr_link", count: 1 }] }),
        lane({ id: "l4", name: "Review", position: 3, family: "lilac", evidenceRequirements: [{ typeId: "et_test_run", count: 1 }] }),
        lane({ id: "l6", name: "Done", position: 5, family: "mint", isDone: true, evidenceRequirements: [{ typeId: "et_human_signoff", count: 1 }] }),
      ],
      evidenceTypes: [signoffType, prType, testType],
    });
    const preview = await screen.findByText(/^Gated at/);
    expect(preview.textContent).toBe("Gated at Review (Test run) and Done (Human sign-off).");
  });

  it("phrases a single gated lane without a conjunction", async () => {
    renderDialog({
      lanes: [lane({}), lane({ id: "l6", name: "Done", position: 5, family: "mint", isDone: true, evidenceRequirements: [{ typeId: "et_human_signoff", count: 1 }] })],
    });
    expect(await screen.findByText("Gated at Done (Human sign-off).")).toBeTruthy();
  });

  it("says so when no lane gates it", async () => {
    renderDialog();
    expect(await screen.findByText("No lanes gate this ticket yet.")).toBeTruthy();
  });
});
