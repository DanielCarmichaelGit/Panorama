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
  const a = d.createTicket(db, { projectId: project.id, title: "A" }, NOW);
  const b = d.createTicket(db, { projectId: project.id, title: "B" }, NOW);
  const c = d.createTicket(db, { projectId: project.id, title: "C" }, NOW);
  return { db, project, a, b, c };
}

describe("links", () => {
  it("adds a link and lists it from either ticket", () => {
    const { db, project, a, b } = world();
    const link = d.addLink(db, { projectId: project.id, fromId: a.id, toId: b.id, kind: "blocks" }, NOW);
    expect(link).toMatchObject({ projectId: project.id, fromId: a.id, toId: b.id, kind: "blocks" });
    expect(d.listLinks(db, a.id).map((l) => l.id)).toEqual([link.id]);
    expect(d.listLinks(db, b.id).map((l) => l.id)).toEqual([link.id]);
  });

  it("refuses a ticket linking to itself", () => {
    const { db, project, a } = world();
    expect(() => d.addLink(db, { projectId: project.id, fromId: a.id, toId: a.id, kind: "relates" }, NOW)).toThrow("self_link");
  });

  it("refuses a duplicate link of the same kind between the same two tickets", () => {
    const { db, project, a, b } = world();
    d.addLink(db, { projectId: project.id, fromId: a.id, toId: b.id, kind: "relates" }, NOW);
    expect(() => d.addLink(db, { projectId: project.id, fromId: a.id, toId: b.id, kind: "relates" }, NOW)).toThrow("duplicate_link");
  });

  it("refuses a direct block cycle: A blocks B, then B blocks A", () => {
    const { db, project, a, b } = world();
    d.addLink(db, { projectId: project.id, fromId: a.id, toId: b.id, kind: "blocks" }, NOW);
    expect(() => d.addLink(db, { projectId: project.id, fromId: b.id, toId: a.id, kind: "blocks" }, NOW)).toThrow("link_cycle");
  });

  it("refuses a longer block cycle: A blocks B, B blocks C, then C blocks A", () => {
    const { db, project, a, b, c } = world();
    d.addLink(db, { projectId: project.id, fromId: a.id, toId: b.id, kind: "blocks" }, NOW);
    d.addLink(db, { projectId: project.id, fromId: b.id, toId: c.id, kind: "blocks" }, NOW);
    expect(() => d.addLink(db, { projectId: project.id, fromId: c.id, toId: a.id, kind: "blocks" }, NOW)).toThrow("link_cycle");
  });

  it("removes a link", () => {
    const { db, project, a, b } = world();
    const link = d.addLink(db, { projectId: project.id, fromId: a.id, toId: b.id, kind: "relates" }, NOW);
    d.removeLink(db, link.id);
    expect(d.listLinks(db, a.id)).toEqual([]);
  });
});
