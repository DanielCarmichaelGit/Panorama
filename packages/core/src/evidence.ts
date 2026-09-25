import { z } from "zod";

export const EVIDENCE_KINDS = ["test_run", "pr_link", "eval_score", "screenshot", "human_signoff", "file", "custom"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceResult = "pass" | "fail" | "info";

export interface EvidenceType {
  id: string;
  name: string;
  kind: EvidenceKind;
  params: { threshold?: number };
  humanOnly: boolean;
  needsAttachment: boolean;
  createdAt: string;
}

export interface Evidence {
  id: string;
  ticketId: string;
  typeId: string;
  commentId: string | null;
  attachmentId: string | null;
  actorId: string;
  payload: Record<string, unknown>;
  result: EvidenceResult;
  createdAt: string;
}

/** `description` says what the evidence should show ("A markdown file explaining what needs
 *  to be done"); it travels with the gate so an agent refused at a lane knows what to provide. */
export interface LaneRequirement {
  typeId: string;
  count: number;
  description?: string;
}

export interface MissingRequirement {
  typeId: string;
  need: number;
  have: number;
  description?: string;
}

const note = z.string().max(2000).optional();
export const EvidencePayload: Record<EvidenceKind, z.ZodTypeAny> = {
  test_run: z.object({ passed: z.number().int().min(0), failed: z.number().int().min(0), output: z.string().max(20000).optional() }).strict(),
  pr_link: z.object({ url: z.string().url().max(2000).refine((u) => /^https?:\/\//i.test(u), "http(s) only"), title: z.string().max(200).optional() }).strict(),
  eval_score: z.object({ score: z.number().min(0).max(1), note }).strict(),
  screenshot: z.object({ note }).strict(),
  human_signoff: z.object({ note }).strict(),
  file: z.object({ note }).strict(),
  custom: z.object({ result: z.enum(["pass", "fail", "info"]), note }).strict(),
};

export function evaluateEvidence(type: Pick<EvidenceType, "kind" | "params">, payload: unknown): EvidenceResult {
  const p = EvidencePayload[type.kind].parse(payload) as any;
  switch (type.kind) {
    case "test_run":
      return p.failed === 0 ? "pass" : "fail";
    case "eval_score":
      return p.score >= (type.params.threshold ?? 0.9) ? "pass" : "fail";
    case "human_signoff":
      return "pass";
    case "custom":
      return p.result;
    default:
      return "info";
  }
}

export function checkGate(requirements: LaneRequirement[], evidence: Pick<Evidence, "typeId" | "result">[]): MissingRequirement[] {
  return requirements
    .map((r): MissingRequirement => ({
      typeId: r.typeId,
      need: r.count,
      have: evidence.filter((e) => e.typeId === r.typeId && e.result !== "fail").length,
      ...(r.description ? { description: r.description } : {}),
    }))
    .filter((r) => r.have < r.need);
}

export const DEFAULT_EVIDENCE_TYPES: Omit<EvidenceType, "createdAt">[] = [
  { id: "et_test_run", name: "Test run", kind: "test_run", params: {}, humanOnly: false, needsAttachment: false },
  { id: "et_pr_link", name: "Pull request", kind: "pr_link", params: {}, humanOnly: false, needsAttachment: false },
  { id: "et_eval_score", name: "Eval score", kind: "eval_score", params: { threshold: 0.9 }, humanOnly: false, needsAttachment: false },
  { id: "et_screenshot", name: "Screenshot", kind: "screenshot", params: {}, humanOnly: false, needsAttachment: true },
  { id: "et_human_signoff", name: "Human sign-off", kind: "human_signoff", params: {}, humanOnly: true, needsAttachment: false },
  { id: "et_file", name: "File", kind: "file", params: {}, humanOnly: false, needsAttachment: true },
];
