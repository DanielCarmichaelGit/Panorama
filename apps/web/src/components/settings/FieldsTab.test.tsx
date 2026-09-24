// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/api";
import { FieldsTab, suggestKey } from "./FieldsTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

function renderTab(setupApi: () => void = () => vi.mocked(api).mockResolvedValue([])) {
  setupApi();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FieldsTab projectId="p1" />
    </QueryClientProvider>,
  );
}

describe("suggestKey", () => {
  it("lowercases a name into underscores and strips symbols", () => {
    expect(suggestKey("Story points")).toBe("story_points");
    expect(suggestKey("Story points!")).toBe("story_points");
    expect(suggestKey("  Sprint #  ")).toBe("sprint");
  });
});

describe("FieldsTab", () => {
  it("disables Create while the name or key is empty", async () => {
    renderTab();
    const create = await screen.findByRole("button", { name: "Create field" });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Story points" } });
    expect((create as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "" } });
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the options editor only when the kind is select", async () => {
    renderTab();
    await screen.findByRole("button", { name: "Create field" });
    expect(screen.queryByText("Options")).toBeNull();

    fireEvent.click(screen.getByLabelText("Kind"));
    fireEvent.click(screen.getByRole("option", { name: "Select" }));
    expect(screen.getByText("Options")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Kind"));
    fireEvent.click(screen.getByRole("option", { name: "Text" }));
    expect(screen.queryByText("Options")).toBeNull();
  });

  it("shows an alert when archiving a field fails", async () => {
    const field = {
      id: "f1",
      projectId: "p1",
      name: "Story points",
      key: "story_points",
      kind: "number" as const,
      options: [],
      required: false,
      position: 0,
      archived: false,
      createdAt: "",
    };
    renderTab(() =>
      vi.mocked(api).mockImplementation((method: string, path: string) => {
        if (method === "GET") return Promise.resolve([field]);
        if (path.endsWith("/archive")) return Promise.reject(new Error("Server refused the archive."));
        return Promise.resolve(field);
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Server refused the archive.");
  });
});
