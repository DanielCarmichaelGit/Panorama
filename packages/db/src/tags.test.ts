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
  const t = d.createTicket(db, { projectId: project.id, title: "x" }, NOW);
  return { db, project, t };
}

describe("tags", () => {
  it("creates a tag with a default family of stone", () => {
    const { db, project } = world();
    const tag = d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    expect(tag).toMatchObject({ projectId: project.id, name: "Bug", family: "stone", archived: false });
    expect(d.listTags(db, project.id).map((t) => t.id)).toEqual([tag.id]);
  });

  it("refuses a duplicate name in the same project, case-insensitively, but allows it in another project", () => {
    const { db, project } = world();
    d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    expect(() => d.createTag(db, { projectId: project.id, name: "bug" }, NOW)).toThrow("duplicate_tag");

    const { project: other } = d.createProject(db, { name: "Other", key: "OTH" }, NOW);
    const otherTag = d.createTag(db, { projectId: other.id, name: "Bug" }, NOW);
    expect(otherTag.name).toBe("Bug");
  });

  it("archives a tag and hides it from the default listing", () => {
    const { db, project } = world();
    const tag = d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    const archived = d.archiveTag(db, tag.id);
    expect(archived.archived).toBe(true);
    expect(d.listTags(db, project.id)).toEqual([]);
    expect(d.listTags(db, project.id, { includeArchived: true }).map((t) => t.id)).toEqual([tag.id]);
  });

  it("stores a colour on create and lets an update rename, recolour, and clear the colour", () => {
    const { db, project } = world();
    const tag = d.createTag(db, { projectId: project.id, name: "Bug", color: "#f6c1b4" }, NOW);
    expect(tag).toMatchObject({ name: "Bug", family: "stone", color: "#f6c1b4" });
    const renamed = d.updateTag(db, tag.id, { name: "Defect", family: "coral", color: "#b9ddf5" });
    expect(renamed).toMatchObject({ name: "Defect", family: "coral", color: "#b9ddf5" });
    expect(d.getTag(db, tag.id)).toEqual(renamed);
    expect(d.updateTag(db, tag.id, { color: null }).color).toBeNull();
  });

  it("refuses an update that renames a tag onto another tag's name", () => {
    const { db, project } = world();
    d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    const other = d.createTag(db, { projectId: project.id, name: "Urgent" }, NOW);
    expect(() => d.updateTag(db, other.id, { name: "bug" })).toThrow("duplicate_tag");
  });

  it("replaces a ticket's tag set", () => {
    const { db, project, t } = world();
    const bug = d.createTag(db, { projectId: project.id, name: "Bug" }, NOW);
    const urgent = d.createTag(db, { projectId: project.id, name: "Urgent" }, NOW);
    d.setTicketTags(db, t.id, [bug.id, urgent.id]);
    expect(d.listTicketTags(db, t.id).sort()).toEqual([bug.id, urgent.id].sort());
    d.setTicketTags(db, t.id, [urgent.id]);
    expect(d.listTicketTags(db, t.id)).toEqual([urgent.id]);
  });
});
