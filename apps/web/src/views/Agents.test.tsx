// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { Agents, scopesFromForm, shortKey } from "./Agents";

vi.mock("../lib/api", () => ({ api: vi.fn() }));

afterEach(cleanup);

const agent = (over: Record<string, unknown>) => ({
  id: "ag1", kind: "agent", name: "worker", publicKey: "aa".repeat(32), scopes: null,
  status: "pending", lastSeen: null, createdAt: "2026-09-21T10:00:00.000Z", ...over,
});

function renderAgents(list: unknown[]) {
  vi.mocked(api).mockImplementation(async (_method: string, path: string) => {
    if (path === "/api/v1/agents") return list;
    throw new Error("Boomerang could not reach the agent");
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Agents />
    </QueryClientProvider>
  );
}

describe("agents helpers", () => {
  it("shortens keys", () => { expect(shortKey("0123456789abcdef".repeat(4))).toBe("01234567…cdef"); });
  it("builds scopes and always keeps read first", () => {
    expect(scopesFromForm("*", ["ticket.move", "read"])).toEqual({ projects: "*", actions: ["read", "ticket.move"] });
    expect(scopesFromForm(["p1"], ["read"])).toEqual({ projects: ["p1"], actions: ["read"] });
  });
});

describe("Agents view", () => {
  it("reports a failed reject beside the row", async () => {
    renderAgents([agent({})]);
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Boomerang could not reach the agent");
  });

  it("reports a failed revoke beside the row", async () => {
    renderAgents([agent({ id: "ag2", name: "runner", status: "active", scopes: { projects: "*", actions: ["read"] } })]);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Boomerang could not reach the agent");
  });
});

describe("Agents view approve dialog", () => {
  it("picking a project drops All projects, and picking All projects clears the specific ones", async () => {
    const approveCalls: unknown[] = [];
    vi.mocked(api).mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path === "/api/v1/agents") return [agent({})];
      if (path === "/api/v1/projects") {
        return [
          { id: "p1", key: "GRO", name: "Growth", createdAt: "" },
          { id: "p2", key: "PLA", name: "Platform", createdAt: "" },
        ];
      }
      if (method === "POST" && path === "/api/v1/agents/ag1/approve") {
        approveCalls.push(body);
        return agent({ status: "active" });
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Agents />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    const projectsButton = () => within(dialog).getByRole("button", { name: "Projects" });

    expect(projectsButton().textContent).toContain("All projects");

    // A multi Picker's popover stays open across selections, so both options are reachable
    // from the same click that opened it.
    fireEvent.click(projectsButton());
    fireEvent.click(await screen.findByRole("option", { name: "Growth" }));
    expect(projectsButton().textContent).not.toContain("All projects");
    expect(projectsButton().textContent).toContain("Growth");

    fireEvent.click(screen.getByRole("option", { name: "All projects" }));
    expect(projectsButton().textContent).toContain("All projects");
    expect(projectsButton().textContent).not.toContain("Growth");

    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveCalls).toHaveLength(1));
    expect(approveCalls[0]).toMatchObject({ scopes: { projects: "*" } });
  });

  it("Escape closes only the Projects picker's popover, not the whole dialog", async () => {
    vi.mocked(api).mockImplementation(async (_method: string, path: string) => {
      if (path === "/api/v1/agents") return [agent({})];
      if (path === "/api/v1/projects") return [{ id: "p1", key: "GRO", name: "Growth", createdAt: "" }];
      throw new Error(`unexpected ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Agents />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    const projectsButton = within(dialog).getByRole("button", { name: "Projects" });
    fireEvent.click(projectsButton);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(projectsButton, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
