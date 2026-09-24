// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  { id: "e1", projectId: "p1", name: "Growth", description: null, family: "stone" as const, position: 0, archived: false, createdAt: "" },
  { id: "e2", projectId: "p1", name: "Platform", description: null, family: "stone" as const, position: 1, archived: false, createdAt: "" },
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
