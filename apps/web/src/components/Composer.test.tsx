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

/**
 * Types into the editor the way a browser does: a keydown per character, the character landing
 * in the contenteditable's DOM, and an input event. ProseMirror's DOM observer notices the
 * mutation and turns it into a transaction. Deliberately does not go through editor.commands,
 * which would not reproduce a transaction that originates in the view.
 */
async function typeIntoEditor(text: string) {
  const pm = document.querySelector(".ProseMirror") as HTMLElement;
  pm.focus();
  for (const ch of text) {
    fireEvent.keyDown(pm, { key: ch });
    const p = pm.querySelector("p")!;
    const last = p.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) last.textContent += ch;
    else p.insertBefore(document.createTextNode(ch), p.querySelector("br"));
    fireEvent.input(pm, { inputType: "insertText", data: ch });
    fireEvent.keyUp(pm, { key: ch });
    await Promise.resolve();
  }
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

  it("enables the Comment button once text has been typed", async () => {
    renderComposer();
    await screen.findByTestId("composer");
    const button = screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await typeIntoEditor("hi");

    await waitFor(() => expect(composerMarkdown(editor())).toBe("hi"));
    // Nothing else re-renders the composer here; the button must track the editor on its own.
    await waitFor(() => expect(button.disabled).toBe(false));
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
