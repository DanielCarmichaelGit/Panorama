// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { session } from "../lib/session";
import { App } from "../App";
import { Shell } from "./Shell";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});
// The live stream is not under test; keep it from opening a connection.
vi.mock("../lib/stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/stream")>();
  return { ...actual, connectStream: vi.fn(() => new Promise<void>(() => {})) };
});

afterEach(() => {
  cleanup();
  session.clear();
});

const project = { id: "p1", key: "PAN", name: "Boomerang", createdAt: "" };
const lanes = [{ id: "l1", projectId: "p1", name: "Backlog", position: 1, family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [] }];

function mockApi() {
  vi.mocked(api).mockImplementation(async (_method: string, path: string) => {
    if (path === "/api/v1/status") return { state: "unlocked", encryption: false };
    if (path === "/api/v1/projects") return [project];
    if (path === "/api/v1/projects/p1/lanes") return lanes;
    return [];
  });
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("Shell", () => {
  it("has an Automations item in the sidebar after Board", async () => {
    mockApi();
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<Shell status={{ state: "unlocked" }} chainOk={true} />}>
              <Route path="/" element={<div>Queue view</div>} />
              <Route path="/automations" element={<div>Automations view</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const item = await screen.findByRole("link", { name: "Automations" });
    expect(item.getAttribute("href")).toBe("/automations");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const names = Array.from(nav.querySelectorAll("a.nav-item")).map((a) => a.getAttribute("aria-label"));
    expect(names.indexOf("Automations")).toBe(names.indexOf("Board") + 1);
  });

  it("g then m navigates to the Automations view", async () => {
    mockApi();
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<Shell status={{ state: "unlocked" }} chainOk={true} />}>
              <Route path="/" element={<div>Queue view</div>} />
              <Route path="/automations" element={<div>Automations view</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Queue view");
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "m" });
    expect(await screen.findByText("Automations view")).toBeTruthy();
  });

  it("the metrics links carry the period, and g b keeps it", async () => {
    mockApi();
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={["/?period=month"]}>
          <Routes>
            <Route element={<Shell status={{ state: "unlocked" }} chainOk={true} />}>
              <Route path="/" element={<div>Queue view</div>} />
              <Route path="/board" element={<div>Board view</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Queue view");
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("href")).toBe("/board?period=month");
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents?period=month");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    fireEvent.keyDown(document, { key: "g" });
    fireEvent.keyDown(document, { key: "b" });
    await screen.findByText("Board view");
    expect(screen.getByRole("link", { name: "Queue" }).getAttribute("href")).toBe("/?period=month");
  });

  it("the app routes /automations to the Automations view", async () => {
    mockApi();
    session.setSeed(new Uint8Array(32));
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={["/automations"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Automations" })).toBeTruthy();
  });
});
