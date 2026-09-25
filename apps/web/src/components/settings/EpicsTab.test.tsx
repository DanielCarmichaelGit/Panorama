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

const epics = [
  { id: "e1", projectId: "p1", name: "Growth", description: null, family: "stone" as const, color: null, position: 0, archived: false, createdAt: "" },
  { id: "e2", projectId: "p1", name: "Platform", description: null, family: "stone" as const, color: null, position: 1, archived: false, createdAt: "" },
];

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EpicsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

describe("EpicsTab", () => {
  it("creates an arc with the chosen preset colour, sent only on Create", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET") return Promise.resolve(epics);
      return Promise.resolve({ ...epics[0], id: "e3", name: "Launch", color: "#f7d9a8" });
    });
    renderTab();

    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("button", { name: "#f7d9a8" }));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Create arc" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/api/v1/epics");
    expect(post?.body).toEqual({ projectId: "p1", name: "Launch", description: undefined, family: "stone", color: "#f7d9a8" });
  });

  it("edits an arc's colour through the colour field and sends it on Save", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body });
      if (method === "GET") return Promise.resolve(epics);
      return Promise.resolve({ ...epics[0], family: "sky", color: "#12706a" });
    });
    renderTab();

    const edits = await screen.findAllByRole("button", { name: "Edit" });
    fireEvent.click(edits[0]);
    // The create form above the list has its own colour field, so scope to the row's form.
    const form = within(screen.getByLabelText("Name", { selector: "#ee-name-e1" }).closest("form") as HTMLFormElement);
    fireEvent.click(form.getByRole("button", { name: "Custom colour" }));
    fireEvent.change(form.getByLabelText("Hex"), { target: { value: "#12706a" } });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    fireEvent.click(form.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/api/v1/epics/e1");
    expect(patch?.body).toEqual({ name: "Growth", description: null, family: "stone", color: "#12706a" });
  });

  it("shows a row-level alert and refetches when reordering fails", async () => {
    let getCalls = 0;
    vi.mocked(api).mockImplementation((method: string) => {
      if (method === "GET") {
        getCalls++;
        return Promise.resolve(epics);
      }
      if (method === "PATCH") return Promise.reject(new Error("boom"));
      return Promise.resolve(epics[0]);
    });
    renderTab();

    const moveDown = await screen.findAllByRole("button", { name: "Move down" });
    fireEvent.click(moveDown[0]);

    expect((await screen.findByRole("alert")).textContent).toBe("Could not reorder");
    await waitFor(() => expect(getCalls).toBeGreaterThan(1));
  });
});
