import { useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { Columns, Compass, SealCheck, Tag, TextColumns, type Icon } from "@phosphor-icons/react";
import type { Project } from "@panorama/core";
import { EpicsTab } from "../components/settings/EpicsTab";
import { EvidenceTab } from "../components/settings/EvidenceTab";
import { FieldsTab } from "../components/settings/FieldsTab";
import { LanesTab } from "../components/settings/LanesTab";
import { TagsTab } from "../components/settings/TagsTab";

const TABS = [
  { id: "fields", label: "Fields" },
  { id: "tags", label: "Tags" },
  { id: "epics", label: "Arcs" },
  { id: "lanes", label: "Lanes" },
  { id: "evidence", label: "Evidence types" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v);
}

/** The five concepts Settings manages, in the order they build on each other, each with two plain sentences. */
const CONCEPTS: { id: TabId; icon: Icon; name: string; text: string }[] = [
  { id: "lanes", icon: Columns, name: "Lanes", text: "The stages a ticket moves through, like Backlog, In progress and Done. A ticket is always in exactly one lane." },
  {
    id: "evidence",
    icon: SealCheck,
    name: "Evidence types",
    text: "The kinds of proof an agent can attach to a ticket: a test run, a pull request, a screenshot, a file, an eval score, a human sign-off. A lane can require some of them before a ticket may enter it. That is the gate.",
  },
  { id: "epics", icon: Compass, name: "Arcs", text: "A body of work that a group of tickets carries forward, what other tools call an epic. One arc per ticket." },
  { id: "tags", icon: Tag, name: "Tags", text: "Quick labels for finding and filtering tickets. As many per ticket as you like." },
  { id: "fields", icon: TextColumns, name: "Fields", text: "Extra properties every ticket in this project carries, such as a customer name or a priority. A field can be required when a ticket is created." },
];

/** Remembers whether the owner hid the intro strip; the only Settings state kept in the browser. */
export const INTRO_KEY = "pan.settingsIntro";

function readIntroHidden(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === "hidden";
  } catch {
    return false;
  }
}

function writeIntroHidden(hidden: boolean) {
  try {
    localStorage.setItem(INTRO_KEY, hidden ? "hidden" : "shown");
  } catch {
    // A browser without storage just forgets the choice.
  }
}

/**
 * Settings: Fields, Tags, Arcs (epics in the API), Lanes, and Evidence types, each its own tab
 * component. Every save here is human-signed like the rest of the app. The active tab lives in
 * the URL (`?tab=...`) so a link into a specific tab (the Board's Requirements button goes to
 * `?tab=lanes`) lands in the right place. Above the tabs, a strip explains how the five concepts
 * fit together; each column opens its tab, and Hide puts the strip away.
 */
export function Settings() {
  const { project } = useOutletContext<{ project: Project }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [introHidden, setIntroHidden] = useState(readIntroHidden);

  const requested = searchParams.get("tab");
  const activeTab: TabId = isTabId(requested) ? requested : "fields";

  function selectTab(id: TabId) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next, { replace: true });
  }

  function toggleIntro() {
    const next = !introHidden;
    setIntroHidden(next);
    writeIntroHidden(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.id === activeTab);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(idx + delta + TABS.length) % TABS.length];
    selectTab(next.id);
    tabRefs.current[next.id]?.focus();
  }

  return (
    <div className="view">
      <h1>Settings</h1>
      <div className="settings-intro-head">
        <span className="settings-intro-title">How it fits together</span>
        <button type="button" className="btn ghost small" onClick={toggleIntro} aria-expanded={!introHidden} aria-controls="settings-intro">
          {introHidden ? "Show" : "Hide"}
        </button>
      </div>
      {!introHidden && (
        <div className="settings-intro" id="settings-intro">
          {CONCEPTS.map((c) => (
            <button key={c.id} type="button" className="settings-intro-item" aria-current={activeTab === c.id || undefined} onClick={() => selectTab(c.id)}>
              <span className="settings-intro-name">
                <c.icon size={16} weight="regular" aria-hidden="true" />
                {c.name}
              </span>
              <span className="settings-intro-text">{c.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="Settings" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={activeTab === t.id ? `panel-${t.id}` : undefined}
            tabIndex={activeTab === t.id ? 0 : -1}
            className="tab"
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "fields" && <FieldsTab projectId={project.id} />}
        {activeTab === "tags" && <TagsTab projectId={project.id} />}
        {activeTab === "epics" && <EpicsTab projectId={project.id} />}
        {activeTab === "lanes" && <LanesTab projectId={project.id} />}
        {activeTab === "evidence" && <EvidenceTab projectId={project.id} />}
      </div>
    </div>
  );
}
