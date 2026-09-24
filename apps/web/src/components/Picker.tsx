import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, X } from "@phosphor-icons/react";
import type { Family } from "@panorama/core";

export interface PickerOption {
  id: string;
  label: string;
  family?: Family;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
}

type Single = { multi?: false; value: string | null; onChange: (id: string | null) => void };
type Multi = { multi: true; values: string[]; onChange: (ids: string[]) => void };

export type PickerProps = (Single | Multi) & {
  id: string;
  label: string;
  options: PickerOption[];
  placeholder?: string;
  searchable?: boolean;
  swatch?: boolean;
  clearable?: boolean;
  onCreate?: (text: string) => Promise<PickerOption> | PickerOption;
  createLabel?: (text: string) => string;
  disabled?: boolean;
  busy?: boolean;
  describedBy?: string;
};

type Row =
  | { kind: "clear"; key: string }
  | { kind: "option"; key: string; option: PickerOption }
  | { kind: "create"; key: string };

const MIN_WIDTH = 256; // 16rem at the 16px root size
const GAP = 4;
const CLEAR_KEY = "__clear__";
const CREATE_KEY = "__create__";

function defaultCreateLabel(text: string): string {
  return `Create '${text}'`;
}

interface Position {
  top: number;
  left: number;
  width: number;
  placement: "below" | "above";
}

/**
 * One component for every choice in the app: a trigger button showing the current value(s) and a
 * portalled popover listbox with search, arrows, Enter, Escape, type-ahead, and an optional
 * "Create new" row. Replaces every native `<select>`. See the "Picker" paragraph of
 * docs/superpowers/specs/2026-09-24-ticket-model-design.md for the full behaviour contract.
 */
