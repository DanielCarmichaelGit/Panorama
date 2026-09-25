import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, X } from "@phosphor-icons/react";
import type { Family } from "@panorama/core";
import { chipTokens, parseHex } from "../lib/color";

export interface PickerOption {
  id: string;
  label: string;
  family?: Family;
  /** A custom `#rrggbb` that wins over the family on the swatch and the chip when set. */
  color?: string | null;
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
  /** Opens the popover as soon as this instance mounts, e.g. the Board card's "m" shortcut. */
  autoOpen?: boolean;
  /** Keeps the label in the accessibility tree but hides it visually, for a spot too tight for one (the sidebar's project switcher). */
  hideLabel?: boolean;
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

/**
 * The 12px swatch beside an option or the trigger's value: the option's own colour when it has
 * one (the colour itself, as the ColorField's preset swatches show it), else the family's mid
 * tone. Nothing for an option without a family.
 */
function swatchStyle(option: PickerOption): React.CSSProperties | undefined {
  if (option.color && parseHex(option.color)) return { background: option.color };
  if (option.family) return { background: `var(--${option.family}-left)` };
  return undefined;
}

/** The chip for a selected option in a multi trigger: family tokens, or the derived pair for a custom colour. */
function chipStyle(option: PickerOption): React.CSSProperties | undefined {
  if (!option.family) return undefined;
  const tokens = chipTokens({ family: option.family, color: option.color });
  return { background: tokens.top, color: tokens.ink };
}

/** Encodes anything outside [A-Za-z0-9_-] so an option id of any shape is safe as a DOM id. */
function sanitizeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, (c) => `_${(c.codePointAt(0) ?? 0).toString(16)}`);
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
 * `autoOpen` and `hideLabel` are narrow escape hatches for the two spots that need them: a
 * keyboard shortcut that should show the popover the instant it mounts, and a switcher too
 * cramped for a visible label.
 */
