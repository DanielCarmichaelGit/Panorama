// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Project } from "@boomerang/core";
import { avatarFamily, ProjectSwitcher } from "./ProjectSwitcher";

const a: Project = { id: "p1", key: "FIRETOWER", name: "firetower", createdAt: "2026-09-24T00:00:00.000Z" };
const b: Project = { id: "p2", key: "BEACON", name: "Beacon", createdAt: "2026-09-24T00:00:00.000Z" };

describe("ProjectSwitcher", () => {
  afterEach(cleanup);
  it("shows the avatar initial, name and key for a single project without a menu", () => {
    render(<ProjectSwitcher id="ps" list={[a]} current={a} onChange={() => {}} />);
    expect(screen.getByText("F")).toBeTruthy();
    expect(screen.getByText("firetower")).toBeTruthy();
    expect(screen.getByText("FIRETOWER")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens a listbox and switches with the keyboard when there are several projects", () => {
    const onChange = vi.fn();
    render(<ProjectSwitcher id="ps" list={[a, b]} current={a} onChange={onChange} />);
    const btn = screen.getByRole("button", { name: /switch project/i });
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(document.activeElement).toBe(btn);
    fireEvent.keyDown(btn, { key: "ArrowDown" });
    expect(btn.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: /Beacon/ }).id);
    expect(screen.getByRole("listbox").hasAttribute("aria-activedescendant")).toBe(false);
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("p2");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without changing", () => {
    const onChange = vi.fn();
    render(<ProjectSwitcher id="ps" list={[a, b]} current={a} onChange={onChange} />);
    const btn = screen.getByRole("button", { name: /switch project/i });
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("compact shows only the avatar with the name as a title", () => {
    render(<ProjectSwitcher id="ps" list={[a]} current={a} onChange={() => {}} compact />);
    expect(screen.getByTitle("firetower (FIRETOWER)")).toBeTruthy();
    expect(screen.queryByText("FIRETOWER")).toBeNull();
  });

  it("gives a project a stable avatar family", () => {
    expect(avatarFamily("FIRETOWER")).toBe(avatarFamily("FIRETOWER"));
    expect(["coral", "sky", "lilac", "mint"]).toContain(avatarFamily("BEACON"));
  });
});
