// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Family } from "@panorama/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorField } from "./ColorField";
import type { ColorValue } from "./ColorField";

afterEach(cleanup);

function Harness(props: { initial?: ColorValue; onChange?: (next: ColorValue) => void; presets?: boolean; custom?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState<ColorValue>(props.initial ?? { family: "coral", color: null });
  return (
    <ColorField
      id="epic-colour"
      label="Colour"
      family={value.family}
      color={value.color}
      presets={props.presets}
      custom={props.custom}
      disabled={props.disabled}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

const FAMILY_NAMES: Record<Family, string> = { coral: "Coral", sky: "Sky", lilac: "Lilac", mint: "Mint", stone: "Stone" };

describe("ColorField", () => {
  it("renders a fieldset with the label as its legend and every swatch in order", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "Colour" })).toBeTruthy();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names).toEqual([
      "Coral",
      "Sky",
      "Lilac",
      "Mint",
      "Stone",
      "#f6c1b4",
      "#f7d9a8",
      "#f2e8a6",
      "#bfe8cf",
      "#b9ddf5",
      "#d3c8f4",
      "#f2c4e0",
      "Custom colour",
    ]);
  });

  it("hides the presets when asked, keeping the families and Custom", () => {
    render(<Harness presets={false} />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Coral", "Sky", "Lilac", "Mint", "Stone", "Custom colour"]);
  });

  it("offers only the families when custom is off, for family-only things like lanes", () => {
    render(<Harness presets={false} custom={false} />);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Coral", "Sky", "Lilac", "Mint", "Stone"]);
    expect(screen.queryByLabelText("Hex")).toBeNull();
  });

  it("marks the family swatch pressed when there is no colour, and nothing else", () => {
    render(<Harness initial={{ family: "lilac", color: null }} />);
    for (const family of Object.keys(FAMILY_NAMES) as Family[]) {
      expect(screen.getByRole("button", { name: FAMILY_NAMES[family] }).getAttribute("aria-pressed")).toBe(family === "lilac" ? "true" : "false");
    }
    expect(screen.getByRole("button", { name: "#f6c1b4" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Custom colour" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the matching preset pressed when the colour is a preset, and the family not", () => {
    render(<Harness initial={{ family: "lilac", color: "#f7d9a8" }} />);
    expect(screen.getByRole("button", { name: "#f7d9a8" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Lilac" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Custom colour" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Custom pressed for a colour that is not a preset, and shows the hex inputs", () => {
    render(<Harness initial={{ family: "sky", color: "#123456" }} />);
    expect(screen.getByRole("button", { name: "Custom colour" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Sky" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByLabelText("Hex") as HTMLInputElement).value).toBe("#123456");
    expect((screen.getByLabelText("Pick a colour") as HTMLInputElement).value).toBe("#123456");
  });

  it("emits the family with a cleared colour when a family swatch is clicked", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ family: "coral", color: "#f6c1b4" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Sky" }));
    expect(onChange).toHaveBeenCalledWith({ family: "sky", color: null });
    expect(screen.getByRole("button", { name: "Sky" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "#f6c1b4" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("emits the preset colour and leaves the family alone when a preset is clicked", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ family: "mint", color: null }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "#bfe8cf" }));
    expect(onChange).toHaveBeenCalledWith({ family: "mint", color: "#bfe8cf" });
    expect(screen.getByRole("button", { name: "#bfe8cf" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Mint" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reveals the custom inputs on Custom and emits a typed valid hex", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ family: "coral", color: null }} onChange={onChange} />);
    expect(screen.queryByLabelText("Hex")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    const hex = screen.getByLabelText("Hex") as HTMLInputElement;
    expect(document.activeElement).toBe(hex);
    expect(hex.getAttribute("maxlength")).toBe("7");
    fireEvent.change(hex, { target: { value: "#12706A" } });
    expect(onChange).toHaveBeenCalledWith({ family: "coral", color: "#12706a" });
    expect(screen.getByRole("button", { name: "Custom colour" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("rejects a short hex with an error on Enter or blur and does not emit", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ family: "coral", color: null }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    const hex = screen.getByLabelText("Hex") as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "#12" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(hex, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("A colour is six hex digits, like #f6c1b4");
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(hex, { target: { value: "#12706a" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ family: "coral", color: "#12706a" });
    fireEvent.change(hex, { target: { value: "#zz" } });
    fireEvent.blur(hex);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("emits the native colour input's value", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ family: "stone", color: null }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom colour" }));
    fireEvent.change(screen.getByLabelText("Pick a colour"), { target: { value: "#0e5a43" } });
    expect(onChange).toHaveBeenCalledWith({ family: "stone", color: "#0e5a43" });
    expect((screen.getByLabelText("Hex") as HTMLInputElement).value).toBe("#0e5a43");
  });

  it("moves focus between swatches with the arrow keys and selects with Enter or Space", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ family: "coral", color: null }} onChange={onChange} />);
    const coral = screen.getByRole("button", { name: "Coral" });
    const sky = screen.getByRole("button", { name: "Sky" });
    const custom = screen.getByRole("button", { name: "Custom colour" });
    // Roving tabindex: only the pressed swatch is in the tab order.
    expect(coral.getAttribute("tabindex")).toBe("0");
    expect(sky.getAttribute("tabindex")).toBe("-1");
    coral.focus();
    fireEvent.keyDown(coral, { key: "ArrowRight" });
    expect(document.activeElement).toBe(sky);
    expect(sky.getAttribute("tabindex")).toBe("0");
    expect(coral.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(sky, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ family: "sky", color: null });
    fireEvent.keyDown(sky, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(coral);
    fireEvent.keyDown(coral, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(custom);
    fireEvent.keyDown(custom, { key: "End" });
    expect(document.activeElement).toBe(custom);
    fireEvent.keyDown(custom, { key: "Home" });
    expect(document.activeElement).toBe(coral);
    fireEvent.keyDown(coral, { key: " " });
    expect(onChange).toHaveBeenLastCalledWith({ family: "coral", color: null });
  });

  it("disables every swatch and emits nothing when disabled", () => {
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    const sky = screen.getByRole("button", { name: "Sky" }) as HTMLButtonElement;
    expect(sky.disabled).toBe(true);
    fireEvent.click(sky);
    expect(onChange).not.toHaveBeenCalled();
  });
});