export function Picker(props: PickerProps): JSX.Element {
  const { id, label, options, placeholder, searchable, swatch, clearable, onCreate, createLabel, disabled, busy, describedBy, autoOpen, hideLabel } = props;

  const [open, setOpen] = useState(!!autoOpen);
  const [search, setSearch] = useState("");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
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
    if (clearable) list.push({ kind: "clear", key: CLEAR_KEY });
    for (const o of filteredOptions) list.push({ kind: "option", key: o.id, option: o });
    if (showCreateRow) list.push({ kind: "create", key: CREATE_KEY });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearable, filteredOptions, showCreateRow]);

  // A stable, order-sensitive fingerprint of the filtered list's ids, so effects below can react
  // to the options actually changing rather than just their count staying put.
  const filteredIdsKey = useMemo(() => filteredOptions.map((o) => o.id).join("|"), [filteredOptions]);

  const navigableKeys = useMemo(
    () => (busy ? [] : rows.filter((r) => r.kind !== "option" || !r.option.disabled).map((r) => r.key)),
    [rows, busy],
  );

  // The row Enter acts on, settled during render rather than in an effect so it is never a
  // frame behind the list: the row the user moved to (arrows, hover, type-ahead) while it is
  // still navigable, otherwise the first navigable row. Opening and every change to the search
  // text clear the moved-to row, so a fresh popover and a fresh query both start at the top.
  const highlighted = highlightedKey !== null && navigableKeys.includes(highlightedKey) ? highlightedKey : (navigableKeys[0] ?? null);

  // A fresh open session starts clean: no leftover search text or create error from a previous
  // time this picker was opened.
  useEffect(() => {
    if (open) setCreateError(null);
  }, [open]);

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
  }, [open, search, busy, filteredIdsKey]);

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

  // Outside click closes the popover. The popover itself lives in a portal outside the trigger's
  // subtree, so its containment has to be checked separately.
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
    const idx = highlighted ? navigableKeys.indexOf(highlighted) : -1;
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

  function handleClear() {
    if (props.multi) props.onChange([]);
    else props.onChange(null);
    closeAndReturnFocus();
  }

  async function handleCreate() {
    if (!onCreate || creating) return;
    const text = trimmedSearch;
    if (!text) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await onCreate(text);
      if (props.multi) {
        props.onChange([...props.values, created.id]);
      } else {
        props.onChange(created.id);
      }
      closeAndReturnFocus();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create it.");
    } finally {
      setCreating(false);
    }
  }

  function activateHighlighted() {
    const row = rows.find((r) => r.key === highlighted);
    if (!row) return;
    if (row.kind === "clear") {
      handleClear();
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

  function openPopover() {
    setSearch("");
    setHighlightedKey(null);
    setOpen(true);
  }

  function onTriggerClick() {
    if (disabled) return;
    if (open) setOpen(false);
    else openPopover();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      // Only the trigger itself opens on a key press here; a nested control (a chip's remove
      // button) handles its own keys and must not also toggle the popover open.
      if (e.target !== triggerRef.current) return;
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPopover();
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
        // Shift+Tab and plain Tab both land here (only e.key matters): the popover closes and
        // focus goes back to the trigger rather than following the portal's real DOM position,
        // which would otherwise send focus somewhere unpredictable in the page's tab order.
        e.preventDefault();
        closeAndReturnFocus();
        break;
      default:
        if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          typeAhead(e.key);
        }
    }
  }

  let selectedOptions: PickerOption[];
  if (props.multi) {
    selectedOptions = props.values.map((v) => options.find((o) => o.id === v)).filter((o): o is PickerOption => !!o);
  } else {
    const found = props.value ? options.find((o) => o.id === props.value) : undefined;
    selectedOptions = found ? [found] : [];
  }

  function optionRowId(optionId: string) {
    return `${id}-option-${sanitizeId(optionId)}`;
  }

  const activeDescendantId =
    highlighted === null
      ? undefined
      : highlighted === CLEAR_KEY
        ? `${id}-option-clear`
        : highlighted === CREATE_KEY
          ? `${id}-option-create`
          : optionRowId(highlighted);

  return (
    <div className="picker" ref={wrapRef} onKeyDown={handleKeyDown}>
      <label id={`${id}-label`} htmlFor={`${id}-trigger`} className={hideLabel ? "picker-label sr-only" : "picker-label"}>
        {label}
      </label>
      {/*
        A div, not a button: it needs to hold real, independently focusable <button> chip-remove
        controls for multi mode, and a real button cannot contain another real button (the HTML
        parser would close the outer one early and break the layout). role="button" plus explicit
        Enter/Space handling in handleKeyDown keeps it a first-class button for assistive tech and
        the keyboard.
      */}
      <div
        id={`${id}-trigger`}
        ref={triggerRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        className="input picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        aria-activedescendant={!searchable && open ? activeDescendantId : undefined}
        onClick={onTriggerClick}
      >
        {!props.multi && (
          <span className="picker-trigger-value">
            {swatch && selectedOptions[0]?.family && (
              <span className="picker-swatch" style={swatchStyle(selectedOptions[0])} aria-hidden="true" />
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
                      style={chipStyle(o)}
                    >
                      {o.label}
                      <button
                        type="button"
                        aria-label={`Remove ${o.label}`}
                        className="picker-chip-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeValue(o.id);
                        }}
                        onKeyDown={(e) => {
                          // Handled directly rather than relying on the browser's own Enter/Space
                          // activation, so behaviour is identical in every environment (jsdom
                          // included) and never doubles up with the click this also stops.
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            removeValue(o.id);
                          }
                        }}
                      >
                        <X size={10} weight="bold" aria-hidden="true" />
                      </button>
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
      </div>
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
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHighlightedKey(null);
                  setCreateError(null);
                }}
                aria-activedescendant={activeDescendantId}
                aria-label={`Search ${label}`}
              />
            )}
            {createError && (
              <p role="alert" className="error picker-create-error">
                {createError}
              </p>
            )}
            {busy ? (
              <p className="muted picker-loading">Loading</p>
            ) : (
              <>
                {clearable && (
                  <div
                    id={`${id}-option-clear`}
                    role="option"
                    aria-selected={false}
                    className={"picker-option picker-clear-row" + (highlighted === CLEAR_KEY ? " highlighted" : "")}
                    onMouseEnter={() => setHighlightedKey(CLEAR_KEY)}
                    onClick={handleClear}
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
                        (highlighted === o.id ? " highlighted" : "") +
                        (o.disabled ? " disabled" : "")
                      }
                      onMouseEnter={() => {
                        if (!o.disabled) setHighlightedKey(o.id);
                      }}
                      onClick={() => selectOption(o)}
                    >
                      {swatch && o.family && (
                        <span className="picker-swatch" style={swatchStyle(o)} aria-hidden="true" />
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
                    className={"picker-option picker-create-row" + (highlighted === CREATE_KEY ? " highlighted" : "")}
                    onMouseEnter={() => setHighlightedKey(CREATE_KEY)}
                    onClick={() => void handleCreate()}
                  >
                    {(createLabel ?? defaultCreateLabel)(trimmedSearch)}
                  </div>
                )}
              </>
            )}
          </div>,
          // Popovers sit at the menu layer (50), modals at the modal layer (60), so a popover
          // portalled to document.body from a Picker inside a modal would paint under the
          // backdrop. Portalling it into the backdrop instead keeps it inside the modal's own
          // stacking context, above the dialog, without moving it off the menu layer.
          wrapRef.current?.closest(".modal-back") ?? document.body,
        )}
    </div>
  );
}
