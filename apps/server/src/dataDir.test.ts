import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDataDir } from "./dataDir";

const home = () => mkdtempSync(join(tmpdir(), "bm-home-"));
const collect = () => { const lines: string[] = []; return { lines, log: (l: string) => lines.push(l) }; };

describe("resolveDataDir", () => {
  it("defaults to ~/.boomerang and moves an existing ~/.panorama there, logging once", () => {
    const h = home(); const { lines, log } = collect();
    mkdirSync(join(h, ".panorama"));
    writeFileSync(join(h, ".panorama", "config.json"), "{}");
    const dir = resolveDataDir({ env: {}, home: h, log });
    expect(dir).toBe(join(h, ".boomerang"));
    expect(existsSync(join(h, ".panorama"))).toBe(false);
    expect(readFileSync(join(h, ".boomerang", "config.json"), "utf8")).toBe("{}");
    expect(lines).toEqual([`Moved ${join(h, ".panorama")} to ${join(h, ".boomerang")}`]);
  });

  it("leaves both directories alone when ~/.boomerang already exists", () => {
    const h = home(); const { lines, log } = collect();
    mkdirSync(join(h, ".panorama")); mkdirSync(join(h, ".boomerang"));
    writeFileSync(join(h, ".panorama", "config.json"), "old");
    expect(resolveDataDir({ env: {}, home: h, log })).toBe(join(h, ".boomerang"));
    expect(readFileSync(join(h, ".panorama", "config.json"), "utf8")).toBe("old");
    expect(lines).toEqual([]);
  });

  it("does nothing and logs nothing on a fresh home", () => {
    const h = home(); const { lines, log } = collect();
    expect(resolveDataDir({ env: {}, home: h, log })).toBe(join(h, ".boomerang"));
    expect(existsSync(join(h, ".boomerang"))).toBe(false);
    expect(lines).toEqual([]);
  });

  it("uses BOOMERANG_DATA_DIR and never touches the home directories", () => {
    const h = home(); const { lines, log } = collect();
    mkdirSync(join(h, ".panorama"));
    expect(resolveDataDir({ env: { BOOMERANG_DATA_DIR: "/elsewhere/data" }, home: h, log })).toBe("/elsewhere/data");
    expect(existsSync(join(h, ".panorama"))).toBe(true);
    expect(lines).toEqual([]);
  });

  it("falls back to PANORAMA_DATA_DIR with one deprecation line", () => {
    const h = home(); const { lines, log } = collect();
    expect(resolveDataDir({ env: { PANORAMA_DATA_DIR: "/old/data" }, home: h, log })).toBe("/old/data");
    expect(lines).toEqual(["PANORAMA_DATA_DIR is deprecated; use BOOMERANG_DATA_DIR"]);
  });

  it("prefers the new name when both are set, without a deprecation line", () => {
    const { lines, log } = collect();
    expect(resolveDataDir({ env: { BOOMERANG_DATA_DIR: "/new", PANORAMA_DATA_DIR: "/old" }, home: home(), log })).toBe("/new");
    expect(lines).toEqual([]);
  });
});

describe("allowFastKdf", () => {
  it("reads BOOMERANG_ALLOW_FAST_KDF, falling back to the old name with one deprecation line", async () => {
    const { allowFastKdf } = await import("./dataDir");
    const { lines, log } = collect();
    expect(allowFastKdf({ BOOMERANG_ALLOW_FAST_KDF: "1" }, log)).toBe(true);
    expect(allowFastKdf({}, log)).toBe(false);
    expect(lines).toEqual([]);
    expect(allowFastKdf({ PANORAMA_ALLOW_FAST_KDF: "1" }, log)).toBe(true);
    expect(lines).toEqual(["PANORAMA_ALLOW_FAST_KDF is deprecated; use BOOMERANG_ALLOW_FAST_KDF"]);
  });
});
