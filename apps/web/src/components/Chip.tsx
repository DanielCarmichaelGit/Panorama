import type { Epic, Family, Tag } from "@panorama/core";

// Chips are labels here. Filtering happens through the Board's Epic and Tags Pickers, not by
// clicking a chip.
export function Chip({ family, children }: { family: Family; children: React.ReactNode }) {
  return <span className="chip" style={{ background: `var(--${family}-top)`, color: `var(--${family}-ink)` }}>{children}</span>;
}

/** The ticket's epic, as a chip in the epic's family. Nothing when the ticket has no epic. */
export function EpicChip({ epic }: { epic: Epic | undefined }) {
  if (!epic) return null;
  return <Chip family={epic.family}>{epic.name}</Chip>;
}

const MAX_TAG_CHIPS = 3;

/** Up to three tag chips; the rest collapse into a "+n" chip whose title lists their names. */
export function TagChips({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, MAX_TAG_CHIPS);
  const overflow = tags.slice(MAX_TAG_CHIPS);
  return (
    <>
      {shown.map((tag) => (
        <Chip key={tag.id} family={tag.family}>{tag.name}</Chip>
      ))}
      {overflow.length > 0 && (
        <span
          className="chip chip-overflow"
          title={overflow.map((tag) => tag.name).join(", ")}
          aria-label={overflow.map((tag) => tag.name).join(", ")}
        >
          +{overflow.length}
        </span>
      )}
    </>
  );
}
