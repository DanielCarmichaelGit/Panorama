// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { useProjectMetrics, useStream, useTicketMetrics } from "./hooks";
import { session } from "./session";
import { connectStream } from "./stream";

vi.mock("./api", () => ({ api: vi.fn() }));
vi.mock("./stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./stream")>();
  return { ...actual, connectStream: vi.fn() };
});

afterEach(() => {
  cleanup();
  session.clear();
  vi.mocked(connectStream).mockReset();
  vi.mocked(api).mockReset();
});

function Probe() {
  return <span data-testid="status">{useStream()}</span>;
}

/** Renders the hook and hands back the status and event callbacks the stream was opened with. */
function mountStream() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateAll = vi.spyOn(client, "invalidateQueries");
  let onStatus!: (s: "open" | "closed") => void;
  let onEvent!: (e: { type: string; data: any }) => void;
  vi.mocked(connectStream).mockImplementation(async (opts) => {
    onStatus = opts.onStatus;
    onEvent = opts.onEvent;
  });
  session.setSeed(new Uint8Array(32));
  const utils = render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return { ...utils, invalidateAll, status: () => onStatus, event: () => onEvent };
}

const figures = { seconds: 0, openTimers: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, usd: 0, known: 0, unpriced: 0, entries: 0 };

function withClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("metrics hooks", () => {
  it("useTicketMetrics reads the ticket's metrics route", async () => {
    vi.mocked(api).mockResolvedValue({ ticketId: "t1", estimate: true, priceDate: "2026-09-24", ...figures, byModel: [], byActor: [], running: [] });
    function TicketProbe() {
      const m = useTicketMetrics("t1");
      return <span data-testid="out">{m.data ? m.data.priceDate : "loading"}</span>;
    }
    const { findByText } = withClient(<TicketProbe />);
    await findByText("2026-09-24");
    expect(api).toHaveBeenCalledWith("GET", "/api/v1/tickets/t1/metrics");
  });

  it("useProjectMetrics reads the rollup for the period and grouping, and stays idle without a project", async () => {
    vi.mocked(api).mockResolvedValue({ projectId: "p1", estimate: true, priceDate: "2026-09-24", period: { kind: "month", from: null, to: null }, groupBy: "agent", total: figures, groups: [] });
    function ProjectProbe({ projectId }: { projectId: string | undefined }) {
      const m = useProjectMetrics(projectId, "month", "agent");
      return <span data-testid="out">{m.data ? m.data.groupBy : m.fetchStatus}</span>;
    }
    const first = withClient(<ProjectProbe projectId={undefined} />);
    expect(first.getByTestId("out").textContent).toBe("idle");
    expect(api).not.toHaveBeenCalled();
    first.unmount();

    const { findByText } = withClient(<ProjectProbe projectId="p1" />);
    await findByText("agent");
    expect(api).toHaveBeenCalledWith("GET", "/api/v1/metrics?projectId=p1&period=month&groupBy=agent");
  });
});

describe("useStream metrics invalidation", () => {
  it("invalidates the ticket's and the project's metrics on timer.started, timer.stopped, and cost.added", () => {
    const { invalidateAll, status, event } = mountStream();
    act(() => status()("open"));
    for (const type of ["timer.started", "timer.stopped", "cost.added"]) {
      invalidateAll.mockClear();
      act(() => event()({ type, data: { ticketId: "t1", actorId: "a1", projectId: "p1" } }));
      expect(invalidateAll).toHaveBeenCalledWith({ queryKey: ["metrics", "ticket", "t1"] });
      expect(invalidateAll).toHaveBeenCalledWith({ queryKey: ["metrics", "project", "p1"] });
    }
  });
});

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
