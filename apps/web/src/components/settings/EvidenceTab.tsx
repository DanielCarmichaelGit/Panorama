import { useEvidenceTypes } from "../../lib/hooks";
import { TabState } from "./TabState";

/** Settings tab listing the built-in evidence types. Read-only until automations can define custom ones. */
export function EvidenceTab() {
  const types = useEvidenceTypes();

  const state = TabState({ query: types, label: "evidence types" });
  if (state) return state;

  const list = types.data ?? [];

  return (
    <div>
      <p className="muted">Custom evidence types arrive with automations.</p>
      {list.length === 0 ? (
        <p className="muted">No evidence types yet.</p>
      ) : (
        <div className="settings-list">
          {list.map((t) => (
            <div className="settings-row" key={t.id}>
              <span className="ttl">{t.name}</span>
              <span className="muted">{t.kind}</span>
              {t.humanOnly && <span className="mono muted">Human only</span>}
              {t.needsAttachment && <span className="mono muted">Needs attachment</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
