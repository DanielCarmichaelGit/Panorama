import type { Epic, Family, Tag } from "@boomerang/core";
import { chipTokens } from "../lib/color";

// Chips are labels here. Filtering happens through the Board's Arc and Tags Pickers, not by
// clicking a chip. A chip carries a family and, for arcs and tags, an optional custom colour that
// wins over the family when set; `chipTokens` turns either into a background and an ink.
export function Chip({ family, color, children }: { family: Family; color?: string | null; children: React.ReactNode }) {
  const tokens = chipTokens({ family, color });
  return <span className="chip" style={{ background: tokens.top, color: tokens.ink }}>{children}</span>;
}

/** The ticket's arc, as a chip in the arc's colour. Nothing when the ticket has no arc. */
export function EpicChip({ epic }: { epic: Epic | undefined }) {
  if (!epic) return null;
  return <Chip family={epic.family} color={epic.color}>{epic.name}</Chip>;
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
        <Chip key={tag.id} family={tag.family} color={tag.color}>{tag.name}</Chip>
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
