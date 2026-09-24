import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as d from "./index";

const NOW = "2026-09-24T10:00:00.000Z";

function world() {
  const db = d.openDatabase(join(mkdtempSync(join(tmpdir(), "pan-")), "p.db"), null);
  d.migrate(db);
  const { project } = d.createProject(db, { name: "Panorama", key: "PAN" }, NOW);
  const t = d.createTicket(db, { projectId: project.id, title: "x" }, NOW);
  return { db, project, t };
}

describe("fields", () => {
  it("creates a field with an incrementing position", () => {
    const { db, project } = world();
    const f1 = d.createField(db, { projectId: project.id, name: "Severity", key: "severity", kind: "text" }, NOW);
    expect(f1).toMatchObject({ projectId: project.id, name: "Severity", key: "severity", kind: "text", options: [], required: false, position: 1, archived: false });
    const f2 = d.createField(db, { projectId: project.id, name: "Points", key: "points", kind: "number", required: true }, NOW);
    expect(f2).toMatchObject({ position: 2, required: true });
  });

  it("refuses a duplicate key within the same project", () => {
    const { db, project } = world();
    d.createField(db, { projectId: project.id, name: "Severity", key: "severity", kind: "text" }, NOW);
    expect(() => d.createField(db, { projectId: project.id, name: "Sev again", key: "severity", kind: "text" }, NOW)).toThrow("duplicate_key");
  });

  it("stores select options and reads them back", () => {
    const { db, project } = world();
    const options = [{ value: "low", label: "Low" }, { value: "high", label: "High" }];
    const f = d.createField(db, { projectId: project.id, name: "Priority", key: "priority", kind: "select", options }, NOW);
    expect(f.options).toEqual(options);
    expect(d.getField(db, f.id)!.options).toEqual(options);
  });

  it("sets and reads ticket field values, overwrites on a second set, and null removes it", () => {
    const { db, project, t } = world();
    const f = d.createField(db, { projectId: project.id, name: "Severity", key: "severity", kind: "text" }, NOW);
    d.setTicketFields(db, t.id, { [f.key]: "high" });
    expect(d.getTicketFields(db, t.id)).toEqual({ severity: "high" });
    d.setTicketFields(db, t.id, { [f.key]: "low" });
    expect(d.getTicketFields(db, t.id)).toEqual({ severity: "low" });
    d.setTicketFields(db, t.id, { [f.key]: null });
    expect(d.getTicketFields(db, t.id)).toEqual({});
  });

  it("ignores unknown keys when setting ticket field values", () => {
    const { db, t } = world();
    d.setTicketFields(db, t.id, { made_up: "x" });
    expect(d.getTicketFields(db, t.id)).toEqual({});
  });

  it("hides archived field values from getTicketFields but keeps the stored value", () => {
    const { db, project, t } = world();
    const f = d.createField(db, { projectId: project.id, name: "Severity", key: "severity", kind: "text" }, NOW);
    d.setTicketFields(db, t.id, { [f.key]: "high" });
    d.updateField(db, f.id, { archived: true });
    expect(d.getTicketFields(db, t.id)).toEqual({});
    // Reactivating the definition brings the retained value back, proving it was never deleted.
    d.updateField(db, f.id, { archived: false });
    expect(d.getTicketFields(db, t.id)).toEqual({ severity: "high" });
  });
});
