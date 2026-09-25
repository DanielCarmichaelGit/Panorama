import { useEffect, useRef, useState } from "react";
import { FAMILIES } from "@panorama/core";
import type { Family } from "@panorama/core";
import { PRESET_COLORS, chipTokens, parseHex, toHex } from "../lib/color";
import { FAMILY } from "../lib/families";

export interface ColorValue {
  family: Family;
  color: string | null;
}

export interface ColorFieldProps {
  id: string;
  label: string;
  family: Family;
  color: string | null;
  onChange: (next: ColorValue) => void;
  /** Show the seven BRAND.md presets between the families and Custom. Default true. */
  presets?: boolean;
  disabled?: boolean;
}

type Swatch = { kind: "family"; key: string; family: Family } | { kind: "preset"; key: string; hex: string } | { kind: "custom"; key: string };

const FAMILY_LABEL: Record<Family, string> = { coral: "Coral", sky: "Sky", lilac: "Lilac", mint: "Mint", stone: "Stone" };
const HEX_ERROR = "A colour is six hex digits, like #f6c1b4";
const CUSTOM_KEY = "custom";

function isPreset(color: string | null): boolean {
  return color !== null && (PRESET_COLORS as readonly string[]).includes(color);
}

/**
 * The colour control for anything that carries a `family` and an optional `color` (arcs and
 * tags): one row of round swatches, the five families first, then the seven presets, then
 * Custom. A family swatch sets the family and clears the colour; a preset sets the colour and
 * leaves the family as the fallback; Custom reveals a native colour input beside a hex field.
 * The swatches are one roving tab stop: arrows, Home and End move between them, Enter or Space
 * selects. See section 2 of docs/superpowers/specs/2026-09-24-settings-refresh-design.md.
 */
