// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("TagsTab", () => {
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
