import { useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { Family } from "@boomerang/core";
import { useRuleRuns, useTickets, type RuleRun } from "../../lib/hooks";
import { Chip } from "../Chip";

/** How long ago, in the fewest words: "just now", "4 min ago", "2 h ago", then the date. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  return new Date(iso).toLocaleDateString();
}

const OUTCOME: Record<RuleRun["outcome"], { family: Family; label: string }> = {
  applied: { family: "mint", label: "Applied" },
  skipped: { family: "stone", label: "Skipped" },
  refused: { family: "coral", label: "Refused" },
  error: { family: "coral", label: "Error" },
};

function detailText(detail: unknown): string {
  if (detail === undefined || detail === null || detail === "") return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

/** The last 20 runs of a rule as a dense list: time, ticket key, outcome chip, the detail on expand. Live through the stream. */
export function RunLog({ ruleId, projectId }: { ruleId: string; projectId: string }) {
  const runs = useRuleRuns(ruleId, 20);
  const tickets = useTickets(projectId);
  const [open, setOpen] = useState<string | null>(null);
  const keyOf = (run: RuleRun) => run.ticketKey ?? tickets.data?.find((t) => t.id === run.ticketId)?.key ?? run.ticketId;

  return (
    <section className="run-log" aria-labelledby="run-log-title">
      <div className="run-log-head">
        <h2 id="run-log-title">Runs</h2>
        {runs.data && runs.data.length > 0 && <span className="muted">Last {runs.data.length}</span>}
      </div>
      {runs.isPending && <div className="skeleton" />}
      {runs.isError && <p className="muted">The run log could not be loaded.</p>}
      {runs.data && (
        <ul className="settings-list run-list" aria-label="Runs">
          {runs.data.length === 0 && (
            <li className="settings-empty">
              <p className="muted">This rule has not fired yet.</p>
            </li>
          )}
          {runs.data.map((run) => {
            const o = OUTCOME[run.outcome] ?? OUTCOME.error;
            const detail = detailText(run.detail);
            const expanded = open === run.id;
            return (
              <li key={run.id} className="settings-row run-row" data-expanded={expanded || undefined}>
                <div className="row-id">
                  <span className="mono muted" title={new Date(run.firedAt).toLocaleString()}>{ago(run.firedAt)}</span>
                  <span className="mono">{keyOf(run)}</span>
                </div>
                <div className="row-facts">
                  <Chip family={o.family}>{o.label}</Chip>
                  {detail && !expanded && <span className="row-truncate">{detail.split("\n")[0]}</span>}
                </div>
                <div className="row-actions">
                  {detail && (
                    <button type="button" className="icon-btn" aria-expanded={expanded} aria-label={expanded ? "Hide detail" : "Show detail"} title={expanded ? "Hide detail" : "Show detail"} onClick={() => setOpen(expanded ? null : run.id)}>
                      {expanded ? <CaretDown size={16} weight="regular" aria-hidden="true" /> : <CaretRight size={16} weight="regular" aria-hidden="true" />}
                    </button>
                  )}
                </div>
                {expanded && <pre className="codeblock run-detail">{detail}</pre>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
