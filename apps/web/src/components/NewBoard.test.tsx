// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { NewBoard } from "./NewBoard";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { onClose, ...render(
    <QueryClientProvider client={client}>
      <NewBoard projectId="p1" onClose={onClose} />
    </QueryClientProvider>,
  ) };
}

describe("NewBoard", () => {
  it("disables Create while the name is empty", () => {
    renderDialog();
    const create = screen.getByRole("button", { name: "Create" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Growth" } });
    expect((create as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits {projectId, name, family} and calls onClose with the new board", async () => {
    const board = { id: "b2", projectId: "p1", name: "Growth", description: null, family: "sky", position: 1, createdAt: "2026-09-24T00:00:00.000Z" };
    vi.mocked(api).mockResolvedValue(board);
    const { onClose } = renderDialog();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Growth" } });
    fireEvent.click(screen.getByLabelText("Sky"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(board));
    expect(api).toHaveBeenCalledWith("POST", "/api/v1/boards", { projectId: "p1", name: "Growth", description: undefined, family: "sky" });
  });
});
