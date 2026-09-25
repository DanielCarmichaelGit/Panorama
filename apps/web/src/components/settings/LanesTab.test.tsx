// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../lib/api";
import { LanesTab } from "./LanesTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

type Call = { method: string; path: string; body?: unknown };

const lanes = [
  { id: "l1", projectId: "p1", name: "Backlog", position: 0, family: "stone" as const, setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
  { id: "l2", projectId: "p1", name: "Review", position: 1, family: "lilac" as const, setsNeedsHuman: true, isDone: false, evidenceRequirements: [{ typeId: "et_eval_score", count: 1 }] },
  { id: "l3", projectId: "p1", name: "Done", position: 2, family: "mint" as const, setsNeedsHuman: false, isDone: true, evidenceRequirements: [{ typeId: "et_human_signoff", count: 1 }] },
];

const types = [
  { id: "et_eval_score", name: "Eval score", kind: "eval_score" as const, params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false, createdAt: "" },
  { id: "et_human_signoff", name: "Human sign-off", kind: "human_signoff" as const, params: {}, humanOnly: true, needsAttachment: false, createdAt: "" },
];

const ticket = (id: string, laneId: string) => ({ id, key: `P-${id}`, projectId: "p1", laneId, epicId: null, tagIds: [], archived: false });

/**
 * Routes the mocked api by method and path: GET lanes, evidence types, and tickets come from the
 * fixtures (a `laneList` override lets a test grow the list after a create), every write is
 * recorded in `calls` and answered by `onWrite`.
 */
function mockApi({
  laneList = () => lanes,
  tickets = [] as ReturnType<typeof ticket>[],
  onWrite = () => Promise.resolve({ ok: true }) as Promise<unknown>,
}: { laneList?: () => typeof lanes; tickets?: ReturnType<typeof ticket>[]; onWrite?: (c: Call) => Promise<unknown> } = {}) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === "GET") {
      if (path.endsWith("/lanes")) return Promise.resolve(laneList());
      if (path.endsWith("/evidence-types")) return Promise.resolve(types);
      if (path.startsWith("/api/v1/tickets")) return Promise.resolve(tickets);
      return Promise.resolve([]);
    }
    const call = { method, path, body };
    calls.push(call);
    return onWrite(call);
  });
  return calls;
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanesTab projectId="p1" />
    </QueryClientProvider>,
  );
}

function row(name: string): ReturnType<typeof within> {
  const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: ".row-name" }));
  if (!item) throw new Error(`No row named ${name}`);
  return within(item);
}

