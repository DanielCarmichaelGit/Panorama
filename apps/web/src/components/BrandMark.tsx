/**
 * The product mark at the top of the sidebar. The word is hidden when the sidebar is collapsed
 * and the small glyph stays; the glyph is a placeholder until the boomerang illustration lands.
 */
export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="brand" aria-label="Boomerang" title="Boomerang">
      <span className="brand-glyph" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="20" height="20">
          <path d="M3 15 L10 4 L17 15 L13.5 15 L10 9.5 L6.5 15 Z" fill="var(--sky-right)" />
          <path d="M6.5 15 L10 9.5 L10 4 L3 15 Z" fill="var(--sky-top)" />
          <circle cx="16" cy="5" r="2" fill="var(--coral-right)" />
        </svg>
      </span>
      {!collapsed && <span className="brand-word">Boomerang</span>}
    </div>
  );
}
