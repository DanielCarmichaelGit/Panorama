// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ANCHOR_KEY, INTRO_KEY, SIDEBAR_KEY, migrateStorageKeys } from "./storage";

describe("migrateStorageKeys", () => {
  beforeEach(() => localStorage.clear());

  it("names the keys with the bm prefix", () => {
    expect([ANCHOR_KEY, SIDEBAR_KEY, INTRO_KEY]).toEqual(["bm.anchor", "bm.sidebar", "bm.settingsIntro"]);
  });

  it("copies the old anchor to the new key and removes every pan key", () => {
    localStorage.setItem("pan.anchor", '{"seq":3,"headHash":"ab"}');
    localStorage.setItem("pan.sidebar", "1");
    localStorage.setItem("pan.settingsIntro", "hidden");
    migrateStorageKeys();
    expect(localStorage.getItem("bm.anchor")).toBe('{"seq":3,"headHash":"ab"}');
    expect(localStorage.getItem("pan.anchor")).toBeNull();
    expect(localStorage.getItem("pan.sidebar")).toBeNull();
    expect(localStorage.getItem("pan.settingsIntro")).toBeNull();
    expect(localStorage.getItem("bm.sidebar")).toBeNull();
  });

  it("keeps an existing new anchor over the old one", () => {
    localStorage.setItem("bm.anchor", "new");
    localStorage.setItem("pan.anchor", "old");
    migrateStorageKeys();
    expect(localStorage.getItem("bm.anchor")).toBe("new");
    expect(localStorage.getItem("pan.anchor")).toBeNull();
  });

  it("is a no-op when nothing is stored", () => {
    migrateStorageKeys();
    expect(localStorage.length).toBe(0);
  });
});