export function Picker(props: PickerProps): JSX.Element {
  const { id, label, options, placeholder, searchable, swatch, clearable, onCreate, createLabel, disabled, busy, describedBy } = props;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [creating, setCreating] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chipsMeasureRef = useRef<HTMLSpanElement>(null);
  const typeaheadRef = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({ buffer: "", timer: null });

  const trimmedSearch = search.trim();

  const filteredOptions = useMemo(() => {
    if (!searchable || trimmedSearch === "") return options;
    const q = trimmedSearch.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false));
  }, [options, searchable, trimmedSearch]);

  const showCreateRow =
    !!onCreate &&
    !!searchable &&
    trimmedSearch !== "" &&
    !options.some((o) => o.label.trim().toLowerCase() === trimmedSearch.toLowerCase());

  const rows: Row[] = useMemo(() => {
    const list: Row[] = [];
    if (clearable && !props.multi) list.push({ kind: "clear", key: CLEAR_KEY });
    for (const o of filteredOptions) list.push({ kind: "option", key: o.id, option: o });
    if (showCreateRow) list.push({ kind: "create", key: CREATE_KEY });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearable, props.multi, filteredOptions, showCreateRow]);

  const navigableKeys = useMemo(
    () => (busy ? [] : rows.filter((r) => r.kind !== "option" || !r.option.disabled).map((r) => r.key)),
    [rows, busy],
  );

  // Highlight follows the first navigable row whenever the popover opens or the search text
  // narrows the list, unless the current highlight is still in the (possibly filtered) list.
  useEffect(() => {
    if (!open) return;
    setHighlightedKey((prev) => (prev && navigableKeys.includes(prev) ? prev : (navigableKeys[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, busy, filteredOptions.length]);

  // Focus the search field once the popover mounts; otherwise the trigger keeps focus and
  // captures the keyboard itself (type-ahead, arrows).
  useEffect(() => {
    if (!open || !searchable) return;
    searchInputRef.current?.focus();
  }, [open, searchable]);

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, MIN_WIDTH);
    const popoverHeight = popoverRef.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: "below" | "above" = spaceBelow < popoverHeight && spaceAbove > spaceBelow ? "above" : "below";
    const top = placement === "below" ? rect.bottom + GAP : rect.top - popoverHeight - GAP;
    setPosition({ top, left: rect.left, width, placement });
  }

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search, busy, filteredOptions.length]);

  useEffect(() => {
    if (!open) return;
    function onReposition() {
      updatePosition();
    }
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Outside click closes the popover. The popover itself lives in a portal on document.body, so
  // its containment has to be checked separately from the trigger's own subtree.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  // Whether the multi trigger's chips fit: measured off a hidden, unclipped clone so the check
  // stays accurate even while the visible copy is swapped for the "n selected" summary.
  useEffect(() => {
    if (!props.multi) return;
    function measure() {
      const trigger = triggerRef.current;
      const clone = chipsMeasureRef.current;
      if (!trigger || !clone) return;
      const available = trigger.clientWidth - 40; // reserve for caret, padding, and swatch
      setOverflowing(clone.scrollWidth > Math.max(available, 0));
    }
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      if (triggerRef.current) ro.observe(triggerRef.current);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.multi, props.multi ? props.values : null]);

  function closeAndReturnFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveHighlight(delta: number) {
    if (navigableKeys.length === 0) return;
    const idx = highlightedKey ? navigableKeys.indexOf(highlightedKey) : -1;
    const nextIdx = idx === -1 ? (delta > 0 ? 0 : navigableKeys.length - 1) : (idx + delta + navigableKeys.length) % navigableKeys.length;
    setHighlightedKey(navigableKeys[nextIdx]);
  }

  function selectOption(option: PickerOption) {
    if (option.disabled) return;
    if (props.multi) {
      const has = props.values.includes(option.id);
      props.onChange(has ? props.values.filter((v) => v !== option.id) : [...props.values, option.id]);
    } else {
      props.onChange(option.id);
      closeAndReturnFocus();
    }
  }

  function removeValue(optionId: string) {
    if (!props.multi) return;
    props.onChange(props.values.filter((v) => v !== optionId));
  }

  async function handleCreate() {
    if (!onCreate || creating) return;
    const text = trimmedSearch;
    if (!text) return;
    setCreating(true);
    try {
      const created = await onCreate(text);
      if (props.multi) {
        props.onChange([...props.values, created.id]);
      } else {
        props.onChange(created.id);
      }
      closeAndReturnFocus();
    } finally {
      setCreating(false);
    }
  }

  function activateHighlighted() {
    const row = rows.find((r) => r.key === highlightedKey);
    if (!row) return;
    if (row.kind === "clear") {
      if (!props.multi) props.onChange(null);
      closeAndReturnFocus();
      return;
    }
    if (row.kind === "option") {
      selectOption(row.option);
      return;
    }
    void handleCreate();
  }

  function typeAhead(char: string) {
    const state = typeaheadRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.buffer += char.toLowerCase();
    const match = rows.find((r) => r.kind === "option" && !r.option.disabled && r.option.label.toLowerCase().startsWith(state.buffer));
    if (match) setHighlightedKey(match.key);
    state.timer = setTimeout(() => {
      state.buffer = "";
    }, 600);
  }

  function onTriggerClick() {
    if (disabled) return;
    setSearch("");
    setOpen((o) => !o);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSearch("");
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeAndReturnFocus();
        break;
      case "ArrowDown":
        e.preventDefault();
        moveHighlight(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveHighlight(-1);
        break;
      case "Home":
        e.preventDefault();
        if (navigableKeys.length) setHighlightedKey(navigableKeys[0]);
        break;
      case "End":
        e.preventDefault();
        if (navigableKeys.length) setHighlightedKey(navigableKeys[navigableKeys.length - 1]);
        break;
      case "Enter":
        e.preventDefault();
        activateHighlighted();
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          typeAhead(e.key);
        }
    }
  }

  const selectedOptions: PickerOption[] = props.multi
    ? props.values.map((v) => options.find((o) => o.id === v)).filter((o): o is PickerOption => !!o)
    : props.value
      ? (options.find((o) => o.id === props.value) ? [options.find((o) => o.id === props.value)!] : [])
      : [];

  function optionRowId(optionId: string) {
    return `${id}-option-${optionId}`;
  }

  const activeDescendantId =
    highlightedKey === null
      ? undefined
      : highlightedKey === CLEAR_KEY
        ? `${id}-option-clear`
        : highlightedKey === CREATE_KEY
          ? `${id}-option-create`
          : optionRowId(highlightedKey);

  return (
    <div className="picker" ref={wrapRef} onKeyDown={handleKeyDown}>
      <label id={`${id}-label`} htmlFor={`${id}-trigger`} className="picker-label">
        {label}
      </label>
      <button
        type="button"
        id={`${id}-trigger`}
        ref={triggerRef}
        className="input picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-activedescendant={!searchable && open ? activeDescendantId : undefined}
        disabled={disabled}
        onClick={onTriggerClick}
      >
        {!props.multi && (
          <span className="picker-trigger-value">
            {swatch && selectedOptions[0]?.family && (
              <span className="picker-swatch" style={{ background: `var(--${selectedOptions[0].family}-left)` }} aria-hidden="true" />
            )}
            <span className={selectedOptions[0] ? "picker-value-text" : "picker-placeholder"}>
              {selectedOptions[0]?.label ?? placeholder ?? "Select"}
            </span>
          </span>
        )}
        {props.multi && (
          <span className="picker-trigger-value">
            {selectedOptions.length === 0 && <span className="picker-placeholder">{placeholder ?? "Select"}</span>}
            {selectedOptions.length > 0 &&
              (overflowing ? (
                <span className="picker-count">{selectedOptions.length} selected</span>
              ) : (
                <span className="picker-chips">
                  {selectedOptions.map((o) => (
                    <span
                      key={o.id}
                      className="chip picker-chip"
                      style={o.family ? { background: `var(--${o.family}-top)`, color: `var(--${o.family}-ink)` } : undefined}
                    >
                      {o.label}
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Remove ${o.label}`}
                        className="picker-chip-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeValue(o.id);
                        }}
                      >
                        <X size={10} weight="bold" aria-hidden="true" />
                      </span>
                    </span>
                  ))}
                </span>
              ))}
            <span ref={chipsMeasureRef} className="picker-chips-measure" aria-hidden="true">
              {selectedOptions.map((o) => (
                <span key={o.id} className="chip picker-chip">
                  {o.label}
                </span>
              ))}
            </span>
          </span>
        )}
        <CaretDown size={16} weight="bold" className="picker-caret" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-multiselectable={props.multi ? true : undefined}
            aria-labelledby={`${id}-label`}
            data-placement={position?.placement ?? "below"}
            className="picker-popover"
            style={
              {
                top: position ? position.top : -9999,
                left: position ? position.left : -9999,
                width: position ? position.width : MIN_WIDTH,
                "--picker-rise": position?.placement === "above" ? "-4px" : "4px",
              } as React.CSSProperties
            }
          >
            {searchable && (
              <input
                ref={searchInputRef}
                type="text"
                className="input picker-search"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-activedescendant={activeDescendantId}
                aria-label={`Search ${label}`}
              />
            )}
            {busy ? (
              <p className="muted picker-loading">Loading</p>
            ) : (
              <>
                {clearable && !props.multi && (
                  <div
                    id={`${id}-option-clear`}
                    role="option"
                    aria-selected={false}
                    className={"picker-option picker-clear-row" + (highlightedKey === CLEAR_KEY ? " highlighted" : "")}
                    onMouseEnter={() => setHighlightedKey(CLEAR_KEY)}
                    onClick={() => {
                      if (!props.multi) props.onChange(null);
                      closeAndReturnFocus();
                    }}
                  >
                    Clear
                  </div>
                )}
                {filteredOptions.length === 0 && <p className="muted picker-empty">No options</p>}
                {filteredOptions.map((o) => {
                  const selected = props.multi ? props.values.includes(o.id) : props.value === o.id;
                  return (
                    <div
                      key={o.id}
                      id={optionRowId(o.id)}
                      role="option"
                      aria-selected={selected}
                      aria-disabled={o.disabled || undefined}
                      title={o.disabledReason}
                      className={
                        "picker-option" +
                        (highlightedKey === o.id ? " highlighted" : "") +
                        (o.disabled ? " disabled" : "")
                      }
                      onMouseEnter={() => {
                        if (!o.disabled) setHighlightedKey(o.id);
                      }}
                      onClick={() => selectOption(o)}
                    >
                      {swatch && o.family && (
                        <span className="picker-swatch" style={{ background: `var(--${o.family}-left)` }} aria-hidden="true" />
                      )}
                      <span className="picker-option-label">{o.label}</span>
                      {o.hint && <span className="picker-hint">{o.hint}</span>}
                      {selected && <Check size={14} weight="bold" aria-hidden="true" className="picker-check" />}
                    </div>
                  );
                })}
                {showCreateRow && (
                  <div
                    id={`${id}-option-create`}
                    role="option"
                    aria-selected={false}
                    className={"picker-option picker-create-row" + (highlightedKey === CREATE_KEY ? " highlighted" : "")}
                    onMouseEnter={() => setHighlightedKey(CREATE_KEY)}
                    onClick={() => void handleCreate()}
                  >
                    {(createLabel ?? defaultCreateLabel)(trimmedSearch)}
                  </div>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
