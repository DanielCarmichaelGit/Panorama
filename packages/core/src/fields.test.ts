import { describe, expect, it } from "vitest";
import { FIELD_KINDS, FieldDefinitionInput, FieldValueSchema, UpdateFieldInput, validateFieldValues, type FieldDefinition } from "./index";

const def = (over: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: "fd1",
  projectId: "p1",
  name: "Severity",
  key: "severity",
  kind: "select",
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ],
  required: false,
  position: 0,
  archived: false,
  createdAt: "2026-09-24T00:00:00.000Z",
  ...over,
});

describe("FieldDefinitionInput", () => {
  it("requires non-empty options for a select field", () => {
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Severity", key: "severity", kind: "select", options: [{ value: "low", label: "Low" }] }).success).toBe(true);
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Severity", key: "severity", kind: "select" }).success).toBe(false);
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Severity", key: "severity", kind: "select", options: [] }).success).toBe(false);
  });
  it("rejects options on a non-select field", () => {
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Notes", key: "notes", kind: "text", options: [{ value: "a", label: "A" }] }).success).toBe(false);
  });
  it("rejects an empty options array on a non-select field", () => {
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Notes", key: "notes", kind: "text", options: [] }).success).toBe(false);
  });
  it("accepts a text field with no options and defaults required to false", () => {
    const parsed = FieldDefinitionInput.safeParse({ projectId: "p1", name: "Notes", key: "notes", kind: "text" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.required).toBe(false);
  });
  it("rejects a key that does not match the slug pattern", () => {
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Notes", key: "Notes", kind: "text" }).success).toBe(false);
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Notes", key: "1notes", kind: "text" }).success).toBe(false);
  });
});

describe("file kind", () => {
  it("is one of the kinds, takes no options, and its value schema accepts {attachmentId} or null only", () => {
    expect(FIELD_KINDS).toContain("file");
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Spec", key: "spec", kind: "file" }).success).toBe(true);
    expect(FieldDefinitionInput.safeParse({ projectId: "p1", name: "Spec", key: "spec", kind: "file", options: [{ value: "a", label: "A" }] }).success).toBe(false);
    expect(FieldValueSchema.safeParse({ attachmentId: "att1" }).success).toBe(true);
    expect(FieldValueSchema.safeParse(null).success).toBe(true);
    expect(FieldValueSchema.safeParse({ attachmentId: "" }).success).toBe(false);
    expect(FieldValueSchema.safeParse({ attachmentId: "att1", filename: "x" }).success).toBe(false);
    expect(FieldValueSchema.safeParse({}).success).toBe(false);
  });
});

describe("UpdateFieldInput", () => {
  it("rejects an empty patch", () => {
    expect(UpdateFieldInput.safeParse({}).success).toBe(false);
  });
  it("refuses an empty options list on a patch", () => {
    expect(UpdateFieldInput.safeParse({ options: [] }).success).toBe(false);
    expect(UpdateFieldInput.safeParse({ options: [{ value: "a", label: "A" }] }).success).toBe(true);
  });
  it("accepts a single-field patch", () => {
    expect(UpdateFieldInput.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateFieldInput.safeParse({ position: 3 }).success).toBe(true);
  });
});

describe("validateFieldValues", () => {
  const selectDefs = [def()];

  it("accepts a select value that is one of the options", () => {
    expect(validateFieldValues(selectDefs, { severity: "low" }, { requireAll: false })).toEqual({ ok: true });
  });
  it("rejects a select value that is not one of the options", () => {
    expect(validateFieldValues(selectDefs, { severity: "medium" }, { requireAll: false }).ok).toBe(false);
  });
  it("rejects a number given as a string", () => {
    const numberDefs = [def({ key: "points", kind: "number", options: [] })];
    expect(validateFieldValues(numberDefs, { points: "5" }, { requireAll: false }).ok).toBe(false);
  });
  it("accepts a finite number", () => {
    const numberDefs = [def({ key: "points", kind: "number", options: [] })];
    expect(validateFieldValues(numberDefs, { points: 5 }, { requireAll: false })).toEqual({ ok: true });
  });
  it("rejects a malformed date and accepts YYYY-MM-DD", () => {
    const dateDefs = [def({ key: "eta", kind: "date", options: [] })];
    expect(validateFieldValues(dateDefs, { eta: "09/24/2026" }, { requireAll: false }).ok).toBe(false);
    expect(validateFieldValues(dateDefs, { eta: "2026-09-24" }, { requireAll: false })).toEqual({ ok: true });
  });
  it("requires a boolean for checkbox", () => {
    const cbDefs = [def({ key: "urgent", kind: "checkbox", options: [] })];
    expect(validateFieldValues(cbDefs, { urgent: "yes" }, { requireAll: false }).ok).toBe(false);
    expect(validateFieldValues(cbDefs, { urgent: true }, { requireAll: false })).toEqual({ ok: true });
  });
  it("rejects text longer than 2000 characters", () => {
    const textDefs = [def({ key: "notes", kind: "text", options: [] })];
    expect(validateFieldValues(textDefs, { notes: "x".repeat(2000) }, { requireAll: false })).toEqual({ ok: true });
    expect(validateFieldValues(textDefs, { notes: "x".repeat(2001) }, { requireAll: false }).ok).toBe(false);
  });
  it("treats null as clearing any kind of field", () => {
    expect(validateFieldValues(selectDefs, { severity: null }, { requireAll: false })).toEqual({ ok: true });
  });
  it("flags an unknown key", () => {
    const result = validateFieldValues(selectDefs, { bogus: "x" }, { requireAll: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual([{ key: "bogus", message: expect.any(String) }]);
  });
  it("ignores archived defs, treating their keys as unknown", () => {
    const archivedDefs = [def({ archived: true })];
    expect(validateFieldValues(archivedDefs, { severity: "low" }, { requireAll: false }).ok).toBe(false);
  });
  it("requires every required field to be present and non-null only when requireAll is set", () => {
    const requiredDefs = [def({ required: true })];
    expect(validateFieldValues(requiredDefs, {}, { requireAll: true }).ok).toBe(false);
    expect(validateFieldValues(requiredDefs, { severity: null }, { requireAll: true }).ok).toBe(false);
    expect(validateFieldValues(requiredDefs, {}, { requireAll: false })).toEqual({ ok: true });
    expect(validateFieldValues(requiredDefs, { severity: "low" }, { requireAll: true })).toEqual({ ok: true });
  });
  it("accepts {attachmentId} for a file field, rejects any other shape, and counts null or missing as empty", () => {
    const file = def({ key: "spec", kind: "file", options: [], required: true });
    expect(validateFieldValues([file], { spec: { attachmentId: "att1" } }, { requireAll: true })).toEqual({ ok: true });
    expect(validateFieldValues([file], { spec: null }, { requireAll: false })).toEqual({ ok: true });
    expect(validateFieldValues([file], { spec: "att1" }, { requireAll: false })).toEqual({ ok: false, issues: [{ key: "spec", message: "must be an attachment reference {attachmentId}" }] });
    expect(validateFieldValues([file], { spec: { attachmentId: "" } }, { requireAll: false })).toEqual({ ok: false, issues: [{ key: "spec", message: "must be an attachment reference {attachmentId}" }] });
    expect(validateFieldValues([file], { spec: { attachmentId: "att1", extra: 1 } as never }, { requireAll: false }).ok).toBe(false);
    expect(validateFieldValues([file], {}, { requireAll: true })).toEqual({ ok: false, issues: [{ key: "spec", message: "is required" }] });
    expect(validateFieldValues([file], { spec: null }, { requireAll: true })).toEqual({ ok: false, issues: [{ key: "spec", message: "is required" }] });
  });
  it("does not require an archived field even when requireAll is set", () => {
    const requiredArchivedDefs = [def({ required: true, archived: true })];
    expect(validateFieldValues(requiredArchivedDefs, {}, { requireAll: true })).toEqual({ ok: true });
  });
});
