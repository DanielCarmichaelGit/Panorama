import { describe, expect, it } from "vitest";
import { CheckpointInput, CreateProjectInput, DEFAULT_LANES, UpdateTicketInput } from "./index";

describe("CreateProjectInput", () => {
  it("accepts an uppercase project key and rejects a lowercase one", () => {
    expect(CreateProjectInput.safeParse({ name: "Panorama", key: "PAN" }).success).toBe(true);
    expect(CreateProjectInput.safeParse({ name: "Panorama", key: "pan" }).success).toBe(false);
  });
});

describe("UpdateTicketInput", () => {
  it("rejects an empty patch", () => {
    expect(UpdateTicketInput.safeParse({}).success).toBe(false);
  });
  it("rejects an unknown key", () => {
    expect(UpdateTicketInput.safeParse({ title: "New title", bogus: 1 }).success).toBe(false);
  });
  it("accepts a single-field patch", () => {
    expect(UpdateTicketInput.safeParse({ title: "New title" }).success).toBe(true);
  });
});

describe("hex validators", () => {
  const validHead = "a".repeat(64);
  const validSig = "b".repeat(128);

  it("accept a correctly sized lowercase hex string", () => {
    expect(CheckpointInput.safeParse({ headHash: validHead, signature: validSig }).success).toBe(true);
  });
  it("reject uppercase hex", () => {
    expect(CheckpointInput.safeParse({ headHash: validHead.toUpperCase(), signature: validSig }).success).toBe(false);
  });
  it("reject the wrong length", () => {
    expect(CheckpointInput.safeParse({ headHash: validHead.slice(1), signature: validSig }).success).toBe(false);
  });
});

describe("DEFAULT_LANES", () => {
  it("has six lanes, with Ready for Production needing human and Done marked done", () => {
    expect(DEFAULT_LANES).toHaveLength(6);
    expect(DEFAULT_LANES.find((l) => l.name === "Ready for Production")?.setsNeedsHuman).toBe(true);
    expect(DEFAULT_LANES.find((l) => l.name === "Done")?.isDone).toBe(true);
    expect(DEFAULT_LANES.filter((l) => l.setsNeedsHuman)).toHaveLength(1);
    expect(DEFAULT_LANES.filter((l) => l.isDone)).toHaveLength(1);
  });
});
