import { z } from "zod";
import { Scopes, ScopesSchema } from "./permissions";
import type { LaneRequirement } from "./evidence";

export const FAMILIES = ["coral", "sky", "lilac", "mint", "stone"] as const;
export type Family = (typeof FAMILIES)[number];

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
  createdAt: string;
}

export interface Project { id: string; key: string; name: string; createdAt: string }

export interface Lane { id: string; projectId: string; name: string; position: number; family: Family; setsNeedsHuman: boolean; isDone: boolean; evidenceRequirements: LaneRequirement[] }

export interface Ticket {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  laneId: string;
  position: number;
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
  laneId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateTicketInput = z.infer<typeof CreateTicketInput>;

export const UpdateTicketInput = z
  .object({
    title: z.string().min(1).max(200).optional(),
    startDate: dateField.optional(),
    dueDate: dateField.optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
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
