import { useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, PencilSimple, X } from "@phosphor-icons/react";
import { FIELD_KINDS, type FieldDefinition, type FieldKind } from "@boomerang/core";
import { ApiError } from "../../lib/api";
import { useArchiveField, useCreateField, useFields, useUpdateField } from "../../lib/hooks";
import { swapNeighbour } from "../../lib/reorder";
import { Chip } from "../Chip";
import { Picker } from "../Picker";
import { EmptyRow, RowAction, RowConfirm, RowError, RowForm, SettingsList, SettingsRow, SettingsSection } from "./primitives";
import { errorMessage } from "../../lib/errors";
import { tabState } from "./tabState";

const KIND_LABELS: Record<FieldKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Select",
  checkbox: "Checkbox",
  file: "File",
};

const NEW = "new";

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

function fieldError(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === "duplicate_key") return "That key is taken";
  return errorMessage(e, fallback);
}

interface OptionRow {
  value: string;
  label: string;
}

function OptionsEditor({ options, onChange }: { options: OptionRow[]; onChange: (options: OptionRow[]) => void }) {
  function update(i: number, patch: Partial<OptionRow>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  return (
    <div className="options-editor">
      <span className="options-label">Options</span>
      {options.map((o, i) => (
        <div className="options-row" key={i}>
          <input className="input mono-input" placeholder="Value" aria-label={`Option ${i + 1} value`} value={o.value} onChange={(e) => update(i, { value: e.target.value })} />
          <input className="input" placeholder="Label" aria-label={`Option ${i + 1} label`} value={o.label} onChange={(e) => update(i, { label: e.target.value })} />
          <button type="button" className="icon-btn" title="Remove option" aria-label={`Remove option ${i + 1}`} onClick={() => onChange(options.filter((_, idx) => idx !== i))}>
            <X size={14} weight="regular" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" className="link-btn" onClick={() => onChange([...options, { value: "", label: "" }])}>Add option</button>
    </div>
  );
}

function activeOptions(options: OptionRow[]): OptionRow[] {
  return options.map((o) => ({ value: o.value.trim(), label: o.label.trim() })).filter((o) => o.value && o.label);
}

function hasDuplicateValues(options: OptionRow[]): boolean {
  const values = activeOptions(options).map((o) => o.value);
  return new Set(values).size !== values.length;
}

const emptyOptions = (): OptionRow[] => [{ value: "", label: "" }];

function NewFieldForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const create = useCreateField();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [kind, setKind] = useState<FieldKind>("text");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState<OptionRow[]>(emptyOptions);

  function changeName(v: string) {
    setName(v);
    if (!keyTouched) setKey(suggestKey(v));
  }

  const trimmedOptions = activeOptions(options);
  const duplicateOptions = kind === "select" && hasDuplicateValues(options);
  const canSave = name.trim() !== "" && key.trim() !== "" && (kind !== "select" || trimmedOptions.length > 0) && !duplicateOptions;

  async function submit() {
    try {
      await create.mutateAsync({
        projectId,
        name: name.trim(),
        key: key.trim(),
        kind,
        required,
        options: kind === "select" ? trimmedOptions : undefined,
      });
      onClose();
    } catch {
      // create.error renders in the form
    }
  }

  return (
    <RowForm label="New field" onSubmit={submit} onCancel={onClose} canSave={canSave} busy={create.isPending} error={duplicateOptions ? "Option values must be unique." : create.isError ? fieldError(create.error, "Could not create the field.") : null}>
      <div className="row-form-grid">
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
            aria-describedby="nf-key-help"
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value);
            }}
          />
          <p id="nf-key-help" className="field-help">The name agents use in the API, as in fields.customer_name. It follows the name and is fixed once saved.</p>
        </div>
        <Picker id="nf-kind" label="Kind" options={FIELD_KINDS.map((k) => ({ id: k, label: KIND_LABELS[k], hint: k === "file" ? "One attachment of any type" : undefined }))} value={kind} onChange={(v) => v && setKind(v as FieldKind)} />
        <label className="checkbox-row">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
      </div>
      {kind === "select" && <OptionsEditor options={options} onChange={setOptions} />}
    </RowForm>
  );
}

