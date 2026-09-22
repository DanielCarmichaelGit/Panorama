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
    expect(CheckpointInput.safeParse({ seq: 4, headHash: validHead, signature: validSig }).success).toBe(true);
  });
  it("reject uppercase hex", () => {
    expect(CheckpointInput.safeParse({ seq: 4, headHash: validHead.toUpperCase(), signature: validSig }).success).toBe(false);
  });
  it("reject the wrong length", () => {
    expect(CheckpointInput.safeParse({ seq: 4, headHash: validHead.slice(1), signature: validSig }).success).toBe(false);
  });
});

describe("CheckpointInput", () => {
  const validHead = "a".repeat(64);
  const validSig = "b".repeat(128);

  it("binds a checkpoint to a positive integer seq", () => {
    expect(CheckpointInput.safeParse({ headHash: validHead, signature: validSig }).success).toBe(false);
    expect(CheckpointInput.safeParse({ seq: 0, headHash: validHead, signature: validSig }).success).toBe(false);
    expect(CheckpointInput.safeParse({ seq: 1.5, headHash: validHead, signature: validSig }).success).toBe(false);
    expect(CheckpointInput.safeParse({ seq: 1, headHash: validHead, signature: validSig }).success).toBe(true);
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
  it("gates Ready for Production on an eval score and Done on a human sign-off, others ungated", () => {
    expect(DEFAULT_LANES.find((l) => l.name === "Ready for Production")?.evidenceRequirements).toEqual([{ typeId: "et_eval_score", count: 1 }]);
    expect(DEFAULT_LANES.find((l) => l.name === "Done")?.evidenceRequirements).toEqual([{ typeId: "et_human_signoff", count: 1 }]);
    for (const l of DEFAULT_LANES.filter((l) => l.name !== "Ready for Production" && l.name !== "Done")) {
      expect(l.evidenceRequirements).toEqual([]);
    }
  });
});
