// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CHAIN_BROKEN, CHAIN_OK, STREAM_OFF, STREAM_ON, SidebarStatus } from "./SidebarStatus";

afterEach(cleanup);

describe("SidebarStatus", () => {
  it("says the history is intact and live updates are connected, each with its explanation", () => {
    render(<SidebarStatus chainOk connected />);
    expect(screen.getByText("History intact")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    const chain = screen.getByRole("group", { name: CHAIN_OK });
    expect(chain.title).toBe(CHAIN_OK);
    expect(chain.querySelector(".side-status-ok")).toBeTruthy();
    const stream = screen.getByRole("group", { name: STREAM_ON });
    expect(stream.title).toBe(STREAM_ON);
    expect(stream.querySelector(".side-status-dot.on")).toBeTruthy();
  });

  it("warns when the history was altered and says it is reconnecting when the stream is down", () => {
    render(<SidebarStatus chainOk={false} connected={false} />);
    expect(screen.getByText("History altered")).toBeTruthy();
    expect(screen.getByText("Reconnecting")).toBeTruthy();
    const chain = screen.getByRole("group", { name: CHAIN_BROKEN });
    expect(chain.querySelector(".side-status-bad")).toBeTruthy();
    expect(chain.querySelector(".side-status-ok")).toBeNull();
    const stream = screen.getByRole("group", { name: STREAM_OFF });
    expect(stream.querySelector(".side-status-dot.on")).toBeNull();
    expect(stream.querySelector(".side-status-dot")).toBeTruthy();
  });
});
