// @vitest-environment jsdom
import { cleanup, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidAttachmentId, useAttachmentUrl } from "./attachments";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ id }: { id: string }) {
  const { url, error } = useAttachmentUrl(id);
  return <div data-testid="probe">{error ? "error" : url ?? "loading"}</div>;
}

describe("useAttachmentUrl", () => {
  it("shares one object URL across concurrent consumers of the same id and only frees it on cache eviction, not on either consumer's unmount", async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls++;
        return { ok: true, status: 200, blob: async () => new Blob(["x"]) } as unknown as Response;
      }),
    );
    let nextUrl = 0;
    const createObjectURL = vi.fn(() => `blob:mock-${nextUrl++}`);
    const revokeObjectURL = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      // Two independent React trees, deliberately not sharing a component tree, standing in for
      // two places in the app rendering the same attachment (e.g. the same image twice in one
      // comment thread). They share nothing except the QueryClient, which is exactly what makes
      // react-query treat them as two observers of one cached query.
      const first = render(
        <QueryClientProvider client={qc}>
          <Probe id="abc123" />
        </QueryClientProvider>,
      );
      const second = render(
        <QueryClientProvider client={qc}>
          <Probe id="abc123" />
        </QueryClientProvider>,
      );

      await waitFor(() => expect(within(first.container).getByTestId("probe").textContent).not.toBe("loading"));

      expect(fetchCalls).toBe(1); // one blob fetch, not one per consumer
      expect(createObjectURL).toHaveBeenCalledTimes(1); // one object URL, shared
      const sharedUrl = createObjectURL.mock.results[0]!.value as string;
      expect(within(first.container).getByTestId("probe").textContent).toBe(sharedUrl);
      expect(within(second.container).getByTestId("probe").textContent).toBe(sharedUrl);

      // Unmounting the first consumer must not revoke the URL the second one is still showing.
      first.unmount();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      expect(within(second.container).getByTestId("probe").textContent).toBe(sharedUrl);

      // Once the last observer is gone, simulate the cache actually evicting the entry (what
      // gcTime does after ten idle minutes) rather than waiting ten minutes in a test.
      second.unmount();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      qc.removeQueries({ queryKey: ["attachment-url", "abc123"] });
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith(sharedUrl);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});

describe("isValidAttachmentId", () => {
  it("accepts the server's id shape and rejects anything path- or query-like", () => {
    expect(isValidAttachmentId("a1b2c3-d4")).toBe(true);
    expect(isValidAttachmentId("../secret")).toBe(false);
    expect(isValidAttachmentId("abc?x=1")).toBe(false);
    expect(isValidAttachmentId("")).toBe(false);
    expect(isValidAttachmentId(null)).toBe(false);
  });
});
