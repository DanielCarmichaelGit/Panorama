import { z } from "zod";
import { Scopes, ScopesSchema } from "./permissions";
import { EVIDENCE_KINDS, type LaneRequirement } from "./evidence";
import { FieldValueSchema, type FieldValue } from "./fields";

export const FAMILIES = ["coral", "sky", "lilac", "mint", "stone"] as const;
export type Family = (typeof FAMILIES)[number];

/** A colour is `#rrggbb`, any case on the way in, lower-case once stored (milestone 2c). */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const normalizeColor = (color: string): string => color.toLowerCase();

export const DEFAULT_LANES: { name: string; family: Family; setsNeedsHuman: boolean; isDone: boolean; evidenceRequirements: LaneRequirement[] }[] = [
  { name: "Backlog", family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
  { name: "Ready", family: "stone", setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
  { name: "In Progress", family: "sky", setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
  { name: "Eval", family: "lilac", setsNeedsHuman: false, isDone: false, evidenceRequirements: [] },
  { name: "Ready for Production", family: "mint", setsNeedsHuman: true, isDone: false, evidenceRequirements: [{ typeId: "et_eval_score", count: 1 }] },
  { name: "Done", family: "mint", setsNeedsHuman: false, isDone: true, evidenceRequirements: [{ typeId: "et_human_signoff", count: 1 }] },
];

export interface Actor {
  id: string;
  kind: "human" | "agent";
  name: string;
  publicKey: string;
  scopes: Scopes | null;
  status: "pending" | "active" | "revoked";
  lastSeen: string | null;
  currentTicketId: string | null;
  createdAt: string;
}

export interface Project { id: string; key: string; name: string; createdAt: string }

export interface Lane { id: string; projectId: string; name: string; position: number; family: Family; setsNeedsHuman: boolean; isDone: boolean; evidenceRequirements: LaneRequirement[] }

export interface Board { id: string; projectId: string; name: string; description: string | null; family: Family; position: number; createdAt: string }

export interface Epic {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  family: Family;
  color: string | null;
  position: number;
  archived: boolean;
  createdAt: string;
}

export interface Tag {
  id: string;
  projectId: string;
  name: string;
  family: Family;
  color: string | null;
  archived: boolean;
  createdAt: string;
}

export interface Ticket {
  id: string;
  projectId: string;
  boardId: string;
  number: number;
  key: string;
  title: string;
  laneId: string;
  position: number;
  epicId: string | null;
  tagIds: string[];
  successCriteria: string;
  fields: Record<string, FieldValue>;
  flags: string[];
  assigneeId: string | null;
  startDate: string | null;
  dueDate: string | null;
  metadata: Record<string, unknown>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Comment { id: string; ticketId: string; actorId: string; body: string; attachmentIds: string[]; createdAt: string }

export interface Attachment {
  id: string;
  ticketId: string;
  commentId: string | null;
  actorId: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

const hex = (n: number) => z.string().regex(new RegExp(`^[0-9a-f]{${n}}$`));
const hex32 = hex(32);
const hex64 = hex(64);
const hex128 = hex(128);
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const colorField = z.string().regex(HEX_COLOR, "a colour is #rrggbb").transform(normalizeColor);

const argonSchema = z.object({
  iterations: z.number().int().positive(),
  memorySize: z.number().int().positive(),
  parallelism: z.number().int().positive(),
});

export const SetupInput = z.object({
  publicKey: hex64,
  kdfSalt: hex32,
  argon: argonSchema,
  encryption: z.boolean(),
  dbKey: hex64.nullable(),
});
export type SetupInput = z.infer<typeof SetupInput>;

export const UnlockInput = z.object({ dbKey: hex64 });
export type UnlockInput = z.infer<typeof UnlockInput>;

export const RegisterAgentInput = z.object({
  name: z.string().min(1).max(60),
  publicKey: hex64,
});
export type RegisterAgentInput = z.infer<typeof RegisterAgentInput>;

export const ApproveAgentInput = z.object({ scopes: ScopesSchema });
export type ApproveAgentInput = z.infer<typeof ApproveAgentInput>;

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(80),
  key: z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const CreateTicketInput = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  boardId: z.string().min(1).optional(),
  laneId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  epicId: z.string().min(1).optional(),
  tagIds: z.array(z.string().min(1)).max(20).optional(),
  successCriteria: z.string().max(20000).optional(),
  fields: z.record(FieldValueSchema).optional(),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInput>;

export const CreateBoardInput = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    family: z.enum(FAMILIES).optional(),
  })
  .strict();
export type CreateBoardInput = z.infer<typeof CreateBoardInput>;

export const CreateEpicInput = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    family: z.enum(FAMILIES).optional(),
    color: colorField.optional(),
  })
  .strict();
export type CreateEpicInput = z.infer<typeof CreateEpicInput>;

export const UpdateEpicInput = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(500).nullable().optional(),
    family: z.enum(FAMILIES).optional(),
    color: colorField.nullable().optional(),
    archived: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
export type UpdateEpicInput = z.infer<typeof UpdateEpicInput>;

const tagName = z.string().min(1).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u);

