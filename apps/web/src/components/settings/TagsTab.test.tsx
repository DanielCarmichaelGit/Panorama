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

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TagsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

const tags = [
  { id: "tg1", projectId: "p1", name: "Bug", family: "coral" as const, color: null, archived: false, createdAt: "" },
  { id: "tg2", projectId: "p1", name: "Urgent", family: "stone" as const, color: "#f6c1b4", archived: false, createdAt: "" },
];

describe("TagsTab", () => {
  it("creates a tag with the chosen preset colour", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET") return Promise.resolve([]);
      return Promise.resolve({ ...tags[0], id: "tg3", name: "Backend", color: "#bfe8cf" });
    });
    renderTab();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Backend" } });
    fireEvent.click(screen.getByRole("button", { name: "#bfe8cf" }));
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ projectId: "p1", name: "Backend", family: "stone", color: "#bfe8cf" });
  });

  it("edits a tag's name and colour in place, saving once through PATCH and refetching the list", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    let getCalls = 0;
    vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET") {
        getCalls++;
        return Promise.resolve(tags);
      }
      return Promise.resolve({ ...tags[0], name: "Defect", color: "#d3c8f4" });
    });
    renderTab();

    const edits = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(edits[0]);
    const name = screen.getByLabelText("Name", { selector: "#te-name-tg1" });
    // The create form above the list has its own colour field, so scope to the row's form.
    const form = within(name.closest("form") as HTMLFormElement);
    fireEvent.change(name, { target: { value: "Defect" } });
    fireEvent.click(form.getByRole("button", { name: "#d3c8f4" }));
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    fireEvent.click(form.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/tags/tg1");
    expect(patch?.body).toEqual({ name: "Defect", family: "coral", color: "#d3c8f4" });
    await waitFor(() => expect(getCalls).toBeGreaterThan(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("shows the edit error and keeps the form open when the name is taken", async () => {
    vi.mocked(api).mockImplementation((method: string) => {
      if (method === "GET") return Promise.resolve(tags);
      return Promise.reject(new ApiError(409, "duplicate_tag", "Tag name already used"));
    });
    renderTab();

    const edits = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(edits[0]);
    fireEvent.change(screen.getByLabelText("Name", { selector: "#te-name-tg1" }), { target: { value: "Urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That name is taken");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("shows a 409 duplicate_tag error as 'That name is taken'", async () => {
    vi.mocked(api).mockImplementation((method: string) => {
      if (method === "GET") return Promise.resolve([]);
      return Promise.reject(new ApiError(409, "duplicate_tag", "Tag name already used"));
    });
    renderTab();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Bug" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That name is taken");
  });

  it("disables Create while the name is empty", async () => {
    vi.mocked(api).mockResolvedValue([]);
    renderTab();
    const create = await screen.findByRole("button", { name: "Create tag" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bug" } });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });
});
