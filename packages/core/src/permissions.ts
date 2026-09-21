import { z } from "zod";

export const AGENT_ACTIONS = ["read", "ticket.create", "ticket.update", "ticket.move", "flag.set"] as const;
export const HUMAN_ACTIONS = ["project.create", "agent.approve", "agent.revoke", "ticket.archive", "flag.clear_needs_human", "checkpoint.create", "lock"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];
export type Action = AgentAction | (typeof HUMAN_ACTIONS)[number];

export const ScopesSchema = z.object({ projects: z.union([z.literal("*"), z.array(z.string().min(1))]), actions: z.array(z.enum(AGENT_ACTIONS)) }).strict();
export type Scopes = z.infer<typeof ScopesSchema>;

export function can(actor: { kind: "human" | "agent"; status: string; scopes: Scopes | null }, action: Action, projectId?: string): boolean {
  if (actor.status !== "active") return false;
  if (actor.kind === "human") return true;
  if (!(AGENT_ACTIONS as readonly string[]).includes(action) || !actor.scopes) return false;
  if (!actor.scopes.actions.includes(action as AgentAction)) return false;
  if (projectId === undefined) return true;
  return actor.scopes.projects === "*" || actor.scopes.projects.includes(projectId);
}
