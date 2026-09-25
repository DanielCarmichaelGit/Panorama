// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { INTRO_KEY, Settings } from "./Settings";

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: vi.fn() };
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(INTRO_KEY);
});

const project = { id: "p1", key: "PAN", name: "Panorama", createdAt: "" };

function renderSettings(path = "/settings") {
  vi.mocked(api).mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Outlet context={{ project, lanes: [] }} />}>
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Settings", () => {
  it("explains the five concepts above the tabs", () => {
    renderSettings();
    for (const name of ["Lanes", "Evidence types", "Arcs", "Tags", "Fields"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${name} `) })).toBeTruthy();
    }
    expect(screen.getByText(/A ticket is always in exactly one lane/)).toBeTruthy();
    expect(screen.getByText(/That is the gate/)).toBeTruthy();
  });

  it("selects a tab when its concept is clicked", () => {
    renderSettings();
    expect(screen.getByRole("tab", { name: "Fields" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Lanes / }));
    expect(screen.getByRole("tab", { name: "Lanes" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Fields" }).getAttribute("aria-selected")).toBe("false");
  });

  it("hides the strip on request and remembers that", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByText(/That is the gate/)).toBeNull();
    expect(localStorage.getItem(INTRO_KEY)).toBe("hidden");
    cleanup();

    renderSettings();
    expect(screen.queryByText(/That is the gate/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText(/That is the gate/)).toBeTruthy();
  });

  it("opens the tab named in the URL", () => {
    renderSettings("/settings?tab=evidence");
    expect(screen.getByRole("tab", { name: "Evidence types" }).getAttribute("aria-selected")).toBe("true");
  });
});
