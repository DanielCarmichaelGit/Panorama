// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { FieldsTab, suggestKey } from "./FieldsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

type Call = { method: string; path: string; body?: unknown };

const fields = [
  { id: "f1", projectId: "p1", name: "Story points", key: "story_points", kind: "number" as const, options: [], required: false, position: 0, archived: false, createdAt: "" },
  { id: "f2", projectId: "p1", name: "Customer", key: "customer", kind: "select" as const, options: [{ value: "acme", label: "Acme" }, { value: "globex", label: "Globex" }], required: true, position: 1, archived: false, createdAt: "" },
];

function mockApi(list: typeof fields = fields, onWrite: (c: Call) => Promise<unknown> = () => Promise.resolve(fields[0])) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === "GET") return Promise.resolve(list);
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
      <FieldsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

function row(name: string): ReturnType<typeof within> {
  const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: ".row-name" }));
  if (!item) throw new Error(`No row named ${name}`);
  return within(item);
}

describe("suggestKey", () => {
  it("lowercases a name into underscores and strips symbols", () => {
    expect(suggestKey("Story points")).toBe("story_points");
    expect(suggestKey("Story points!")).toBe("story_points");
    expect(suggestKey("  Sprint #  ")).toBe("sprint");
  });
});

describe("FieldsTab", () => {
  it("shows each field's key, kind, Required chip, and option count", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Customer", { selector: ".row-name" });
    expect(row("Story points").getByText("story_points")).toBeTruthy();
    expect(row("Story points").getByText("Number")).toBeTruthy();
    expect(row("Story points").queryByText("Required")).toBeNull();
    expect(row("Customer").getByText("Required")).toBeTruthy();
    expect(row("Customer").getByText("2 options")).toBeTruthy();
  });

  it("disables Save while the name or key is empty and suggests the key from the name", async () => {
    mockApi([]);
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Add field" }));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Story points" } });
    expect((screen.getByLabelText("Key") as HTMLInputElement).value).toBe("story_points");
    expect(save.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "" } });
    expect(save.disabled).toBe(true);
  });

  it("shows the options editor only when the kind is select", async () => {
    mockApi([]);
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Add field" }));
    expect(screen.queryByText("Options")).toBeNull();

    fireEvent.click(screen.getByLabelText("Kind"));
    fireEvent.click(screen.getByRole("option", { name: "Select" }));
    expect(screen.getByText("Options")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add option" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Kind"));
    fireEvent.click(screen.getByRole("option", { name: "Text" }));
    expect(screen.queryByText("Options")).toBeNull();
  });

  it("creates a field through the add form and closes it", async () => {
    const calls = mockApi([], (c) => Promise.resolve({ ...fields[0], id: "f3", ...(c.body as object) }));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Add field" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Customer" } });
    fireEvent.click(screen.getByLabelText("Required"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ projectId: "p1", name: "Customer", key: "customer", kind: "text", required: true, options: undefined });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("shows an alert when archiving a field fails", async () => {
    mockApi(fields, (c) => (c.path.endsWith("/archive") ? Promise.reject(new Error("Server refused the archive.")) : Promise.resolve(fields[0])));
    renderTab();

    await screen.findByText("Story points", { selector: ".row-name" });
    fireEvent.click(row("Story points").getByRole("button", { name: "Archive" }));
    expect(row("Story points").getByText("Archive Story points?")).toBeTruthy();
    fireEvent.click(row("Story points").getByRole("button", { name: "Archive", exact: true }));

    expect((await screen.findByRole("alert")).textContent).toBe("Server refused the archive.");
  });

  it("moves a field down by swapping positions through two PATCHes", async () => {
    const calls = mockApi();
    renderTab();

    await screen.findByText("Story points", { selector: ".row-name" });
    expect((row("Story points").getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row("Story points").getByRole("button", { name: "Move down" }));

    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ["/api/v1/fields/f1", { position: 1 }],
      ["/api/v1/fields/f2", { position: 0 }],
    ]);
  });
});
