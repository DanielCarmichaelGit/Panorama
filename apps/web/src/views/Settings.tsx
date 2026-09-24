import { useRef } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { Lane, Project } from "@panorama/core";
import { EpicsTab } from "../components/settings/EpicsTab";
import { EvidenceTab } from "../components/settings/EvidenceTab";
import { FieldsTab } from "../components/settings/FieldsTab";
import { LanesTab } from "../components/settings/LanesTab";
import { TagsTab } from "../components/settings/TagsTab";

const TABS = [
  { id: "fields", label: "Fields" },
  { id: "tags", label: "Tags" },
  { id: "epics", label: "Epics" },
  { id: "lanes", label: "Lanes" },
  { id: "evidence", label: "Evidence types" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v);
}

/**
 * Settings: Fields, Tags, Epics, Lanes, and Evidence types, each its own tab component. Every
 * save here is human-signed like the rest of the app. The active tab lives in the URL
 * (`?tab=...`) so a link into a specific tab (the Board's Requirements button goes to
 * `?tab=lanes`) lands in the right place.
 */
export function Settings() {
  const { project, lanes } = useOutletContext<{ project: Project; lanes: Lane[] }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const requested = searchParams.get("tab");
  const activeTab: TabId = isTabId(requested) ? requested : "fields";

  function selectTab(id: TabId) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next, { replace: true });
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
      <div className="tabs" role="tablist" aria-label="Settings" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`panel-${t.id}`}
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
        {activeTab === "lanes" && <LanesTab lanes={lanes} />}
        {activeTab === "evidence" && <EvidenceTab />}
      </div>
    </div>
  );
}
