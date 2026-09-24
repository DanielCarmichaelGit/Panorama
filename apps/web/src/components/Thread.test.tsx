// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { Thread } from "./Thread";

vi.mock("../lib/api", () => ({ api: vi.fn() }));

afterEach(cleanup);

function renderThread() {
  vi.mocked(api).mockImplementation((async (method: string, path: string) => {
    if (method === "GET" && path === "/api/v1/evidence-types") return [];
    if (method === "GET" && path === "/api/v1/tickets/t1/thread") return { comments: [], attachments: [], evidence: [], actors: [] };
    throw new Error(`unexpected ${method} ${path}`);
  }) as any);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Thread ticketId="t1" />
    </QueryClientProvider>,
  );
}

describe("Thread", () => {
  it("keeps the empty state inside the thread container, like every other state", async () => {
    const { container } = renderThread();
    const empty = await screen.findByText("No comments yet.");
    expect(empty.closest(".thread")).not.toBeNull();
    expect(container.querySelectorAll(".thread")).toHaveLength(1);
  });
});
