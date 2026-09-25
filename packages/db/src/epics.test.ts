import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as d from "./index";

const NOW = "2026-09-24T10:00:00.000Z";

function world() {
  const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null);
  d.migrate(db);
  const { project } = d.createProject(db, { name: "Boomerang", key: "PAN" }, NOW);
  return { db, project };
}

describe("epics", () => {
  it("creates an epic with an incrementing position and a default family of stone", () => {
    const { db, project } = world();
    const e1 = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
    expect(e1).toMatchObject({ projectId: project.id, name: "Onboarding", description: null, family: "stone", position: 1, archived: false });
    const e2 = d.createEpic(db, { projectId: project.id, name: "Billing", description: "Payments work", family: "coral" }, NOW);
    expect(e2).toMatchObject({ description: "Payments work", family: "coral", position: 2 });
    expect(d.listEpics(db, project.id).map((e) => e.id)).toEqual([e1.id, e2.id]);
  });

  it("updates an epic and reads it back", () => {
    const { db, project } = world();
    const e = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
    const updated = d.updateEpic(db, e.id, { name: "Activation", family: "mint" }, NOW);
    expect(updated).toMatchObject({ name: "Activation", family: "mint" });
    expect(d.getEpic(db, e.id)).toEqual(updated);
  });

  it("stores a colour, defaults it to null, and lets an update clear it", () => {
    const { db, project } = world();
    const plain = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
    expect(plain.color).toBeNull();
    const coloured = d.createEpic(db, { projectId: project.id, name: "Billing", color: "#d3c8f4" }, NOW);
    expect(coloured.color).toBe("#d3c8f4");
    expect(d.updateEpic(db, coloured.id, { color: "#bfe8cf" }, NOW).color).toBe("#bfe8cf");
    expect(d.updateEpic(db, coloured.id, { color: null }, NOW).color).toBeNull();
    expect(d.getEpic(db, coloured.id)!.color).toBeNull();
  });

  it("hides archived epics unless includeArchived is set", () => {
    const { db, project } = world();
    const e1 = d.createEpic(db, { projectId: project.id, name: "Onboarding" }, NOW);
    const e2 = d.createEpic(db, { projectId: project.id, name: "Billing" }, NOW);
    d.updateEpic(db, e1.id, { archived: true }, NOW);
    expect(d.listEpics(db, project.id).map((e) => e.id)).toEqual([e2.id]);
    expect(d.listEpics(db, project.id, { includeArchived: true }).map((e) => e.id).sort()).toEqual([e1.id, e2.id].sort());
  });
});
