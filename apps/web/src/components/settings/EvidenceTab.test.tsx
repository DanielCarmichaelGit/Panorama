// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../lib/api";
import { EvidenceTab } from "./EvidenceTab";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(cleanup);

type Call = { method: string; path: string; body?: unknown };

const types = [
  { id: "et_eval_score", name: "Eval score", kind: "eval_score" as const, params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false, createdAt: "" },
  { id: "et_human_signoff", name: "Human sign-off", kind: "human_signoff" as const, params: {}, humanOnly: true, needsAttachment: false, createdAt: "" },
  { id: "et_lint", name: "Lint", kind: "custom" as const, params: {}, humanOnly: false, needsAttachment: true, createdAt: "" },
];

const lanes = [
  { id: "l1", projectId: "p1", name: "Backlog", position: 0, family: "stone" as const, setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
  { id: "l2", projectId: "p1", name: "Review", position: 1, family: "lilac" as const, setsNeedsHuman: true, isDone: false, evidenceRequirements: [{ typeId: "et_eval_score", count: 1 }] },
  { id: "l3", projectId: "p1", name: "Done", position: 2, family: "mint" as const, setsNeedsHuman: false, isDone: true, evidenceRequirements: [{ typeId: "et_eval_score", count: 2 }, { typeId: "et_human_signoff", count: 1 }] },
];

function mockApi(onWrite: (c: Call) => Promise<unknown> = () => Promise.resolve({ ok: true })) {
  const calls: Call[] = [];
  vi.mocked(api).mockImplementation((method: string, path: string, body?: unknown) => {
    if (method === "GET") {
      if (path.endsWith("/lanes")) return Promise.resolve(lanes);
      if (path.endsWith("/evidence-types")) return Promise.resolve(types);
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
      <EvidenceTab projectId="p1" />
    </QueryClientProvider>,
  );
}

function row(name: string): ReturnType<typeof within> {
  const item = screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: ".row-name" }));
  if (!item) throw new Error(`No row named ${name}`);
  return within(item);
}

describe("EvidenceTab", () => {
  it("lists the types with kind, flags, and the lanes of this project that use them", async () => {
    mockApi();
    renderTab();
    await screen.findByText("Eval score", { selector: ".row-name" });
    expect(row("Eval score").getByText("eval_score")).toBeTruthy();
    expect(row("Eval score").getByText("Required by Review, Done")).toBeTruthy();
    expect(row("Human sign-off").getByText("Human only")).toBeTruthy();
    expect(row("Human sign-off").getByText("Required by Done")).toBeTruthy();
    expect(row("Lint").getByText("Needs attachment")).toBeTruthy();
    expect(row("Lint").queryByText(/Required by/)).toBeNull();
  });

  it("adds an eval_score type with its threshold", async () => {
    const calls = mockApi((c) => Promise.resolve({ ...types[0], id: "et_rubric", name: "Rubric", ...(c.body as object) }));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add evidence type" }));
    expect(screen.queryByLabelText("Threshold")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rubric" } });
    fireEvent.click(screen.getByLabelText("Kind"));
    fireEvent.click(screen.getByRole("option", { name: "Eval score" }));
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "0.8" } });
    fireEvent.click(screen.getByLabelText("Human only"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/api/v1/evidence-types");
    expect(post?.body).toEqual({ name: "Rubric", kind: "eval_score", params: { threshold: 0.8 }, humanOnly: true, needsAttachment: false });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("adds a type of another kind without params", async () => {
    const calls = mockApi((c) => Promise.resolve({ ...types[2], id: "et_scan", name: "Scan", ...(c.body as object) }));
    renderTab();

    fireEvent.click(await screen.findByRole("button", { name: "Add evidence type" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Scan" } });
    fireEvent.click(screen.getByLabelText("Kind"));
    fireEvent.click(screen.getByRole("option", { name: "Screenshot" }));
    fireEvent.click(screen.getByLabelText("Needs attachment"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const body = calls.find((c) => c.method === "POST")?.body as Record<string, unknown>;
    expect(body).toEqual({ name: "Scan", kind: "screenshot", humanOnly: false, needsAttachment: true });
    expect("params" in body).toBe(false);
  });

  it("disables Delete with the reason when a lane of this project requires the type", async () => {
    mockApi();
    renderTab();

    await screen.findByText("Eval score", { selector: ".row-name" });
    const del = row("Eval score").getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe("Remove it from Review, Done first");
    expect((row("Lint").getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the server's message when a delete is refused", async () => {
    mockApi(() => Promise.reject(new ApiError(409, "evidence_type_in_use", "It is recorded on 3 evidence rows")));
    renderTab();

    await screen.findByText("Lint", { selector: ".row-name" });
    fireEvent.click(row("Lint").getByRole("button", { name: "Delete" }));
    expect(row("Lint").getByText("Delete Lint?")).toBeTruthy();
    fireEvent.click(row("Lint").getByRole("button", { name: "Delete", exact: true }));

    expect((await screen.findByRole("alert")).textContent).toBe("It is recorded on 3 evidence rows");
  });

  it("deletes an unused type and drops the row", async () => {
    const calls = mockApi();
    renderTab();

    await screen.findByText("Lint", { selector: ".row-name" });
    fireEvent.click(row("Lint").getByRole("button", { name: "Delete" }));
    fireEvent.click(row("Lint").getByRole("button", { name: "Delete", exact: true }));

    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe("/api/v1/evidence-types/et_lint");
  });
});
