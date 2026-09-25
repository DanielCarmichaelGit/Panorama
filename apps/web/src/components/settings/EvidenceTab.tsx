import { useMemo, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { EVIDENCE_KINDS, type EvidenceKind, type EvidenceType } from "@panorama/core";
import { useCreateEvidenceType, useDeleteEvidenceType, useEvidenceTypes, useLanes } from "../../lib/hooks";
import { Chip } from "../Chip";
import { Picker } from "../Picker";
import { EmptyRow, FocusInput, RowAction, RowConfirm, RowError, RowForm, SettingsList, SettingsRow, SettingsSection, errorMessage } from "./primitives";
import { TabState } from "./TabState";

const NEW = "new";

const KIND_LABELS: Record<EvidenceKind, string> = {
  test_run: "Test run",
  pr_link: "PR link",
  eval_score: "Eval score",
  screenshot: "Screenshot",
  human_signoff: "Human sign-off",
  file: "File",
  custom: "Custom",
};

function NewTypeForm({ onClose }: { onClose: () => void }) {
  const create = useCreateEvidenceType();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<EvidenceKind>("custom");
  const [threshold, setThreshold] = useState("0.9");
  const [humanOnly, setHumanOnly] = useState(false);
  const [needsAttachment, setNeedsAttachment] = useState(false);

  const thresholdValue = Number(threshold);
  const thresholdOk = kind !== "eval_score" || (threshold.trim() !== "" && thresholdValue >= 0 && thresholdValue <= 1);
  const canSave = name.trim() !== "" && thresholdOk;

  function submit() {
    create.mutate(
      {
        name: name.trim(),
        kind,
        ...(kind === "eval_score" ? { params: { threshold: thresholdValue } } : {}),
        humanOnly,
        needsAttachment,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <RowForm label="New evidence type" onSubmit={submit} onCancel={onClose} canSave={canSave} busy={create.isPending} error={create.isError ? errorMessage(create.error, "Could not add the evidence type.") : null}>
      <div className="row-form-grid">
        <div className="field">
          <label htmlFor="net-name">Name</label>
          <FocusInput id="net-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <Picker id="net-kind" label="Kind" options={EVIDENCE_KINDS.map((k) => ({ id: k, label: KIND_LABELS[k] }))} value={kind} onChange={(v) => v && setKind(v as EvidenceKind)} />
        {kind === "eval_score" && (
          <div className="field">
            <label htmlFor="net-threshold">Threshold</label>
            <input id="net-threshold" className="input mono-input" type="number" min={0} max={1} step={0.05} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        )}
      </div>
      <div className="row-form-checks">
        <label className="checkbox-row">
          <input type="checkbox" checked={humanOnly} onChange={(e) => setHumanOnly(e.target.checked)} /> Human only
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={needsAttachment} onChange={(e) => setNeedsAttachment(e.target.checked)} /> Needs attachment
        </label>
      </div>
    </RowForm>
  );
}

function TypeRow({ type, usedBy }: { type: EvidenceType; usedBy: string[] }) {
  const remove = useDeleteEvidenceType();
  const [confirming, setConfirming] = useState(false);
  const deleteReason = usedBy.length > 0 ? `Remove it from ${usedBy.join(", ")} first` : undefined;

  return (
    <SettingsRow
      identity={
        <>
          <span className="row-name">{type.name}</span>
          <span className="mono muted">{type.kind}</span>
        </>
      }
      facts={
        <>
          {type.humanOnly && <Chip family="stone">Human only</Chip>}
          {type.needsAttachment && <Chip family="stone">Needs attachment</Chip>}
          {type.kind === "eval_score" && type.params.threshold !== undefined && <span className="mono">{type.params.threshold} threshold</span>}
          {usedBy.length > 0 && <span>Required by {usedBy.join(", ")}</span>}
        </>
      }
      actions={!confirming && <RowAction icon={Trash} label="Delete" onClick={() => { remove.reset(); setConfirming(true); }} disabled={!!deleteReason} reason={deleteReason} />}
    >
      {remove.isError && <RowError message={errorMessage(remove.error, "Could not delete the evidence type.")} />}
      {confirming && (
        <RowConfirm
          question={`Delete ${type.name}?`}
          action="Delete"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(type.id, { onSettled: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
    </SettingsRow>
  );
}

/**
 * Settings tab for the evidence types, which are global (every project shares them): add one,
 * or delete one nothing references. "Required by" names the lanes of the current project that
 * require the type and disables Delete with that reason; the server also refuses for lanes of
 * other projects and for recorded evidence, and its message shows in the row.
 */
export function EvidenceTab({ projectId }: { projectId: string }) {
  const types = useEvidenceTypes();
  const lanes = useLanes(projectId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const usedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const lane of [...(lanes.data ?? [])].sort((a, b) => a.position - b.position)) {
      for (const r of lane.evidenceRequirements) out.set(r.typeId, [...(out.get(r.typeId) ?? []), lane.name]);
    }
    return out;
  }, [lanes.data]);

  const state = TabState({ query: types, label: "evidence types" });
  if (state) return state;

  const list = types.data ?? [];
  const close = () => setExpandedId(null);

  return (
    <SettingsSection
      description="Evidence types are the proof an agent can attach to a ticket. Add your own here, then require them on a lane in the Lanes tab."
      action={<button type="button" className="btn" onClick={() => setExpandedId(NEW)} disabled={expandedId === NEW}>Add evidence type</button>}
    >
      <SettingsList label="Evidence types">
        {expandedId === NEW && (
          <li className="settings-row" data-expanded="true">
            <NewTypeForm onClose={close} />
          </li>
        )}
        {list.length === 0 && expandedId !== NEW && <EmptyRow mark>No evidence types yet. Add one for lanes to require.</EmptyRow>}
        {list.map((t) => <TypeRow key={t.id} type={t} usedBy={usedBy.get(t.id) ?? []} />)}
      </SettingsList>
    </SettingsSection>
  );
}
