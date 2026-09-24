import type { Evidence, EvidenceType, Family } from "@panorama/core";
import { Chip } from "./Chip";

const FAMILY_BY_RESULT: Record<Evidence["result"], Family> = { pass: "mint", fail: "coral", info: "stone" };

/** The key number (or link) that follows the type name, read from the evidence's typed payload. */
function detail(evidence: Evidence, type: EvidenceType): React.ReactNode {
  const payload = evidence.payload as Record<string, unknown>;
  switch (type.kind) {
    case "test_run": {
      const passed = Number(payload.passed ?? 0), failed = Number(payload.failed ?? 0);
      return `${passed}/${passed + failed}`;
    }
    case "eval_score":
      return String(payload.score);
    case "pr_link":
      return (
        <a href={String(payload.url)} target="_blank" rel="noreferrer">
          {typeof payload.title === "string" && payload.title ? payload.title : "View"}
        </a>
      );
    default:
      return null;
  }
}

/** Pill for one piece of evidence: pass/fail/info colours the chip, the type name and the kind's key number or link fill it in. */
export function EvidenceChip({ evidence, type }: { evidence: Evidence; type: EvidenceType }) {
  return (
    <Chip family={FAMILY_BY_RESULT[evidence.result]}>
      <span className="mono">{evidence.result.toUpperCase()}</span> {type.name} {detail(evidence, type)}
    </Chip>
  );
}
