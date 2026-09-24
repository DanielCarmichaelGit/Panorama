import { useMemo, useState } from "react";
import { FIELD_KINDS, type FieldDefinition, type FieldKind } from "@panorama/core";
import { ApiError } from "../../lib/api";
import { useArchiveField, useCreateField, useFields, useUpdateField } from "../../lib/hooks";
import { swapNeighbour } from "../../lib/reorder";
import { Picker } from "../Picker";

const KIND_LABELS: Record<FieldKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Select",
  checkbox: "Checkbox",
};

/**
 * Turns a field name into a starting point for its key: lowercase, spaces and symbols collapsed
 * to underscores, leading digits or underscores dropped so the result matches the key format the
 * server requires (`^[a-z][a-z0-9_]{0,31}$`). The field stays editable until the field saves.
 */
export function suggestKey(name: string): string {
  const snake = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const stripped = snake.replace(/^[0-9_]+/, "");
  return (stripped || "field").slice(0, 32);
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === "duplicate_key") return "That key is taken";
  return e instanceof Error ? e.message : fallback;
}

interface OptionRow {
  value: string;
  label: string;
}

function OptionsEditor({ options, onChange }: { options: OptionRow[]; onChange: (options: OptionRow[]) => void }) {
  function update(i: number, patch: Partial<OptionRow>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function add() {
    onChange([...options, { value: "", label: "" }]);
  }
  function remove(i: number) {
    onChange(options.filter((_, idx) => idx !== i));
  }
  return (
    <div className="options-editor">
      <label>Options</label>
      {options.map((o, i) => (
        <div className="options-row" key={i}>
          <input
            className="input"
            placeholder="Value"
            aria-label={`Option ${i + 1} value`}
            value={o.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <input
            className="input"
            placeholder="Label"
            aria-label={`Option ${i + 1} label`}
            value={o.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <button type="button" className="btn ghost" onClick={() => remove(i)}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={add}>Add option</button>
    </div>
  );
}

function activeOptions(options: OptionRow[]): OptionRow[] {
  return options.map((o) => ({ value: o.value.trim(), label: o.label.trim() })).filter((o) => o.value && o.label);
}

function NewFieldForm({ projectId }: { projectId: string }) {
  const create = useCreateField();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [kind, setKind] = useState<FieldKind>("text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<OptionRow[]>([{ value: "", label: "" }]);

  function changeName(v: string) {
    setName(v);
    if (!keyTouched) setKey(suggestKey(v));
  }

  const trimmedOptions = activeOptions(options);
  const canCreate = name.trim() !== "" && key.trim() !== "" && (kind !== "select" || trimmedOptions.length > 0) && !create.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    try {
      await create.mutateAsync({
        projectId,
        name: name.trim(),
        key: key.trim(),
        kind,
        required,
        options: kind === "select" ? trimmedOptions : undefined,
      });
      setName("");
      setKey("");
      setKeyTouched(false);
      setKind("text");
      setRequired(false);
      setOptions([{ value: "", label: "" }]);
    } catch {
      // create.error renders below
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <h2>New field</h2>
      <div className="field">
        <label htmlFor="nf-name">Name</label>
        <input id="nf-name" className="input" value={name} onChange={(e) => changeName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="nf-key">Key</label>
        <input
          id="nf-key"
          className="input mono-input"
          value={key}
          onChange={(e) => {
            setKeyTouched(true);
            setKey(e.target.value);
          }}
        />
      </div>
      <Picker
        id="nf-kind"
        label="Kind"
        options={FIELD_KINDS.map((k) => ({ id: k, label: KIND_LABELS[k] }))}
        value={kind}
        onChange={(v) => v && setKind(v as FieldKind)}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
      </label>
      {kind === "select" && <OptionsEditor options={options} onChange={setOptions} />}
      {create.isError && <p className="error" role="alert">{errorMessage(create.error, "Could not create the field.")}</p>}
      <button type="submit" className="btn" disabled={!canCreate}>{create.isPending ? "Creating" : "Create field"}</button>
    </form>
  );
}

function FieldRow({
  field,
  index,
  count,
  onMove,
}: {
  field: FieldDefinition;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
}) {
  const update = useUpdateField();
  const archive = useArchiveField();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(field.name);
  const [required, setRequired] = useState(field.required);
  const [options, setOptions] = useState<OptionRow[]>(field.options.length ? field.options.map((o) => ({ ...o })) : [{ value: "", label: "" }]);

  function startEdit() {
    setName(field.name);
    setRequired(field.required);
    setOptions(field.options.length ? field.options.map((o) => ({ ...o })) : [{ value: "", label: "" }]);
    setEditing(true);
  }

  const trimmedOptions = activeOptions(options);
  const canSave = name.trim() !== "" && (field.kind !== "select" || trimmedOptions.length > 0) && !update.isPending;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    try {
      await update.mutateAsync({
        id: field.id,
        patch: { name: name.trim(), required, options: field.kind === "select" ? trimmedOptions : undefined },
      });
      setEditing(false);
    } catch {
      // update.error renders below
    }
  }

  function doArchive() {
    archive.mutate(field.id, { onSuccess: () => setConfirming(false) });
  }

  if (editing) {
    return (
      <form className="inline-form" onSubmit={save}>
        <div className="field">
          <label htmlFor={`ef-name-${field.id}`}>Name</label>
          <input id={`ef-name-${field.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        {field.kind === "select" && <OptionsEditor options={options} onChange={setOptions} />}
        {update.isError && <p className="error" role="alert">{errorMessage(update.error, "Could not save the field.")}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button type="submit" className="btn" disabled={!canSave}>{update.isPending ? "Saving" : "Save"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="settings-row">
      <span className="ttl">{field.name}</span>
      <span className="mono muted">{field.key}</span>
      <span className="muted">{KIND_LABELS[field.kind]}</span>
      {field.required && <span className="mono muted">Required</span>}
      {field.kind === "select" && <span className="mono muted">{field.options.length} options</span>}
      <div className="spacer" />
      {confirming ? (
        <span className="confirm-row">
          Archive {field.name}? Values stay stored but hidden.
          <button type="button" className="btn ghost" onClick={doArchive}>Archive</button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>Keep</button>
        </span>
      ) : (
        <>
          <button type="button" className="btn ghost" onClick={() => onMove(-1)} disabled={index === 0}>Move up</button>
          <button type="button" className="btn ghost" onClick={() => onMove(1)} disabled={index === count - 1}>Move down</button>
          <button type="button" className="btn ghost" onClick={startEdit}>Edit</button>
          <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>Archive</button>
        </>
      )}
    </div>
  );
}

/**
 * Settings tab for the project's custom ticket fields: create, reorder, edit, and archive.
 * Archiving keeps a field's stored values on tickets but drops it from new forms and this list.
 */
export function FieldsTab({ projectId }: { projectId: string }) {
  const fields = useFields(projectId);
  const update = useUpdateField();

  const list = useMemo(
    () => [...(fields.data ?? [])].filter((f) => !f.archived).sort((a, b) => a.position - b.position),
    [fields.data],
  );

  async function move(field: FieldDefinition, dir: -1 | 1) {
    const pair = swapNeighbour(list, list.findIndex((f) => f.id === field.id), dir);
    if (!pair) return;
    await Promise.all(pair.map((p) => update.mutateAsync({ id: p.id, patch: { position: p.position } })));
  }

  if (fields.isPending) {
    return <div className="settings-list">{[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}</div>;
  }

  if (fields.isError) {
    return (
      <div>
        <p className="error" role="alert">Could not load fields.</p>
        <button type="button" className="btn" onClick={() => fields.refetch()}>Try again</button>
      </div>
    );
  }

  return (
    <div>
      {list.length === 0 && <p className="muted">No custom fields yet. Add one to capture extra ticket data.</p>}
      <NewFieldForm projectId={projectId} />
      <div className="settings-list">
        {list.map((f, i) => (
          <FieldRow key={f.id} field={f} index={i} count={list.length} onMove={(dir) => move(f, dir)} />
        ))}
      </div>
    </div>
  );
}
