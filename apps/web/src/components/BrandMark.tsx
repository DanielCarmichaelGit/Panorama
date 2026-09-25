import { BoomerangScene } from "../lib/iso";

/**
 * The product mark at the top of the sidebar: the compact boomerang at 20px and the word. The word
 * is hidden when the sidebar is collapsed and the mark stays.
 */
export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="brand" aria-label="Boomerang" title="Boomerang">
      <span className="brand-glyph" aria-hidden="true"><BoomerangScene compact /></span>
      {!collapsed && <span className="brand-word">Boomerang</span>}
    </div>
  );
}
