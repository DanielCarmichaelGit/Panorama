// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { EpicsTab } from "./EpicsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

type Call = { method: string; path: string; body?: unknown };

const epics = [
  { id: "e1", projectId: "p1", name: "Growth", description: "Everything that widens the funnel", family: "stone" as const, color: null, position: 0, archived: false, createdAt: "" },
  { id: "e2", projectId: "p1", name: "Platform", description: null, family: "stone" as const, color: null, position: 1, archived: false, createdAt: "" },
];

const tickets = [
  { id: "t1", key: "P-1", projectId: "p1", laneId: "l1", epicId: "e1", tagIds: [], archived: false },
  { id: "t2", key: "P-2", projectId: "p1", laneId: "l1", epicId: "e1", tagIds: [], archived: false },
  { id: "t3", key: "P-3", projectId: "p1", laneId: "l1", epicId: null, tagIds: [], archived: false },
];

function mockApi(onWrite: (c: Call) => Promise<unknown> = () => Promise.resolve(epics[0])) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === "GET") {
      if (path.startsWith("/api/v1/epics")) return Promise.resolve(epics);
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
      <EpicsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

function row(name: string): ReturnType<typeof within> {
  const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: ".chip" }));
  if (!item) throw new Error(`No row named ${name}`);
  return within(item);
}

describe("EpicsTab", () => {
  it("shows each arc as a chip with its description and ticket count", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Growth", { selector: ".chip" });
    expect(row("Growth").getByText("Everything that widens the funnel")).toBeTruthy();
    expect(row("Growth").getByText("2 tickets")).toBeTruthy();
    expect(row("Platform").getByText("0 tickets")).toBeTruthy();
  });

  it("creates an arc with the chosen preset colour, sent only on Save", async () => {
    const calls = mockApi(() => Promise.resolve({ ...epics[0], id: "e3", name: "Launch", color: "#f7d9a8" }));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add arc" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("button", { name: "#f7d9a8" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/api/v1/epics");
    expect(post?.body).toEqual({ projectId: "p1", name: "Launch", description: undefined, family: "stone", color: "#f7d9a8" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("edits an arc's colour to a custom hex and sends it on Save", async () => {
    const calls = mockApi(() => Promise.resolve({ ...epics[0], family: "sky", color: "#12706a" }));
    renderTab();

    await screen.findByText("Growth", { selector: ".chip" });
    fireEvent.click(row("Growth").getByRole("button", { name: "Edit" }));
    fireEvent.click(row("Growth").getByRole("button", { name: "Custom colour" }));
    fireEvent.change(row("Growth").getByLabelText("Hex"), { target: { value: "#12706a" } });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    fireEvent.click(row("Growth").getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/epics/e1");
    expect(patch?.body).toEqual({ name: "Growth", description: "Everything that widens the funnel", family: "stone", color: "#12706a" });
  });

  it("shows a row-level alert when archiving fails", async () => {
    mockApi(() => Promise.reject(new Error("Server refused the archive.")));
    renderTab();

    await screen.findByText("Growth", { selector: ".chip" });
    fireEvent.click(row("Growth").getByRole("button", { name: "Archive" }));
    expect(row("Growth").getByText("Archive Growth?")).toBeTruthy();
    fireEvent.click(row("Growth").getByRole("button", { name: "Archive", exact: true }));

    expect((await screen.findByRole("alert")).textContent).toBe("Server refused the archive.");
  });

  it("keeps only one row expanded at a time", async () => {
    mockApi();
    renderTab();

    await screen.findByText("Growth", { selector: ".chip" });
    fireEvent.click(row("Growth").getByRole("button", { name: "Edit" }));
    fireEvent.click(row("Platform").getByRole("button", { name: "Edit" }));
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(row("Platform").getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
