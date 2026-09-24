// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceType, Lane } from "@panorama/core";
import { api } from "../lib/api";
import { LaneRequirements } from "./LaneRequirements";

vi.mock("../lib/api", () => ({ api: vi.fn() }));

afterEach(cleanup);

const types: EvidenceType[] = [
  { id: "et_test_run", name: "Test run", kind: "test_run", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" },
  { id: "et_eval_score", name: "Eval score", kind: "eval_score", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" },
];

const lane: Lane = {
  id: "l1", projectId: "p1", name: "Ready", position: 1, family: "stone", setsNeedsHuman: false, isDone: false,
  evidenceRequirements: [{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }],
};

function renderDialog() {
  vi.mocked(api).mockResolvedValue(lane as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LaneRequirements lane={lane} types={types} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("LaneRequirements", () => {
  it("merges two rows of the same evidence type into one, keeping the larger count", async () => {
    renderDialog();
    // Point the second row at the type the first row already uses.
    fireEvent.change(screen.getByLabelText("Evidence type", { selector: "#req-type-1" }), { target: { value: "et_test_run" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("PUT", "/api/v1/lanes/l1/requirements", {
      requirements: [{ typeId: "et_test_run", count: 3 }],
    }));
  });

  it("sends distinct rows through untouched", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("PUT", "/api/v1/lanes/l1/requirements", {
      requirements: [{ typeId: "et_test_run", count: 1 }, { typeId: "et_eval_score", count: 3 }],
    }));
  });
});
