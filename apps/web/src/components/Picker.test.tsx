// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickerOption, PickerProps } from "./Picker";
import { Picker } from "./Picker";

afterEach(cleanup);

const BOARD_OPTIONS: PickerOption[] = [
  { id: "b1", label: "Growth" },
  { id: "b2", label: "Platform" },
  { id: "b3", label: "Research" },
];

function SingleHarness(props: {
  options: PickerOption[];
  onSelect?: (id: string | null) => void;
  searchable?: boolean;
  clearable?: boolean;
  onCreate?: PickerProps["onCreate"];
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(props.initial ?? null);
  return (
    <Picker
      id="board-picker"
      label="Board"
      options={props.options}
      value={value}
      onChange={(v) => {
        setValue(v);
        props.onSelect?.(v);
      }}
      searchable={props.searchable}
      clearable={props.clearable}
      onCreate={props.onCreate}
    />
  );
}

function MultiHarness(props: { options: PickerOption[]; onSelect?: (ids: string[]) => void }) {
  const [values, setValues] = useState<string[]>([]);
  return (
    <Picker
      id="tag-picker"
      label="Tags"
      options={props.options}
      multi
      values={values}
      onChange={(ids) => {
        setValues(ids);
        props.onSelect?.(ids);
      }}
    />
  );
}

describe("Picker", () => {
  it("opens the listbox on trigger click", () => {
    render(<SingleHarness options={BOARD_OPTIONS} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("opens the listbox on ArrowDown", () => {
    render(<SingleHarness options={BOARD_OPTIONS} />);
    const trigger = screen.getByRole("button", { name: "Board" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("ArrowDown twice then Enter selects the second option and closes", () => {
    const onSelect = vi.fn();
    render(<SingleHarness options={BOARD_OPTIONS} onSelect={onSelect} />);
    const trigger = screen.getByRole("button", { name: "Board" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("b2");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape returns focus to the trigger", () => {
    render(<SingleHarness options={BOARD_OPTIONS} />);
    const trigger = screen.getByRole("button", { name: "Board" });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("search filters and Enter picks the first match", () => {
    const onSelect = vi.fn();
    render(<SingleHarness options={BOARD_OPTIONS} onSelect={onSelect} searchable />);
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    const search = screen.getByRole("textbox");
    fireEvent.change(search, { target: { value: "r" } });
    // "Research" and "Growth" both contain "r"; "Research" comes first in option order after "Growth"... use a
    // query that narrows to a single leading match instead of relying on option order ambiguity.
    fireEvent.change(search, { target: { value: "res" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("b3");
  });

  it("multi toggles two options and the trigger shows two chips", () => {
    const onSelect = vi.fn();
    render(<MultiHarness options={BOARD_OPTIONS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("option", { name: /Growth/ }));
    fireEvent.click(screen.getByRole("option", { name: /Platform/ }));
    expect(onSelect).toHaveBeenLastCalledWith(["b1", "b2"]);
    const trigger = screen.getByRole("button", { name: "Tags" });
    expect(trigger.textContent).toContain("Growth");
    expect(trigger.textContent).toContain("Platform");
  });

  it("the create row calls onCreate with the typed text and selects the result", async () => {
    const onSelect = vi.fn();
    const created: PickerOption = { id: "b4", label: "Launch" };
    const onCreate = vi.fn().mockResolvedValue(created);
    render(<SingleHarness options={BOARD_OPTIONS} onSelect={onSelect} searchable onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("option", { name: "Create 'Launch'" }));
    expect(onCreate).toHaveBeenCalledWith("Launch");
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("b4"));
  });

  it("disabled options are skipped by arrow keys and not selectable by Enter", () => {
    const onSelect = vi.fn();
    const options: PickerOption[] = [
      { id: "b1", label: "Growth" },
      { id: "b2", label: "Platform", disabled: true, disabledReason: "Archived" },
      { id: "b3", label: "Research" },
    ];
    render(<SingleHarness options={options} onSelect={onSelect} />);
    const trigger = screen.getByRole("button", { name: "Board" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // opens, highlights b1
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // skips disabled b2, highlights b3
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("b3");
    expect(onSelect).not.toHaveBeenCalledWith("b2");
  });

  it("aria-activedescendant matches the highlighted option id", () => {
    render(<SingleHarness options={BOARD_OPTIONS} />);
    const trigger = screen.getByRole("button", { name: "Board" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const active = trigger.getAttribute("aria-activedescendant");
    expect(active).toBe("board-picker-option-b2");
    expect(screen.getByRole("option", { name: "Platform" }).id).toBe(active);
  });

  it("closes on outside click", () => {
    render(
      <div>
        <SingleHarness options={BOARD_OPTIONS} />
        <button type="button">Elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
