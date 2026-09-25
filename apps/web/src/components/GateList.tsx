import { CheckCircle, Circle } from "@phosphor-icons/react";
import type { EvidenceType, Lane } from "@panorama/core";
import type { GateMiss } from "../lib/hooks";
import { Chip } from "./Chip";

/** The lane with the smallest position greater than the current lane's, or null past the last lane. */
export function nextLane(lanes: Lane[], current: string): Lane | null {
  const currentLane = lanes.find((l) => l.id === current);
  if (!currentLane) return null;
  const ahead = lanes.filter((l) => l.position > currentLane.position).sort((a, b) => a.position - b.position);
  return ahead[0] ?? null;
}

function typeName(types: EvidenceType[] | undefined, typeId: string): string {
  return types?.find((t) => t.id === typeId)?.name ?? typeId;
}

/**
 * The disabled-option text for a lane a ticket cannot yet enter: the lane name, or the name plus
 * what is missing. Shared between the ticket panel's lane select (here) and the Board's illegal
 * drop lanes (Task 10), so both surfaces phrase a refusal the same way. `missing` entries already
 * carry their type's `name` from the server; `types` is only a fallback for a caller that doesn't
 * have one handy.
 */
export function laneOptionLabel(lane: Lane, missing: GateMiss[], types?: EvidenceType[]): string {
  if (missing.length === 0) return lane.name;
  const names = missing.map((m) => m.name ?? typeName(types, m.typeId));
  return `${lane.name} (needs ${names.join(", ")})`;
}

/**
 * Phrases a gate refusal's missing evidence, from the shape the server's 422 `details.missing`
 * (and `useGates`) both report. Shared by the Board's drag-drop error and its keyboard move
 * error, so both surfaces refuse a lane the same way.
 */
export function missingMessage(missing: Pick<GateMiss, "name">[]): string {
  return `${missing.map((m) => m.name).join(", ")} needed first`;
}

/**
 * The evidence checklist for one lane: a mint check for each requirement already met, a stone
 * circle with the running count for one still missing. `missing` is the lane's entry from
 * `GET /api/v1/tickets/:id/gates` (only the unmet requirements); every requirement not named
 * there is treated as met. `lane` is null past the last lane in the project. `actions`, when
 * given, renders beside the heading (the ticket panel's "Add evidence" button).
 */
export function GateList({ lane, missing, types, actions }: { lane: Lane | null; missing: GateMiss[]; types: EvidenceType[]; actions?: React.ReactNode }) {
  if (!lane) {
    return (
      <div className="gate-head">
        <p className="muted">This is the last lane.</p>
        {actions}
      </div>
    );
  }

  // blocked_by is a dependency gate reason, not an evidence type: it never appears in
  // lane.evidenceRequirements, so it cannot be matched against that list the way a real evidence
  // miss is. It is rendered straight from `missing` instead, using the name the server already
  // gave it ("Blocked by KEY"), so it never falls into typeName's evidence-type lookup.
  const blockers = missing.filter((m) => m.typeId === "blocked_by");
  const hasContent = lane.evidenceRequirements.length > 0 || blockers.length > 0;

  return (
    <>
      <div className="gate-head">
        <h2 className="gate-title">To enter <Chip family={lane.family}>{lane.name}</Chip></h2>
        {actions}
      </div>
      {!hasContent ? (
        <p className="muted">No evidence required.</p>
      ) : (
        <div className="gate-list">
          {lane.evidenceRequirements.map((r) => {
            const miss = missing.find((m) => m.typeId === r.typeId);
            return miss ? (
              <div className="unmet" key={r.typeId}>
                <Circle size={16} weight="regular" aria-hidden="true" />
                <span>{miss.name ?? typeName(types, r.typeId)}, {miss.have} of {miss.need}</span>
              </div>
            ) : (
              <div className="met" key={r.typeId}>
                <CheckCircle size={16} weight="regular" aria-label="met" />
                <span>{typeName(types, r.typeId)}</span>
              </div>
            );
          })}
          {blockers.map((b) => (
            <div className="unmet" key={`blocked_by-${b.name}`}>
              <Circle size={16} weight="regular" aria-hidden="true" />
              <span>{b.name}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