export const CreateTagInput = z
  .object({
    projectId: z.string().min(1),
    name: tagName,
    family: z.enum(FAMILIES).optional(),
    color: colorField.optional(),
  })
  .strict();
export type CreateTagInput = z.infer<typeof CreateTagInput>;

export const UpdateTagInput = z
  .object({
    name: tagName.optional(),
    family: z.enum(FAMILIES).optional(),
    color: colorField.nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
export type UpdateTagInput = z.infer<typeof UpdateTagInput>;

// Lanes are added and removed, never renamed: the name is what agents match on and what the
// event history records, so UpdateLaneInput carries no name (milestone 2c, spec section 3).
export const CreateLaneInput = z
  .object({
    name: z.string().min(1).max(40),
    family: z.enum(FAMILIES).default("stone"),
    setsNeedsHuman: z.boolean().default(false),
    isDone: z.boolean().default(false),
  })
  .strict();
export type CreateLaneInput = z.infer<typeof CreateLaneInput>;

export const UpdateLaneInput = z
  .object({
    family: z.enum(FAMILIES).optional(),
    setsNeedsHuman: z.boolean().optional(),
    isDone: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
export type UpdateLaneInput = z.infer<typeof UpdateLaneInput>;

export const LaneOrderInput = z.object({ ids: z.array(z.string().min(1)).min(1) }).strict();
export type LaneOrderInput = z.infer<typeof LaneOrderInput>;

// A threshold only means something to eval_score (see evaluateEvidence), so any other kind
// refuses one rather than silently carrying a number the gate would never read.
export const CreateEvidenceTypeInput = z
  .object({
    name: z.string().min(1).max(60),
    kind: z.enum(EVIDENCE_KINDS),
    params: z.object({ threshold: z.number().min(0).max(1).optional() }).strict().optional(),
    humanOnly: z.boolean().default(false),
    needsAttachment: z.boolean().default(false),
  })
  .strict()
  .refine((o) => o.params?.threshold === undefined || o.kind === "eval_score", { message: "Only an eval_score type takes a threshold", path: ["params", "threshold"] });
export type CreateEvidenceTypeInput = z.infer<typeof CreateEvidenceTypeInput>;

export const UpdateTicketInput = z
  .object({
    title: z.string().min(1).max(200).optional(),
    startDate: dateField.optional(),
    dueDate: dateField.optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    epicId: z.string().min(1).nullable().optional(),
    tagIds: z.array(z.string().min(1)).max(20).optional(),
    successCriteria: z.string().max(20000).optional(),
    fields: z.record(FieldValueSchema).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, "empty patch");
export type UpdateTicketInput = z.infer<typeof UpdateTicketInput>;

export const MoveTicketInput = z.object({ laneId: z.string().min(1) });
export type MoveTicketInput = z.infer<typeof MoveTicketInput>;

export const FlagInput = z.object({
  flag: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  on: z.boolean(),
});
export type FlagInput = z.infer<typeof FlagInput>;

// The owner signs the text "<seq>:<headHash>", so a signature cannot be moved to a
// different point in the chain. The server checks seq against the current last seq.
export const CheckpointInput = z.object({ seq: z.number().int().positive(), headHash: hex64, signature: hex128 });
export type CheckpointInput = z.infer<typeof CheckpointInput>;

export const AddCommentInput = z
  .object({
    ticketId: z.string().min(1),
    body: z.string().min(1).max(20000),
    attachmentIds: z.array(z.string().min(1)).max(20).optional(),
  })
  .strict();
export type AddCommentInput = z.infer<typeof AddCommentInput>;

export const AddEvidenceInput = z
  .object({
    ticketId: z.string().min(1),
    typeId: z.string().min(1),
    payload: z.record(z.unknown()),
    attachmentId: z.string().min(1).nullable().optional(),
    commentId: z.string().min(1).nullable().optional(),
  })
  .strict();
export type AddEvidenceInput = z.infer<typeof AddEvidenceInput>;

export const LaneRequirementsInput = z
  .object({
    requirements: z.array(z.object({ typeId: z.string().min(1), count: z.number().int().min(1).max(20) }).strict()).max(20),
  })
  .strict();
export type LaneRequirementsInput = z.infer<typeof LaneRequirementsInput>;
