/** What the server said no with: its status, its code, and its sentence-case message. */
export class BoomerangError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "BoomerangError";
  }
}

/** A refusal raised on this side before any request went out (a name that matches nothing, say). */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRefusal";
  }
}

export interface GateEntry { typeId: string; name: string; need: number; have: number; description?: string }

/** One line per unmet requirement: what is missing, how many, and what the evidence should show. */
export function describeGate(message: string, missing: GateEntry[]): string {
  const lines = missing.map((m) => {
    if (m.typeId === "blocked_by") return `- ${m.name}: that ticket must reach a done lane first, or the owner must remove the link`;
    const count = `${m.have} of ${m.need}`;
    return `- ${m.name} (${count})${m.description ? `. It should show: ${m.description}` : ""}`;
  });
  return [message, ...lines].join("\n");
}

const isNetworkError = (e: unknown) =>
  e instanceof TypeError && /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(`${e.message} ${(e as { cause?: { code?: string } }).cause?.code ?? ""}`);

/**
 * Turns whatever a call threw into the sentence an agent reads. A locked server, an agent
 * still waiting for approval, and a gate refusal each get a fixed shape; anything else
 * carries the server's own message.
 */
export function describeError(e: unknown, ctx: { name: string; url: string; keyFile: string }): string {
  if (e instanceof ToolRefusal) return e.message;
  if (isNetworkError(e)) return `Cannot reach Boomerang at ${ctx.url}. Start it with pnpm start, or set BOOMERANG_URL.`;
  if (!(e instanceof BoomerangError)) return e instanceof Error ? e.message : String(e);
  if (e.status === 423 || e.code === "locked") return "Boomerang is locked. Ask the owner to unlock it.";
  if (e.code === "pending") return `Waiting for the owner to approve agent ${ctx.name} on the Agents page`;
  if (e.code === "revoked") return `The owner revoked agent ${ctx.name}. Remove ${ctx.keyFile} to register a new key.`;
  if (e.code === "unknown_actor") return `Boomerang does not know agent ${ctx.name} any more. Remove ${ctx.keyFile} to register again.`;
  if (e.code === "gate" && e.details && typeof e.details === "object" && Array.isArray((e.details as { missing?: unknown }).missing)) {
    return describeGate(e.message, (e.details as { missing: GateEntry[] }).missing);
  }
  if (e.code === "validation" && Array.isArray(e.details)) {
    const issues = (e.details as { path?: (string | number)[]; message?: string }[])
      .map((i) => `- ${(i.path ?? []).join(".") || "body"}: ${i.message ?? "invalid"}`);
    return [e.message, ...issues].join("\n");
  }
  if (e.details !== undefined && e.details !== null) return `${e.message} (${e.code}: ${clip(JSON.stringify(e.details))})`;
  return `${e.message} (${e.code})`;
}

/** Details are for a person to skim, so an unusually large blob is cut at 2 KB. */
const DETAILS_LIMIT = 2048;
const clip = (s: string) => (s.length > DETAILS_LIMIT ? `${s.slice(0, DETAILS_LIMIT)}... (${s.length - DETAILS_LIMIT} more characters)` : s);
