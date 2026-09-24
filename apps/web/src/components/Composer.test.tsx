// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { Composer, composerMarkdown } from "./Composer";

// TipTap's ProseMirror view measures text layout on mount (for cursor placement, input rule
// matching, etc.), which jsdom does not implement. Without these two polyfills, mounting the
// editor throws inside ProseMirror's own view code before any of our code runs.
(Range.prototype as any).getClientRects = () => ({ length: 0, item: () => null });
(Range.prototype as any).getBoundingClientRect = () => ({
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {},
});

vi.mock("../lib/api", () => ({ api: vi.fn() }));

afterEach(cleanup);

function renderComposer(onPosted: () => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Composer ticketId="t1" onPosted={onPosted} />
    </QueryClientProvider>,
  );
}

function editor(): any {
  return (window as any).__panEditor;
}

describe("Composer", () => {
  it("converts markdown shorthand as you type", async () => {
    renderComposer();
    await screen.findByTestId("composer");
    const ed = editor();
    expect(ed).toBeTruthy();

    ed.view.someProp("handleTextInput", (f: any) => f(ed.view, 1, 1, "# "));
    ed.commands.insertContent("Title");
    ed.commands.enter();
    const pos = ed.state.selection.from;
    ed.view.someProp("handleTextInput", (f: any) => f(ed.view, pos, pos, "- "));
    ed.commands.insertContent("item");

    expect(composerMarkdown(ed)).toBe("# Title\n\n- item");
  });

  it("posts on Ctrl+Enter and clears the editor", async () => {
    vi.mocked(api).mockResolvedValue({ id: "c1", ticketId: "t1", actorId: "a1", body: "x", attachmentIds: [], createdAt: "2026-09-24T00:00:00.000Z" });
    const onPosted = vi.fn();
    renderComposer(onPosted);
    const composer = await screen.findByTestId("composer");
    const ed = editor();
    ed.commands.setContent("<p>x</p>");

    fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/v1/comments", { ticketId: "t1", body: "x", attachmentIds: undefined }));
    await waitFor(() => expect(onPosted).toHaveBeenCalled());
    await waitFor(() => expect(ed.isEmpty).toBe(true));
  });
});
