import { useEffect, useId, useRef, useState } from "react";
import { CaretUpDown, Check } from "@phosphor-icons/react";
import type { Family, Project } from "@boomerang/core";

const AVATAR_FAMILIES: Family[] = ["coral", "sky", "lilac", "mint"];

/** A stable family for a project's avatar, chosen from its key so it never changes. */
export function avatarFamily(key: string): Family {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_FAMILIES[h % AVATAR_FAMILIES.length];
}

function Avatar({ project, size = 28 }: { project: Project; size?: number }) {
  const fam = avatarFamily(project.key);
  return (
    <span
      className="proj-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: `var(--${fam}-top)`, color: `var(--${fam}-ink)` }}
    >
      {project.name.trim().charAt(0).toUpperCase() || project.key.charAt(0)}
    </span>
  );
}

/**
 * The project row at the top of the sidebar: avatar, name, key. With more than one project it is a
 * button that opens a listbox of the others; with one it is a plain row. `compact` (collapsed
 * sidebar) shows the avatar alone with the name as its title.
 */
export function ProjectSwitcher({
  id,
  list,
  current,
  onChange,
  compact = false,
}: {
  id: string;
  list: Project[];
  current: Project;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const many = list.length > 1;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openMenu() {
    setActive(Math.max(0, list.findIndex((p) => p.id === current.id)));
    setOpen(true);
  }

  function choose(i: number) {
    const p = list[i];
    setOpen(false);
    if (p && p.id !== current.id) onChange(p.id);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % list.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + list.length) % list.length); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(list.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(active); }
    else if (e.key === "Tab") setOpen(false);
  }

  if (compact) {
    return (
      <div className="proj-row compact" title={`${current.name} (${current.key})`}>
        <Avatar project={current} size={36} />
        <span className="sr-only">{current.name}</span>
      </div>
    );
  }

  const body = (
    <>
      <Avatar project={current} />
      <span className="proj-text">
        <span className="proj-name" title={current.name}>{current.name}</span>
        <span className="proj-key mono">{current.key}</span>
      </span>
      {many && <CaretUpDown size={14} weight="bold" className="proj-caret" aria-hidden="true" />}
    </>
  );

  if (!many) return <div className="proj-row" id={id}>{body}</div>;

  return (
    <div className="proj-switcher" ref={rootRef} onKeyDown={onKey}>
      <button
        type="button"
        id={id}
        className="proj-row proj-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Project: ${current.name}. Switch project`}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {body}
      </button>
      {open && (
        <ul className="proj-menu" role="listbox" id={listId} aria-label="Projects" aria-activedescendant={`${listId}-${active}`}>
          {list.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={p.id === current.id}
              className={"proj-option" + (i === active ? " active" : "")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <Avatar project={p} size={22} />
              <span className="proj-text">
                <span className="proj-name">{p.name}</span>
                <span className="proj-key mono">{p.key}</span>
              </span>
              {p.id === current.id && <Check size={14} weight="bold" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