function EditFieldForm({ field, onClose }: { field: FieldDefinition; onClose: () => void }) {
  const update = useUpdateField();
  const [name, setName] = useState(field.name);
  const [required, setRequired] = useState(field.required);
  const [options, setOptions] = useState<OptionRow[]>(() => (field.options.length ? field.options.map((o) => ({ ...o })) : emptyOptions()));

  const trimmedOptions = activeOptions(options);
  const duplicateOptions = field.kind === "select" && hasDuplicateValues(options);
  const canSave = name.trim() !== "" && (field.kind !== "select" || trimmedOptions.length > 0) && !duplicateOptions;

  async function submit() {
    try {
      await update.mutateAsync({
        id: field.id,
        patch: { name: name.trim(), required, options: field.kind === "select" ? trimmedOptions : undefined },
      });
      onClose();
    } catch {
      // update.error renders in the form
    }
  }

  return (
    <RowForm label={`Edit ${field.name}`} onSubmit={submit} onCancel={onClose} canSave={canSave} busy={update.isPending} error={duplicateOptions ? "Option values must be unique." : update.isError ? fieldError(update.error, "Could not save the field.") : null}>
      <div className="row-form-grid">
        <div className="field">
          <label htmlFor={`ef-name-${field.id}`}>Name</label>
          <input id={`ef-name-${field.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
      </div>
      {field.kind === "select" && <OptionsEditor options={options} onChange={setOptions} />}
    </RowForm>
  );
}

function FieldRow({
  field,
  index,
  count,
  expanded,
  onExpand,
  onClose,
  onMove,
  moveError,
}: {
  field: FieldDefinition;
  index: number;
  count: number;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onMove: (dir: -1 | 1) => void;
  moveError?: string;
}) {
  const archive = useArchiveField();
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsRow
      identity={
        <>
          <span className="row-name">{field.name}</span>
          <span className="mono muted">{field.key}</span>
        </>
      }
      facts={
        <>
          <span>{KIND_LABELS[field.kind]}</span>
          {field.required && <Chip family="stone">Required</Chip>}
          {field.kind === "select" && <span>{field.options.length} {field.options.length === 1 ? "option" : "options"}</span>}
        </>
      }
      actions={
        !confirming && (
          <>
            <RowAction icon={PencilSimple} label="Edit" onClick={onExpand} />
            <RowAction icon={ArrowUp} label="Move up" onClick={() => onMove(-1)} disabled={index === 0} />
            <RowAction icon={ArrowDown} label="Move down" onClick={() => onMove(1)} disabled={index === count - 1} />
            <RowAction icon={Archive} label="Archive" onClick={() => { archive.reset(); setConfirming(true); }} />
          </>
        )
      }
      expanded={expanded}
    >
      {moveError && <RowError message={moveError} />}
      {archive.isError && <RowError message={errorMessage(archive.error, "Could not archive the field.")} />}
      {confirming && (
        <RowConfirm
          question={`Archive ${field.name}?`}
          note="Values stay stored but hidden."
          action="Archive"
          busy={archive.isPending}
          onConfirm={() => archive.mutate(field.id, { onSuccess: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      )}
      {expanded && <EditFieldForm key={field.id} field={field} onClose={onClose} />}
    </SettingsRow>
  );
}

/**
 * Settings tab for the project's custom ticket fields: add, reorder, edit, and archive.
 * Archiving keeps a field's stored values on tickets but drops it from new forms and this list.
 */
export function FieldsTab({ projectId }: { projectId: string }) {
  const fields = useFields(projectId);
  const update = useUpdateField();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ id: string; message: string } | null>(null);

  const list = useMemo(
    () => [...(fields.data ?? [])].filter((f) => !f.archived).sort((a, b) => a.position - b.position),
    [fields.data],
  );

  async function move(field: FieldDefinition, dir: -1 | 1) {
    const pair = swapNeighbour(list, list.findIndex((f) => f.id === field.id), dir);
    if (!pair) return;
    setMoveError(null);
    try {
      await Promise.all(pair.map((p) => update.mutateAsync({ id: p.id, patch: { position: p.position } })));
    } catch {
      setMoveError({ id: field.id, message: "Could not reorder" });
      fields.refetch();
    }
  }

  const state = tabState({ query: fields, label: "fields" });
  if (state) return state;

  const close = () => setExpandedId(null);

  return (
    <SettingsSection
      description="Fields are extra properties every ticket carries. Required fields must be filled when a ticket is created."
      action={<button type="button" className="btn" onClick={() => setExpandedId(NEW)} disabled={expandedId === NEW}>Add field</button>}
    >
      <SettingsList label="Fields">
        {expandedId === NEW && (
          <li className="settings-row" data-expanded="true">
            <NewFieldForm projectId={projectId} onClose={close} />
          </li>
        )}
        {list.length === 0 && expandedId !== NEW && <EmptyRow mark>No custom fields yet. Add one to capture extra ticket data.</EmptyRow>}
        {list.map((f, i) => (
          <FieldRow
            key={f.id}
            field={f}
            index={i}
            count={list.length}
            expanded={expandedId === f.id}
            onExpand={() => setExpandedId(f.id)}
            onClose={close}
            onMove={(dir) => move(f, dir)}
            moveError={moveError?.id === f.id ? moveError.message : undefined}
          />
        ))}
      </SettingsList>
    </SettingsSection>
  );
}
