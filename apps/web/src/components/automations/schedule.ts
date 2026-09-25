import { isCron } from "@boomerang/core";
import type { PickerOption } from "../Picker";

/**
 * The Schedule node's cron builder: a handful of presets (every hour, day, weekday, week,
 * month) drawn as Pickers and number fields, and a Custom mode for anything else. The node's
 * data stays `{cron, timezone, missed}`; these helpers turn a preset into the five cron fields
 * and read a cron back into a preset when it fits one, so the store and the core see only cron.
 * The shape check here is the same five-field test the core runs; croner on the server is the
 * final judge of what a field means.
 */

export const REPEATS = ["hour", "day", "weekday", "week", "month", "custom"] as const;
export type Repeat = (typeof REPEATS)[number];

export interface ScheduleFields {
  repeat: Repeat;
  /** 0 to 59. */
  minute: number;
  /** 0 to 23. */
  hour: number;
  /** 0 (Sunday) to 6 (Saturday), as cron counts. */
  weekday: number;
  /** 1 to 31. */
  day: number;
}

export const DEFAULT_FIELDS: ScheduleFields = { repeat: "day", minute: 0, hour: 9, weekday: 1, day: 1 };

export const REPEAT_OPTIONS: PickerOption[] = [
  { id: "hour", label: "Every hour" },
  { id: "day", label: "Every day" },
  { id: "weekday", label: "Every weekday" },
  { id: "week", label: "Every week" },
  { id: "month", label: "Every month" },
  { id: "custom", label: "Custom" },
];

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Monday first, as a working week reads; the id is cron's number for the day. */
export const WEEKDAY_OPTIONS: PickerOption[] = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ id: String(d), label: WEEKDAY_NAMES[d] }));

const pad = (n: number) => String(n).padStart(2, "0");
const time = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

export const HOUR_OPTIONS: PickerOption[] = Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: time(h, 0) }));

export const MISSED_OPTIONS: PickerOption[] = [
  { id: "skip", label: "Skip" },
  { id: "run_once", label: "Run once" },
  { id: "run_all", label: "Run every missed one" },
];

/** A short list for a browser without Intl.supportedValuesOf; the current zone is always added. */
const FALLBACK_ZONES = ["UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Tokyo", "Asia/Singapore", "Asia/Kolkata", "Australia/Sydney"];

let zones: PickerOption[] | null = null;
export function timezoneOptions(current: string | undefined): PickerOption[] {
  if (!zones) {
    let list: string[] = [];
    try {
      const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
      list = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
    } catch {
      list = [];
    }
    if (list.length === 0) list = FALLBACK_ZONES;
    if (!list.includes("UTC")) list = ["UTC", ...list];
    zones = list.map((z) => ({ id: z, label: z }));
  }
  return current && !zones.some((z) => z.id === current) ? [{ id: current, label: current }, ...zones] : zones;
}

/** Five space separated cron fields of the shape the core accepts. */
export const isCronShape = (s: string): boolean => isCron(s);

export function buildCron(f: ScheduleFields): string {
  const m = clamp(f.minute, 0, 59);
  const h = clamp(f.hour, 0, 23);
  switch (f.repeat) {
    case "hour":
      return `${m} * * * *`;
    case "day":
      return `${m} ${h} * * *`;
    case "weekday":
      return `${m} ${h} * * 1-5`;
    case "week":
      return `${m} ${h} * * ${clamp(f.weekday, 0, 6)}`;
    case "month":
      return `${m} ${h} ${clamp(f.day, 1, 31)} * *`;
    default:
      return "";
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

const num = (s: string, lo: number, hi: number): number | null => {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= lo && n <= hi ? n : null;
};

/** Reads a cron into the builder's fields; `repeat` is custom when no preset draws it. Unset fields keep their defaults. */
export function parseCron(cron: string): ScheduleFields {
  const custom: ScheduleFields = { ...DEFAULT_FIELDS, repeat: "custom" };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return custom;
  const [m, h, dom, mon, dow] = parts;
  const minute = num(m, 0, 59);
  if (minute === null || mon !== "*") return custom;
  if (h === "*") return dom === "*" && dow === "*" ? { ...DEFAULT_FIELDS, repeat: "hour", minute } : custom;
  const hour = num(h, 0, 23);
  if (hour === null) return custom;
  if (dom === "*") {
    if (dow === "*") return { ...DEFAULT_FIELDS, repeat: "day", minute, hour };
    if (dow === "1-5") return { ...DEFAULT_FIELDS, repeat: "weekday", minute, hour };
    const weekday = num(dow, 0, 6);
    if (weekday !== null) return { ...DEFAULT_FIELDS, repeat: "week", minute, hour, weekday };
    return custom;
  }
  const day = num(dom, 1, 31);
  if (day !== null && dow === "*") return { ...DEFAULT_FIELDS, repeat: "month", minute, hour, day };
  return custom;
}

const ordinal = (n: number): string => {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  if (rem10 === 1) return `${n}st`;
  if (rem10 === 2) return `${n}nd`;
  if (rem10 === 3) return `${n}rd`;
  return `${n}th`;
};

/** A preset in words: "Every weekday at 09:00". */
export function describeFields(f: ScheduleFields): string {
  const at = time(f.hour, f.minute);
  switch (f.repeat) {
    case "hour":
      return f.minute === 0 ? "Every hour" : `Every hour at ${f.minute} minutes past`;
    case "day":
      return `Every day at ${at}`;
    case "weekday":
      return `Every weekday at ${at}`;
    case "week":
      return `Every ${WEEKDAY_NAMES[f.weekday] ?? "week"} at ${at}`;
    case "month":
      return `Every month on the ${ordinal(f.day)} at ${at}`;
    default:
      return "Custom";
  }
}

const listWords = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * A cron in words, or null when it is not five fields. Presets read as their sentence; the
 * common custom shapes (every N minutes or hours, a list of weekdays at a time) get their own,
 * and anything else reads as "On cron <expression>".
 */
export function describeCron(cron: string): string | null {
  if (!isCronShape(cron)) return null;
  const f = parseCron(cron);
  if (f.repeat !== "custom") return describeFields(f);
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  const every = (s: string) => (/^\*\/\d+$/.test(s) ? Number(s.slice(2)) : null);
  const stepM = every(m);
  if (stepM && h === "*" && dom === "*" && mon === "*" && dow === "*") return `Every ${stepM} minutes`;
  const stepH = every(h);
  const minute = num(m, 0, 59);
  if (stepH && minute !== null && dom === "*" && mon === "*" && dow === "*") return minute === 0 ? `Every ${stepH} hours` : `Every ${stepH} hours at ${minute} minutes past`;
  const hour = num(h, 0, 23);
  if (minute !== null && hour !== null && dom === "*" && mon === "*" && /^\d(,\d)+$/.test(dow)) {
    const days = dow.split(",").map((d) => num(d, 0, 6));
    if (days.every((d) => d !== null)) return `Every ${listWords(days.map((d) => WEEKDAY_NAMES[d as number]))} at ${time(hour, minute)}`;
  }
  return `On cron ${cron.trim()}`;
}

/** The Schedule node's title: the cron in words, then the timezone. */
export function scheduleTitle(data: { cron?: unknown; timezone?: unknown }): string {
  const cron = typeof data.cron === "string" ? data.cron : "";
  if (!cron) return "Choose a schedule";
  const words = describeCron(cron) ?? "Not a valid schedule";
  const tz = typeof data.timezone === "string" && data.timezone ? data.timezone : "";
  return tz ? `${words}, ${tz}` : words;
}