describe("LanesTab", () => {
  it("lists lanes in position order with their flags and requirement summary", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Review", { selector: ".row-name" });
    const names = screen.getAllByRole("listitem").map((li) => li.querySelector(".row-name")?.textContent);
    expect(names).toEqual(["Backlog", "Review", "Done"]);
    expect(row("Review").getByText("Needs human on entry")).toBeTruthy();
    expect(row("Review").getByText("Needs Eval score to enter")).toBeTruthy();
    expect(row("Done").getByText("Done lane")).toBeTruthy();
    expect(row("Backlog").getByText("No requirements")).toBeTruthy();
  });

  it("adds a lane: Save sends the POST body and the new row appears", async () => {
    let list = lanes;
    const calls = mockApi({
      laneList: () => list,
      onWrite: (c) => {
        if (c.method === "POST") {
          const created = { id: "l4", projectId: "p1", name: "Eval", position: 2, family: "lilac" as const, setsNeedsHuman: true, isDone: false, evidenceRequirements: [] };
          list = [lanes[0], lanes[1], created, { ...lanes[2], position: 3 }];
          return Promise.resolve(created);
        }
        return Promise.resolve({ ok: true });
      },
    });
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add lane" }));
    const name = screen.getByLabelText("Name");
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "Eval" } });
    fireEvent.click(screen.getByRole("button", { name: "Lilac" }));
    fireEvent.click(screen.getByLabelText("Needs human on entry"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/api/v1/projects/p1/lanes");
    expect(post?.body).toEqual({ name: "Eval", family: "lilac", setsNeedsHuman: true, isDone: false });
    await screen.findByText("Eval", { selector: ".row-name" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    const names = screen.getAllByRole("listitem").map((li) => li.querySelector(".row-name")?.textContent);
    expect(names).toEqual(["Backlog", "Review", "Eval", "Done"]);
  });

  it("shows the server's message when a delete is refused", async () => {
    mockApi({ onWrite: () => Promise.reject(new ApiError(409, "lane_in_use", "Move its 2 tickets first")) });
    renderTab();

    await screen.findByText("Review", { selector: ".row-name" });
    fireEvent.click(row("Review").getByRole("button", { name: "Delete" }));
    expect(row("Review").getByText("Delete Review?")).toBeTruthy();
    fireEvent.click(row("Review").getByRole("button", { name: "Delete", exact: true }));

    expect((await screen.findByRole("alert")).textContent).toBe("Move its 2 tickets first");
  });

  it("disables Delete with the ticket count when the lane has tickets", async () => {
    mockApi({ tickets: [ticket("t1", "l2"), ticket("t2", "l2"), ticket("t3", "l1")] });
    renderTab();

    await screen.findByText("Review", { selector: ".row-name" });
    const del = row("Review").getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe("Move its 2 tickets first");
    const one = row("Backlog").getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(one.title).toBe("Move its 1 ticket first");
  });

  it("disables Delete on the only done lane with the reason", async () => {
    mockApi();
    renderTab();

    await screen.findByText("Done", { selector: ".row-name" });
    const del = row("Done").getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe("Add another done lane first");
    expect((row("Review").getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("expands one row at a time and Escape cancels", async () => {
    mockApi();
    renderTab();

    await screen.findByText("Review", { selector: ".row-name" });
    fireEvent.click(row("Backlog").getByRole("button", { name: "Edit" }));
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(row("Backlog").getByRole("button", { name: "Save" })).toBeTruthy();

    fireEvent.click(row("Review").getByRole("button", { name: "Edit" }));
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(row("Review").getByRole("button", { name: "Save" })).toBeTruthy();
    expect(row("Backlog").queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add lane" }));
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(row("Review").queryByRole("button", { name: "Save" })).toBeNull();

    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves only what changed: a flag through PATCH, requirements through PUT", async () => {
    const calls = mockApi({ onWrite: (c) => Promise.resolve(c.method === "PATCH" ? { ...lanes[0], isDone: true } : lanes[0]) });
    renderTab();

    await screen.findByText("Backlog", { selector: ".row-name" });
    fireEvent.click(row("Backlog").getByRole("button", { name: "Edit" }));
    fireEvent.click(row("Backlog").getByLabelText("Done lane"));
    fireEvent.click(row("Backlog").getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toEqual({ method: "PATCH", path: "/api/v1/lanes/l1", body: { isDone: true } });
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());

    fireEvent.click(row("Backlog").getByRole("button", { name: "Edit" }));
    fireEvent.click(row("Backlog").getByRole("button", { name: "Add requirement" }));
    fireEvent.click(row("Backlog").getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      method: "PUT",
      path: "/api/v1/lanes/l1/requirements",
      body: { requirements: [{ typeId: "et_eval_score", count: 1 }] },
    });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });

  it("moves a lane down through the order route with the full id list", async () => {
    const calls = mockApi();
    renderTab();

    await screen.findByText("Backlog", { selector: ".row-name" });
    expect((row("Backlog").getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row("Backlog").getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    expect(calls.find((c) => c.method === "PUT")).toEqual({ method: "PUT", path: "/api/v1/projects/p1/lanes/order", body: { ids: ["l2", "l1", "l3"] } });
  });
});
