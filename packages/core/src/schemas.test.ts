import { describe, expect, it } from "vitest";
import { CheckpointInput, CreateEpicInput, CreateProjectInput, CreateTagInput, CreateTicketInput, DEFAULT_LANES, UpdateEpicInput, UpdateTicketInput } from "./index";

describe("CreateProjectInput", () => {
  it("accepts an uppercase project key and rejects a lowercase one", () => {
    expect(CreateProjectInput.safeParse({ name: "Panorama", key: "PAN" }).success).toBe(true);
    expect(CreateProjectInput.safeParse({ name: "Panorama", key: "pan" }).success).toBe(false);
    expect(CreateProjectInput.safeParse({ name: "Fire tower", key: "FIRE_TOWER" }).success).toBe(true);
    expect(CreateProjectInput.safeParse({ name: "x", key: "A".repeat(33) }).success).toBe(false);
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

describe("CreateEpicInput", () => {
  it("requires a name and accepts an optional description and family", () => {
    expect(CreateEpicInput.safeParse({ projectId: "p1", name: "Launch" }).success).toBe(true);
    expect(CreateEpicInput.safeParse({ projectId: "p1", name: "Launch", description: "x".repeat(500), family: "mint" }).success).toBe(true);
    expect(CreateEpicInput.safeParse({ projectId: "p1", name: "" }).success).toBe(false);
    expect(CreateEpicInput.safeParse({ projectId: "p1", name: "x".repeat(81) }).success).toBe(false);
    expect(CreateEpicInput.safeParse({ projectId: "p1", name: "Launch", description: "x".repeat(501) }).success).toBe(false);
  });
});

describe("UpdateEpicInput", () => {
  it("rejects an empty patch", () => {
    expect(UpdateEpicInput.safeParse({}).success).toBe(false);
  });
  it("accepts archived and a non-negative position, and rejects a negative one", () => {
    expect(UpdateEpicInput.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateEpicInput.safeParse({ position: 0 }).success).toBe(true);
    expect(UpdateEpicInput.safeParse({ position: -1 }).success).toBe(false);
  });
  it("allows clearing the description back to null", () => {
    expect(UpdateEpicInput.safeParse({ description: null }).success).toBe(true);
  });
});

describe("CreateTagInput", () => {
  it("accepts a name starting with a letter or number, and rejects an empty or leading-hyphen name", () => {
    expect(CreateTagInput.safeParse({ projectId: "p1", name: "Needs design" }).success).toBe(true);
    expect(CreateTagInput.safeParse({ projectId: "p1", name: "v2_api" }).success).toBe(true);
    expect(CreateTagInput.safeParse({ projectId: "p1", name: "" }).success).toBe(false);
    expect(CreateTagInput.safeParse({ projectId: "p1", name: "-lead" }).success).toBe(false);
    expect(CreateTagInput.safeParse({ projectId: "p1", name: "_lead" }).success).toBe(false);
  });
});

describe("CreateTicketInput ticket-model additions", () => {
  it("accepts an epic, tags, success criteria, and field values", () => {
    expect(
      CreateTicketInput.safeParse({
        projectId: "p1",
        title: "Fix bug",
        epicId: "e1",
        tagIds: ["t1", "t2"],
        successCriteria: "- [ ] repro fixed",
        fields: { severity: "high", points: 3, urgent: false, notes: null },
      }).success
    ).toBe(true);
  });
  it("rejects more than 20 tags", () => {
    expect(CreateTicketInput.safeParse({ projectId: "p1", title: "Fix bug", tagIds: Array.from({ length: 21 }, (_, i) => `t${i}`) }).success).toBe(false);
  });
});

describe("UpdateTicketInput ticket-model additions", () => {
  it("accepts clearing the epic and updating tags, success criteria, and fields", () => {
    expect(UpdateTicketInput.safeParse({ epicId: null }).success).toBe(true);
    expect(UpdateTicketInput.safeParse({ tagIds: ["t1"] }).success).toBe(true);
    expect(UpdateTicketInput.safeParse({ successCriteria: "- [ ] done" }).success).toBe(true);
    expect(UpdateTicketInput.safeParse({ fields: { severity: null } }).success).toBe(true);
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
