// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../lib/api";
import { TagsTab } from "./TagsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

type Call = { method: string; path: string; body?: unknown };

const tags = [
  { id: "tg1", projectId: "p1", name: "Bug", family: "coral" as const, color: null, archived: false, createdAt: "" },
  { id: "tg2", projectId: "p1", name: "Urgent", family: "stone" as const, color: "#f6c1b4", archived: false, createdAt: "" },
];

const tickets = [
  { id: "t1", key: "P-1", projectId: "p1", laneId: "l1", epicId: null, tagIds: ["tg1", "tg2"], archived: false },
  { id: "t2", key: "P-2", projectId: "p1", laneId: "l1", epicId: null, tagIds: ["tg1"], archived: false },
];

function mockApi(tagList: () => typeof tags = () => tags, onWrite: (c: Call) => Promise<unknown> = () => Promise.resolve(tags[0])) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === "GET") {
      if (path.startsWith("/api/v1/tags")) return Promise.resolve(tagList());
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
      <TagsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

function row(name: string): ReturnType<typeof within> {
  const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: ".chip" }));
  if (!item) throw new Error(`No row named ${name}`);
  return within(item);
}

describe("TagsTab", () => {
  it("shows each tag as a chip with its ticket count", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Bug", { selector: ".chip" });
    expect(row("Bug").getByText("2 tickets")).toBeTruthy();
    expect(row("Urgent").getByText("1 ticket")).toBeTruthy();
  });

  it("creates a tag with the chosen preset colour", async () => {
    const calls = mockApi(() => [], () => Promise.resolve({ ...tags[0], id: "tg3", name: "Backend", color: "#bfe8cf" }));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    const name = screen.getByLabelText("Name");
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "Backend" } });
    fireEvent.click(screen.getByRole("button", { name: "#bfe8cf" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ projectId: "p1", name: "Backend", family: "stone", color: "#bfe8cf" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("edits a tag's name and colour in place, saving once through PATCH and refetching the list", async () => {
    let getCalls = 0;
    const calls = mockApi(
      () => {
        getCalls++;
        return tags;
      },
      () => Promise.resolve({ ...tags[0], name: "Defect", color: "#d3c8f4" }),
    );
    renderTab();

    await screen.findByText("Bug", { selector: ".chip" });
    fireEvent.click(row("Bug").getByRole("button", { name: "Edit" }));
    fireEvent.change(row("Bug").getByLabelText("Name"), { target: { value: "Defect" } });
    fireEvent.click(row("Bug").getByRole("button", { name: "#d3c8f4" }));
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    fireEvent.click(row("Bug").getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/tags/tg1");
    expect(patch?.body).toEqual({ name: "Defect", family: "coral", color: "#d3c8f4" });
    await waitFor(() => expect(getCalls).toBeGreaterThan(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("shows the edit error and keeps the form open when the name is taken", async () => {
    mockApi(() => tags, () => Promise.reject(new ApiError(409, "duplicate_tag", "That tag name is already used in this project")));
    renderTab();

    await screen.findByText("Bug", { selector: ".chip" });
    fireEvent.click(row("Bug").getByRole("button", { name: "Edit" }));
    fireEvent.change(row("Bug").getByLabelText("Name"), { target: { value: "Urgent" } });
    fireEvent.click(row("Bug").getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That tag name is already used in this project");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("disables Save while the name is empty and Escape cancels the add form", async () => {
    mockApi(() => []);
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add tag" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bug" } });
    expect(save.disabled).toBe(false);
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("archives after an inline confirmation", async () => {
    const calls = mockApi();
    renderTab();

    await screen.findByText("Bug", { selector: ".chip" });
    fireEvent.click(row("Bug").getByRole("button", { name: "Archive" }));
    expect(row("Bug").getByText("Archive Bug?")).toBeTruthy();
    fireEvent.click(row("Bug").getByRole("button", { name: "Archive", exact: true }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.path).toBe("/api/v1/tags/tg1/archive");
  });
});
