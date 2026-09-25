// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldDefinition } from "@boomerang/core";
import { api } from "../lib/api";
import { uploadFile } from "../lib/attachments";
import { FieldControl, isFieldEmpty } from "./FieldControl";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

vi.mock("../lib/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/attachments")>();
  return { ...actual, uploadFile: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.mocked(uploadFile).mockReset();
  vi.mocked(api).mockReset();
});

const fileDef: FieldDefinition = { id: "f1", projectId: "p1", name: "Spec", key: "spec", kind: "file", options: [], required: true, position: 0, archived: false, createdAt: "" };

function renderControl(props: Partial<React.ComponentProps<typeof FieldControl>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <FieldControl id="fc-spec" def={fileDef} value={null} onChange={onChange} onCommit={onCommit} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onChange, onCommit };
}

describe("FieldControl file kind", () => {
  it("counts an empty file field as missing", () => {
    expect(isFieldEmpty(fileDef, null)).toBe(true);
    expect(isFieldEmpty(fileDef, { attachmentId: "att1" })).toBe(false);
  });

  it("uploads the chosen file to the ticket and commits its attachment id", async () => {
    vi.mocked(uploadFile).mockResolvedValue({ id: "att1", ticketId: "t1", commentId: null, actorId: "human", filename: "spec.pdf", mime: "application/pdf", size: 3, sha256: "", createdAt: "" });
    const { onChange, onCommit } = renderControl({ ticketId: "t1" });

    expect(screen.getByRole("button", { name: "Choose file" })).toBeTruthy();
    const file = new File(["abc"], "spec.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Spec"), { target: { files: [file] } });
    });

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ attachmentId: "att1" }));
    expect(vi.mocked(uploadFile).mock.calls[0][0]).toBe("t1");
    expect(vi.mocked(uploadFile).mock.calls[0][1]).toBe(file);
    expect(onChange).toHaveBeenCalledWith({ attachmentId: "att1" });
  });

  it("shows the upload error in place and commits nothing", async () => {
    vi.mocked(uploadFile).mockRejectedValue(new Error("Attachments of type text/x-thing are not accepted"));
    const { onCommit } = renderControl({ ticketId: "t1" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Spec"), { target: { files: [new File(["x"], "a.thing")] } });
    });
    expect((await screen.findByRole("alert")).textContent).toBe("Attachments of type text/x-thing are not accepted");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows the attachment's filename as a link when set, and Remove commits null", async () => {
    vi.mocked(api).mockResolvedValue({ id: "att1", ticketId: "t1", filename: "spec.pdf", mime: "application/pdf", size: 3, isImage: false });
    const { onCommit } = renderControl({ ticketId: "t1", value: { attachmentId: "att1" } });

    const link = await screen.findByRole("link", { name: "spec.pdf" });
    expect(link.getAttribute("href")).toBe("/api/v1/attachments/att1");
    expect(vi.mocked(api)).toHaveBeenCalledWith("GET", "/api/v1/attachments/att1/meta");
    expect(screen.queryByRole("button", { name: "Choose file" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("shows an image attachment as a thumbnail", async () => {
    vi.mocked(api).mockResolvedValue({ id: "att2", ticketId: "t1", filename: "shot.png", mime: "image/png", size: 3, isImage: true });
    const { container } = renderControl({ ticketId: "t1", value: { attachmentId: "att2" } });
    await waitFor(() => expect(container.querySelector(".file-thumb")).toBeTruthy());
    expect(screen.getByRole("link", { name: "shot.png" })).toBeTruthy();
  });

  it("keeps the file locally when there is no ticket yet, and Remove clears it", async () => {
    const onPickFile = vi.fn();
    const { onCommit } = renderControl({ onPickFile });
    const file = new File(["abc"], "spec.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Spec"), { target: { files: [file] } });
    });
    expect(onPickFile).toHaveBeenCalledWith(file);
    expect(vi.mocked(uploadFile)).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    cleanup();

    renderControl({ onPickFile, pendingFile: file });
    expect(screen.getByText("spec.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onPickFile).toHaveBeenCalledWith(null);
  });
});
