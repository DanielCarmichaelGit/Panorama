// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddEvidence } from "./AddEvidence";

afterEach(cleanup);

const evalScoreType = { id: "et_eval_score", name: "Eval score", kind: "eval_score", params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false, createdAt: "" } as any;
const testRunType = { id: "et_test_run", name: "Test run", kind: "test_run", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" } as any;

function renderDialog(types = [evalScoreType], onClose: () => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddEvidence ticketId="t1" types={types} onClose={onClose} />
    </QueryClientProvider>
  );
}

describe("AddEvidence", () => {
  it("disables Attach when the eval score field is cleared, rather than treating it as 0", () => {
    renderDialog();
    const attach = screen.getByRole("button", { name: "Attach" });
    const scoreInput = screen.getByLabelText("Score, 0 to 1");

    // The default score (1) makes a valid payload.
    expect((attach as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(scoreInput, { target: { value: "" } });
    expect((attach as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(scoreInput, { target: { value: "0.5" } });
    expect((attach as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables Attach when passed or failed is cleared on a test run", () => {
    renderDialog([testRunType]);
    const attach = screen.getByRole("button", { name: "Attach" });

    expect((attach as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Passed"), { target: { value: "" } });
    expect((attach as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Passed"), { target: { value: "3" } });
    expect((attach as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Failed"), { target: { value: "" } });
    expect((attach as HTMLButtonElement).disabled).toBe(true);
  });

  it("Escape closes only the Type picker's popover, not the whole dialog; a second Escape then cancels it", () => {
    const onClose = vi.fn();
    renderDialog([evalScoreType, testRunType], onClose);
    const typeTrigger = screen.getByRole("button", { name: "Type" });
    fireEvent.click(typeTrigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(typeTrigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(typeTrigger, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
