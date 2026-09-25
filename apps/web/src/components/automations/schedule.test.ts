import { describe, expect, it } from "vitest";
import { DEFAULT_FIELDS, buildCron, describeCron, isCronShape, parseCron, scheduleTitle } from "./schedule";

describe("buildCron", () => {
  it("writes each preset as five fields", () => {
    expect(buildCron({ ...DEFAULT_FIELDS, repeat: "hour", minute: 0 })).toBe("0 * * * *");
    expect(buildCron({ ...DEFAULT_FIELDS, repeat: "hour", minute: 15 })).toBe("15 * * * *");
    expect(buildCron({ ...DEFAULT_FIELDS, repeat: "day", hour: 9, minute: 0 })).toBe("0 9 * * *");
    expect(buildCron({ ...DEFAULT_FIELDS, repeat: "weekday", hour: 9, minute: 30 })).toBe("30 9 * * 1-5");
    expect(buildCron({ ...DEFAULT_FIELDS, repeat: "week", weekday: 5, hour: 17, minute: 0 })).toBe("0 17 * * 5");
    expect(buildCron({ ...DEFAULT_FIELDS, repeat: "month", day: 1, hour: 8, minute: 0 })).toBe("0 8 1 * *");
  });
});

describe("parseCron", () => {
  it("reads a preset back into its fields", () => {
    expect(parseCron("15 * * * *")).toMatchObject({ repeat: "hour", minute: 15 });
    expect(parseCron("0 9 * * *")).toMatchObject({ repeat: "day", minute: 0, hour: 9 });
    expect(parseCron("30 9 * * 1-5")).toMatchObject({ repeat: "weekday", minute: 30, hour: 9 });
    expect(parseCron("0 17 * * 5")).toMatchObject({ repeat: "week", weekday: 5, hour: 17 });
    expect(parseCron("0 8 1 * *")).toMatchObject({ repeat: "month", day: 1, hour: 8 });
  });

  it("round trips every preset", () => {
    for (const cron of ["5 * * * *", "0 9 * * *", "45 18 * * 1-5", "0 7 * * 0", "30 6 28 * *"]) {
      expect(buildCron(parseCron(cron))).toBe(cron);
    }
  });

  it("stays custom when the expression fits no preset", () => {
    expect(parseCron("*/15 * * * *").repeat).toBe("custom");
    expect(parseCron("0 9 * * 1,3").repeat).toBe("custom");
    expect(parseCron("0 9 1 6 *").repeat).toBe("custom");
    expect(parseCron("0 9 * *").repeat).toBe("custom");
    expect(parseCron("").repeat).toBe("custom");
  });
});

describe("isCronShape", () => {
  it("accepts five fields of ranges, lists and steps and refuses anything else", () => {
    expect(isCronShape("0 9 * * 1-5")).toBe(true);
    expect(isCronShape("*/10 8-18 * * mon-fri")).toBe(true);
    expect(isCronShape("0 9 * *")).toBe(false);
    expect(isCronShape("0 9 * * * *")).toBe(false);
    expect(isCronShape("a b c d e#")).toBe(false);
    expect(isCronShape("")).toBe(false);
  });
});

describe("describeCron", () => {
  it("says a preset in words", () => {
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("15 * * * *")).toBe("Every hour at 15 minutes past");
    expect(describeCron("0 9 * * *")).toBe("Every day at 09:00");
    expect(describeCron("30 9 * * 1-5")).toBe("Every weekday at 09:30");
    expect(describeCron("0 17 * * 5")).toBe("Every Friday at 17:00");
    expect(describeCron("0 8 1 * *")).toBe("Every month on the 1st at 08:00");
    expect(describeCron("0 8 22 * *")).toBe("Every month on the 22nd at 08:00");
  });

  it("describes the common custom shapes and falls back to the expression", () => {
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("0 */2 * * *")).toBe("Every 2 hours");
    expect(describeCron("0 9 * * 1,3,5")).toBe("Every Monday, Wednesday and Friday at 09:00");
    expect(describeCron("0 9 1 6 *")).toBe("On cron 0 9 1 6 *");
  });

  it("returns null when the shape is wrong", () => {
    expect(describeCron("0 9 * *")).toBeNull();
    expect(describeCron("")).toBeNull();
  });
});

describe("scheduleTitle", () => {
  it("reads the schedule and its timezone in words", () => {
    expect(scheduleTitle({ cron: "0 9 * * 1-5", timezone: "Europe/London" })).toBe("Every weekday at 09:00, Europe/London");
    expect(scheduleTitle({ cron: "0 9 * * 1-5" })).toBe("Every weekday at 09:00");
    expect(scheduleTitle({ cron: "nope", timezone: "UTC" })).toBe("Not a valid schedule, UTC");
    expect(scheduleTitle({ timezone: "UTC" })).toBe("Choose a schedule");
  });
});
