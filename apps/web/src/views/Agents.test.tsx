// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    throw new Error("Panorama could not reach the agent");
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
    expect((await screen.findByRole("alert")).textContent).toContain("Panorama could not reach the agent");
  });

  it("reports a failed revoke beside the row", async () => {
    renderAgents([agent({ id: "ag2", name: "runner", status: "active", scopes: { projects: "*", actions: ["read"] } })]);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Panorama could not reach the agent");
  });
});
