import { CheckCircle, Circle } from "@phosphor-icons/react";
import type { EvidenceType, Lane } from "@panorama/core";

/** One lane's still-missing requirement, as `GET /api/v1/tickets/:id/gates` reports it. */
export interface GateMiss {
  typeId: string;
  need: number;
  have: number;
}

/** The lane with the smallest position greater than the current lane's, or null past the last lane. */
export function nextLane(lanes: Lane[], current: string): Lane | null {
  const currentLane = lanes.find((l) => l.id === current);
  if (!currentLane) return null;
  const ahead = lanes.filter((l) => l.position > currentLane.position).sort((a, b) => a.position - b.position);
  return ahead[0] ?? null;
}

function typeName(types: EvidenceType[], typeId: string): string {
  return types.find((t) => t.id === typeId)?.name ?? typeId;
}

/**
 * The disabled-option text for a lane a ticket cannot yet enter: the lane name, or the name plus
 * what is missing. Shared between the ticket panel's lane select (here) and the Board's illegal
 * drop lanes (Task 10), so both surfaces phrase a refusal the same way.
 */
export function laneOptionLabel(lane: Lane, missing: GateMiss[], types: EvidenceType[]): string {
  if (missing.length === 0) return lane.name;
  const names = missing.map((m) => typeName(types, m.typeId));
  return `${lane.name} (needs ${names.join(", ")})`;
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

  return (
    <>
      <div className="gate-head">
        <h2>To enter {lane.name}</h2>
        {actions}
      </div>
      {lane.evidenceRequirements.length === 0 ? (
        <p className="muted">No evidence required.</p>
      ) : (
        <div className="gate-list">
          {lane.evidenceRequirements.map((r) => {
            const miss = missing.find((m) => m.typeId === r.typeId);
            const name = typeName(types, r.typeId);
            return miss ? (
              <div className="unmet" key={r.typeId}>
                <Circle size={16} weight="regular" aria-hidden="true" />
                <span>{name}, {miss.have} of {miss.need}</span>
              </div>
            ) : (
              <div className="met" key={r.typeId}>
                <CheckCircle size={16} weight="regular" aria-label="met" />
                <span>{name}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