export function ColorField({ id, label, family, color, onChange, presets = true, disabled }: ColorFieldProps): JSX.Element {
  const custom = color !== null && !isPreset(color);
  const [customOpen, setCustomOpen] = useState(custom);
  const [draft, setDraft] = useState(color ?? "");
  const [hexError, setHexError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [wantHexFocus, setWantHexFocus] = useState(false);

  const swatchRefs = useRef(new Map<string, HTMLButtonElement>());
  const hexRef = useRef<HTMLInputElement>(null);

  const swatches: Swatch[] = [
    ...FAMILIES.map((f): Swatch => ({ kind: "family", key: `family-${f}`, family: f })),
    ...(presets ? PRESET_COLORS.map((hex, i): Swatch => ({ kind: "preset", key: `preset-${i}`, hex })) : []),
    { kind: "custom", key: CUSTOM_KEY },
  ];

  function isPressed(s: Swatch): boolean {
    if (s.kind === "family") return color === null && s.family === family;
    if (s.kind === "preset") return color === s.hex;
    return custom;
  }

  const pressedKey = swatches.find(isPressed)?.key ?? swatches[0].key;
  // The tab stop follows the keyboard while the user is moving, and the pressed swatch otherwise.
  const tabKey = focusKey && swatches.some((s) => s.key === focusKey) ? focusKey : pressedKey;

  // An outside change to the colour (a save, a reset) is reflected in the hex field; a colour
  // the user is still typing is not overwritten because it only reaches `color` once valid.
  useEffect(() => {
    setDraft(color ?? "");
    setHexError(null);
    if (custom) setCustomOpen(true);
  }, [color, custom]);

  useEffect(() => {
    if (!wantHexFocus) return;
    hexRef.current?.focus();
    hexRef.current?.select();
    setWantHexFocus(false);
  }, [wantHexFocus, customOpen]);

  function select(s: Swatch) {
    if (disabled) return;
    setFocusKey(s.key);
    if (s.kind === "family") {
      onChange({ family: s.family, color: null });
      return;
    }
    if (s.kind === "preset") {
      onChange({ family, color: s.hex });
      return;
    }
    setCustomOpen(true);
    setWantHexFocus(true);
  }

  function moveFocus(from: string, delta: number, absolute?: "first" | "last") {
    const idx = swatches.findIndex((s) => s.key === from);
    let next: number;
    if (absolute === "first") next = 0;
    else if (absolute === "last") next = swatches.length - 1;
    else next = (idx + delta + swatches.length) % swatches.length;
    const key = swatches[next].key;
    setFocusKey(key);
    swatchRefs.current.get(key)?.focus();
  }

  function onSwatchKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, s: Swatch) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveFocus(s.key, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveFocus(s.key, -1);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(s.key, 0, "first");
        break;
      case "End":
        e.preventDefault();
        moveFocus(s.key, 0, "last");
        break;
      case "Enter":
      case " ":
        // Handled here rather than through the button's own activation so it behaves the same
        // everywhere (jsdom included) and never doubles up with the click it would also fire.
        e.preventDefault();
        select(s);
        break;
    }
  }

  function commitHex(text: string): boolean {
    const trimmed = text.trim();
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    const rgb = parseHex(withHash);
    if (!rgb) return false;
    const hex = toHex(rgb);
    setHexError(null);
    if (hex !== color) onChange({ family, color: hex });
    return true;
  }

  function onHexChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setDraft(text);
    setHexError(null);
    commitHex(text);
  }

  function validateHex() {
    if (draft.trim() === "") {
      setHexError(null);
      return;
    }
    if (!commitHex(draft)) setHexError(HEX_ERROR);
  }

  function swatchStyle(s: Swatch): React.CSSProperties | undefined {
    if (s.kind === "family") return { background: `var(--${s.family}-top)` };
    if (s.kind === "preset") return { background: s.hex };
    if (custom && color) return { background: chipTokens({ family, color }).top };
    return undefined;
  }

  const showCustom = customOpen || custom;
  // The native picker opens on the current colour, or on the family top when there is none yet.
  const draftRgb = parseHex(draft);
  const nativeValue = color ?? (draftRgb ? toHex(draftRgb) : FAMILY[family].top.toLowerCase());
  const errorId = `${id}-hex-error`;

  return (
    <fieldset className="swatch-field color-field" id={id} disabled={disabled}>
      <legend id={`${id}-legend`}>{label}</legend>
      <div className="color-swatches">
        {swatches.map((s) => {
          const name = s.kind === "family" ? FAMILY_LABEL[s.family] : s.kind === "preset" ? s.hex : "Custom colour";
          const empty = s.kind === "custom" && !custom;
          return (
            <button
              key={s.key}
              id={`${id}-${s.key}`}
              type="button"
              ref={(el) => {
                if (el) swatchRefs.current.set(s.key, el);
                else swatchRefs.current.delete(s.key);
              }}
              className={"color-swatch" + (s.kind === "custom" ? " color-swatch-custom" : "")}
              style={swatchStyle(s)}
              aria-label={name}
              title={name}
              aria-pressed={isPressed(s)}
              data-empty={empty || undefined}
              tabIndex={s.key === tabKey ? 0 : -1}
              disabled={disabled}
              onClick={() => select(s)}
              onKeyDown={(e) => onSwatchKeyDown(e, s)}
              onFocus={() => setFocusKey(s.key)}
            />
          );
        })}
      </div>
      {showCustom && (
        <div className="color-custom">
          <input
            id={`${id}-color`}
            type="color"
            className="color-native"
            aria-label="Pick a colour"
            value={nativeValue}
            disabled={disabled}
            onChange={(e) => {
              setDraft(e.target.value);
              commitHex(e.target.value);
            }}
          />
          <div className="color-hex-wrap">
            <input
              id={`${id}-hex`}
              ref={hexRef}
              type="text"
              className="input mono-input color-hex"
              aria-label="Hex"
              placeholder="#rrggbb"
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              value={draft}
              disabled={disabled}
              aria-invalid={hexError ? true : undefined}
              aria-describedby={hexError ? errorId : undefined}
              onChange={onHexChange}
              onBlur={validateHex}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  validateHex();
                }
              }}
            />
            {hexError && (
              <p id={errorId} role="alert" className="error color-hex-error">
                {hexError}
              </p>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}
