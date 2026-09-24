// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStream } from "./hooks";
import { session } from "./session";
import { connectStream } from "./stream";

vi.mock("./stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stream")>();
  return { ...actual, connectStream: vi.fn() };
});

afterEach(() => {
  cleanup();
  session.clear();
  vi.mocked(connectStream).mockReset();
});

function Probe() {
  return <span data-testid="status">{useStream()}</span>;
}

/** Renders the hook and hands back the status callback the stream was opened with. */
function mountStream() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateAll = vi.spyOn(client, "invalidateQueries");
  let onStatus!: (s: "open" | "closed") => void;
  vi.mocked(connectStream).mockImplementation(async (opts) => {
    onStatus = opts.onStatus;
  });
  session.setSeed(new Uint8Array(32));
  const utils = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { ...utils, invalidateAll, status: () => onStatus };
}

describe("useStream", () => {
  it("does not refetch everything on the first open", () => {
    const { invalidateAll, status, getByTestId } = mountStream();
    act(() => status()("open"));
    expect(getByTestId("status").textContent).toBe("open");
    expect(invalidateAll).not.toHaveBeenCalled();
  });

  it("refetches everything when the stream reopens after a drop", () => {
    const { invalidateAll, status, getByTestId } = mountStream();
    act(() => status()("open"));
    act(() => status()("closed"));
    expect(getByTestId("status").textContent).toBe("closed");
    expect(invalidateAll).not.toHaveBeenCalled();

    act(() => status()("open"));
    expect(getByTestId("status").textContent).toBe("open");
    expect(invalidateAll).toHaveBeenCalledWith();

    // A later drop and reopen recovers again, rather than only the first time.
    invalidateAll.mockClear();
    act(() => status()("closed"));
    act(() => status()("open"));
    expect(invalidateAll).toHaveBeenCalledWith();
  });
});
