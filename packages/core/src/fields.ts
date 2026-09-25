import { z } from "zod";

export const FIELD_KINDS = ["text", "number", "date", "select", "checkbox", "file"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** A file field holds one of the ticket's own attachments by id (milestone 2c, task 5); the
 *  server checks the attachment belongs to the ticket, core only checks the shape. */
export interface FileFieldValue { attachmentId: string }
export type FieldValue = string | number | boolean | FileFieldValue | null;

export const isFileValue = (v: unknown): v is FileFieldValue =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as FileFieldValue).attachmentId === "string" && (v as FileFieldValue).attachmentId.length > 0;

export interface FieldDefinition {
  id: string;
  projectId: string;
  name: string;
  key: string;
  kind: FieldKind;
  options: { value: string; label: string }[];
  required: boolean;
  position: number;
  archived: boolean;
  createdAt: string;
}

export const FileFieldValueSchema = z.object({ attachmentId: z.string().min(1) }).strict();
export const FieldValueSchema = z.union([z.string(), z.number(), z.boolean(), FileFieldValueSchema, z.null()]);

const FieldOption = z.object({ value: z.string().min(1).max(60), label: z.string().min(1).max(60) }).strict();

export const FieldDefinitionInput = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(60),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    kind: z.enum(FIELD_KINDS),
    options: z.array(FieldOption).optional(),
    required: z.boolean().default(false),
  })
  .strict()
  .refine((o) => (o.kind === "select" ? o.options !== undefined && o.options.length > 0 : o.options === undefined), {
    message: "options are required and non-empty for a select field, and not allowed otherwise",
  });
export type FieldDefinitionInput = z.infer<typeof FieldDefinitionInput>;

export const UpdateFieldInput = z
  .object({
    name: z.string().min(1).max(60).optional(),
    options: z.array(FieldOption).optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
export type UpdateFieldInput = z.infer<typeof UpdateFieldInput>;

/**
 * Checks a set of ticket field values against their definitions. Unknown keys and archived
 * defs are both issues to report, except that an archived def is simply ignored rather than
 * matched, so a value keyed to it comes back as unknown. `null` clears a field regardless of
 * kind. With `requireAll`, every required, non-archived def must be present and non-null.
 */
export function validateFieldValues(
  defs: FieldDefinition[],
  values: Record<string, FieldValue>,
  opts: { requireAll: boolean }
): { ok: true } | { ok: false; issues: { key: string; message: string }[] } {
  const issues: { key: string; message: string }[] = [];
  const activeByKey = new Map(defs.filter((d) => !d.archived).map((d) => [d.key, d]));

  for (const [key, value] of Object.entries(values)) {
    const def = activeByKey.get(key);
    if (!def) {
      issues.push({ key, message: "unknown field" });
      continue;
    }
    if (value === null) continue;
    switch (def.kind) {
      case "text":
        if (typeof value !== "string" || value.length > 2000) issues.push({ key, message: "must be text up to 2000 characters" });
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) issues.push({ key, message: "must be a finite number" });
        break;
      case "date":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) issues.push({ key, message: "must be a date in YYYY-MM-DD format" });
        break;
      case "select":
        if (typeof value !== "string" || !def.options.some((o) => o.value === value)) issues.push({ key, message: "must be one of the field's options" });
        break;
      case "checkbox":
        if (typeof value !== "boolean") issues.push({ key, message: "must be true or false" });
        break;
      case "file":
        if (!isFileValue(value)) issues.push({ key, message: "must be an attachment reference {attachmentId}" });
        break;
    }
  }

  if (opts.requireAll) {
    for (const def of defs) {
      if (def.archived || !def.required) continue;
      const value = values[def.key];
      if (value === undefined || value === null) issues.push({ key: def.key, message: "is required" });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}
