// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../lib/api";
import { DestinationsTab } from "./DestinationsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

type Call = { method: string; path: string; body?: unknown };

const live = { id: "d1", projectId: "p1", name: "Slack relay", url: "https://hooks.example.com/services/T000/B000/a-very-long-token-that-runs-on", archived: false, createdAt: "" };
const archived = { id: "d2", projectId: "p1", name: "Old relay", url: "https://old.example.com/hook", archived: true, createdAt: "" };

function mockApi(onWrite: (c: Call) => Promise<unknown> = () => Promise.resolve({ ok: true }), list = [live, archived]) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === "GET") {
      if (path.startsWith("/api/v1/destinations?")) return Promise.resolve(list);
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
      <DestinationsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

function row(name: string): ReturnType<typeof within> {
  const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: ".row-name" }));
  if (!item) throw new Error(`No row named ${name}`);
  return within(item);
}

describe("DestinationsTab", () => {
  it("lists every destination with its url in mono and an Archived chip on the archived ones", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Slack relay", { selector: ".row-name" });
    const url = row("Slack relay").getByText(live.url);
    expect(url.classList.contains("mono")).toBe(true);
    expect(url.classList.contains("row-truncate")).toBe(true);
    expect(row("Slack relay").queryByText("Archived")).toBeNull();
    expect(row("Old relay").getByText("Archived")).toBeTruthy();
    expect((row("Old relay").getByRole("button", { name: "Send test" }) as HTMLButtonElement).disabled).toBe(true);
    expect(row("Old relay").queryByRole("button", { name: "Archive" })).toBeNull();
    expect(row("Old relay").getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(screen.getByText(/Boomerang signs every delivery/)).toBeTruthy();
  });

  it("adds a destination, shows its secret once, and Done puts it away", async () => {
    const calls = mockApi((c) => Promise.resolve({ ...live, id: "d3", ...(c.body as object), secret: "a".repeat(64) }));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add destination" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pager" } });
    fireEvent.change(screen.getByLabelText("Url"), { target: { value: "https://pager.example.com/in" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls[0]).toEqual({ method: "POST", path: "/api/v1/destinations", body: { projectId: "p1", name: "Pager", url: "https://pager.example.com/in" } });

    const panel = await screen.findByRole("region", { name: "Secret for Pager" });
    expect(within(panel).getByText("a".repeat(64)).classList.contains("mono")).toBe(true);
    expect(within(panel).getByText("Shown once. Store it in the receiver now.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // The keyboard lands on Copy, the one thing to do with a secret shown once.
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Copy" }));

    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("a".repeat(64));
    await within(panel).findByText("Copied");

    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("region", { name: "Secret for Pager" })).toBeNull();
    expect(screen.queryByText("a".repeat(64))).toBeNull();
  });

  it("rotates the secret after a confirmation and shows the new one", async () => {
    const calls = mockApi((c) => Promise.resolve(c.path.endsWith("/rotate") ? { ...live, secret: "b".repeat(64) } : { ok: true }));
    renderTab();

    await screen.findByText("Slack relay", { selector: ".row-name" });
    fireEvent.click(row("Slack relay").getByRole("button", { name: "Rotate secret" }));
    expect(row("Slack relay").getByText("Rotate the secret for Slack relay?")).toBeTruthy();
    fireEvent.click(row("Slack relay").getByRole("button", { name: "Rotate" }));

    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/destinations/d1/rotate")).toBe(true));
    const panel = await screen.findByRole("region", { name: "Secret for Slack relay" });
    expect(within(panel).getByText("b".repeat(64))).toBeTruthy();
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Copy" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    expect(screen.queryByText("b".repeat(64))).toBeNull();
  });

  it("archives after a confirmation and restores an archived one", async () => {
    const calls = mockApi();
    renderTab();

    await screen.findByText("Slack relay", { selector: ".row-name" });
    fireEvent.click(row("Slack relay").getByRole("button", { name: "Archive" }));
    expect(row("Slack relay").getByText("Archive Slack relay?")).toBeTruthy();
    fireEvent.click(row("Slack relay").getByRole("button", { name: "Archive", exact: true }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls[0]).toEqual({ method: "PATCH", path: "/api/v1/destinations/d1", body: { archived: true } });
    // The confirmation is gone; focus comes back to the row's actions rather than dropping to the page.
    await waitFor(() => expect(row("Slack relay").queryByText("Archive Slack relay?")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(row("Slack relay").getByRole("button", { name: "Edit" })));

    fireEvent.click(row("Old relay").getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]).toEqual({ method: "PATCH", path: "/api/v1/destinations/d2", body: { archived: false } });
  });

  it("edits the name and url in place", async () => {
    const calls = mockApi();
    renderTab();

    await screen.findByText("Slack relay", { selector: ".row-name" });
    fireEvent.click(row("Slack relay").getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Slack relay 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls[0]).toEqual({ method: "PATCH", path: "/api/v1/destinations/d1", body: { name: "Slack relay 2" } });
  });

  it("queues a test delivery and says so", async () => {
    const calls = mockApi(() => Promise.resolve({ id: "o1" }));
    renderTab();

    await screen.findByText("Slack relay", { selector: ".row-name" });
    fireEvent.click(row("Slack relay").getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/v1/destinations/d1/test")).toBe(true));
    expect(await row("Slack relay").findByText("Test delivery queued. The receiver should see it within a few seconds.")).toBeTruthy();
  });

  it("shows the server's duplicate_name refusal in the form", async () => {
    mockApi(() => Promise.reject(new ApiError(400, "duplicate_name", "That destination name is already used in this project")));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add destination" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Slack relay" } });
    fireEvent.change(screen.getByLabelText("Url"), { target: { value: "https://pager.example.com/in" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("That destination name is already used in this project");
  });

  it("turns the server's validation refusal of a url with credentials into words", async () => {
    mockApi(() => Promise.reject(new ApiError(400, "validation", "Invalid request", [{ path: ["url"], message: "a url without credentials" }])));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add destination" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pager" } });
    fireEvent.change(screen.getByLabelText("Url"), { target: { value: "https://user:pass@pager.example.com/in" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The url must start with http or https and carry no username or password.");
  });

  it("names the field the server's validation refusal is about", async () => {
    mockApi(() => Promise.reject(new ApiError(400, "validation", "Invalid request", [{ path: ["name"], message: "String must contain at most 80 character(s)" }])));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add destination" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pager" } });
    fireEvent.change(screen.getByLabelText("Url"), { target: { value: "https://pager.example.com/in" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The name is 1 to 80 characters.");
  });

  it("shows the empty state when there are no destinations", async () => {
    mockApi(undefined, []);
    renderTab();
    expect(await screen.findByText(/No destinations yet/)).toBeTruthy();
  });
});
