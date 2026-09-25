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

function MultiHarness(props: { options: PickerOption[]; onSelect?: (ids: string[]) => void; clearable?: boolean; initial?: string[] }) {
  const [values, setValues] = useState<string[]>(props.initial ?? []);
  return (
    <Picker
      id="tag-picker"
      label="Tags"
      options={props.options}
      multi
      clearable={props.clearable}
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

  it("has aria-controls pointing at the listbox id", () => {
    render(<SingleHarness options={BOARD_OPTIONS} />);
    expect(screen.getByRole("button", { name: "Board" }).getAttribute("aria-controls")).toBe("board-picker-listbox");
  });

  it("a chip's remove button is a real, tab-reachable button, and Enter removes it without opening the popover", () => {
    const onSelect = vi.fn();
    render(<MultiHarness options={BOARD_OPTIONS} onSelect={onSelect} initial={["b1", "b2"]} />);
    const removeBtn = screen.getByRole("button", { name: "Remove Growth" });
    expect(removeBtn.tagName).toBe("BUTTON");
    expect(removeBtn.tabIndex).toBe(0); // a real button, in the natural tab order
    removeBtn.focus();
    fireEvent.keyDown(removeBtn, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(["b2"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clearable empties the selection in multi mode via the Clear row", () => {
    const onSelect = vi.fn();
    render(<MultiHarness options={BOARD_OPTIONS} onSelect={onSelect} clearable initial={["b1", "b2"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("option", { name: "Clear" }));
    expect(onSelect).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows an error and keeps the popover open when onCreate rejects, then allows retrying", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("Name already exists")).mockResolvedValue({ id: "b4", label: "Launch" });
    const onSelect = vi.fn();
    render(<SingleHarness options={BOARD_OPTIONS} onSelect={onSelect} searchable onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Launch" } });
    fireEvent.click(screen.getByRole("option", { name: "Create 'Launch'" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Name already exists"));
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: "Create 'Launch'" }));
    expect(onCreate).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("b4"));
  });

  it("Tab while open closes the popover and moves focus back to the trigger", () => {
    render(<SingleHarness options={BOARD_OPTIONS} searchable />);
    const trigger = screen.getByRole("button", { name: "Board" });
    fireEvent.click(trigger);
    const search = screen.getByRole("textbox");
    fireEvent.keyDown(search, { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Shift+Tab while open also closes the popover and refocuses the trigger", () => {
    render(<SingleHarness options={BOARD_OPTIONS} searchable />);
    const trigger = screen.getByRole("button", { name: "Board" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Tab", shiftKey: true });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("sanitises option ids that contain characters unsafe for a DOM id", () => {
    const options: PickerOption[] = [
      { id: "weird id/1", label: "Weird" },
      { id: "b2", label: "Platform" },
    ];
    render(<SingleHarness options={options} />);
    const trigger = screen.getByRole("button", { name: "Board" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: "Weird" });
    expect(option.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(trigger.getAttribute("aria-activedescendant")).toBe(option.id);
  });

  it("autoOpen shows the popover as soon as it mounts, with no click or key needed", () => {
    render(<Picker id="move-t1" label="Move to" options={BOARD_OPTIONS} value="b1" onChange={() => {}} autoOpen />);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("hideLabel keeps the label in the accessibility tree but visually hides it", () => {
    render(<Picker id="project" label="Project" options={BOARD_OPTIONS} value="b1" onChange={() => {}} hideLabel />);
    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
    const label = screen.getByText("Project", { selector: "label" });
    expect(label.className).toContain("sr-only");
  });

  it("resets the highlight when the option list's ids change, even if the count stays the same", () => {
    function SwapHarness() {
      const [opts, setOpts] = useState<PickerOption[]>([
        { id: "x1", label: "Alpha" },
        { id: "x2", label: "Beta" },
      ]);
      const [value, setValue] = useState<string | null>(null);
      return (
        <div>
          <button type="button" onClick={() => setOpts([{ id: "y1", label: "Gamma" }, { id: "y2", label: "Delta" }])}>
            Replace options
          </button>
          <Picker id="swap-picker" label="Swap" options={opts} value={value} onChange={setValue} />
        </div>
      );
    }
    render(<SwapHarness />);
    const trigger = screen.getByRole("button", { name: "Swap" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toBe("swap-picker-option-x2");

    fireEvent.click(screen.getByRole("button", { name: "Replace options" }));
    expect(trigger.getAttribute("aria-activedescendant")).toBe("swap-picker-option-y1");
  });
});

describe("Picker inside a modal", () => {
  it("mounts its popover inside the modal's backdrop, so it stacks above the dialog rather than under the backdrop", () => {
    render(
      <div className="modal-back">
        <div className="modal card" role="dialog">
          <SingleHarness options={BOARD_OPTIONS} />
        </div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    const listbox = screen.getByRole("listbox");
    expect(listbox.parentElement?.classList.contains("modal-back")).toBe(true);
  });

  it("still mounts on document.body when there is no modal", () => {
    render(<SingleHarness options={BOARD_OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByRole("listbox").parentElement).toBe(document.body);
  });
});

