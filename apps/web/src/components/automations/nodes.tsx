import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { Actor, Board, CanvasNodeKind, Epic, EvidenceType, FieldDefinition, Lane, Tag } from "@boomerang/core";
import { Picker, type PickerOption } from "../Picker";
import type { Destination } from "../../lib/hooks";
import {
  ACTION_OPTIONS,
  ACTOR_OPTIONS,
  CHANGED_OPTIONS,
  CONDITION_KINDS,
  CRON_PRESETS,
  EVENT_OPTIONS,
  KIND_LABEL,
  OP_OPTIONS,
  RESULT_OPTIONS,
  actionSentence,
  conditionSentence,
  eventSentence,
  opsFor,
  scheduleSentence,
  type Names,
} from "./vocab";

/**
 * The four node kinds, each a surface card in the house style: a family band on the left,
 * the kind label, the node's title as a sentence, and its Pickers inside. Everything a node
 * needs beyond its own data (the project's lanes, tags and so on, the setter, which nodes
 * are in error or lit by a test) comes through `CanvasContext`, so the node objects handed
 * to React Flow stay small and stable.
 */

export interface CanvasOptions {
  lanes: Lane[];
  boards: Board[];
  epics: Epic[];
  tags: Tag[];
  actors: Actor[];
  evidenceTypes: EvidenceType[];
  fields: FieldDefinition[];
  destinations: Destination[];
  /** Flag names in use on the project plus needs_human, for the flag Pickers. */
  flags: string[];
}

export interface CanvasContextValue {
  options: CanvasOptions;
  names: Names;
  setData: (id: string, data: Record<string, unknown>) => void;
  /** Node id to the sentence explaining what is wrong with it. */
  errors: Map<string, string>;
  /** Nodes the last test run matched. */
  lit: Set<string>;
}

export const EMPTY_OPTIONS: CanvasOptions = { lanes: [], boards: [], epics: [], tags: [], actors: [], evidenceTypes: [], fields: [], destinations: [], flags: ["needs_human"] };

const nameOr = (id: string, found: string | undefined) => found ?? id;

export function namesFrom(o: CanvasOptions): Names {
  return {
    lane: (id) => nameOr(id, o.lanes.find((l) => l.id === id)?.name),
    board: (id) => nameOr(id, o.boards.find((b) => b.id === id)?.name),
    epic: (id) => nameOr(id, o.epics.find((e) => e.id === id)?.name),
    tag: (id) => nameOr(id, o.tags.find((t) => t.id === id)?.name),
    actor: (id) => nameOr(id, o.actors.find((a) => a.id === id)?.name),
    evidenceType: (id) => nameOr(id, o.evidenceTypes.find((t) => t.id === id)?.name),
    field: (key) => nameOr(key, o.fields.find((f) => f.key === key)?.name),
    destination: (id) => nameOr(id, o.destinations.find((d) => d.id === id)?.name),
  };
}

export const CanvasContext = createContext<CanvasContextValue>({ options: EMPTY_OPTIONS, names: namesFrom(EMPTY_OPTIONS), setData: () => {}, errors: new Map(), lit: new Set() });

export type RuleNodeData = { values: Record<string, unknown> };
export type RuleNode = Node<RuleNodeData, CanvasNodeKind>;

const FLAG_RE = /^[a-z][a-z0-9_]{0,31}$/;

function laneOptions(o: CanvasOptions): PickerOption[] {
  return o.lanes.map((l) => ({ id: l.id, label: l.name, family: l.family }));
}
function boardOptions(o: CanvasOptions): PickerOption[] {
  return o.boards.map((b) => ({ id: b.id, label: b.name, family: b.family }));
}
function epicOptions(o: CanvasOptions): PickerOption[] {
  return o.epics.filter((e) => !e.archived).map((e) => ({ id: e.id, label: e.name, family: e.family, color: e.color }));
}
function tagOptions(o: CanvasOptions): PickerOption[] {
  return o.tags.filter((t) => !t.archived).map((t) => ({ id: t.id, label: t.name, family: t.family, color: t.color }));
}
function actorOptions(o: CanvasOptions): PickerOption[] {
  return o.actors.map((a) => ({ id: a.id, label: a.name, hint: a.kind === "agent" ? "agent" : undefined }));
}
function evidenceOptions(o: CanvasOptions): PickerOption[] {
  return o.evidenceTypes.map((t) => ({ id: t.id, label: t.name }));
}
function fieldOptions(o: CanvasOptions, kinds?: string[]): PickerOption[] {
  return o.fields.filter((f) => !f.archived && (!kinds || kinds.includes(f.kind))).map((f) => ({ id: f.key, label: f.name, hint: f.kind }));
}
function flagOptions(o: CanvasOptions, exclude?: string): PickerOption[] {
  return o.flags.filter((f) => f !== exclude).map((f) => ({ id: f, label: f }));
}
function destinationOptions(o: CanvasOptions): PickerOption[] {
  return o.destinations.map((d) => ({ id: d.id, label: d.name, hint: d.url }));
}

/** A typed flag name becomes an option when it is a flag name the engine accepts. */
function createFlag(text: string): PickerOption {
  const name = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!FLAG_RE.test(name)) throw new Error("A flag is lowercase letters, digits and underscores, starting with a letter.");
  return { id: name, label: name };
}

function Card({ id, kind, title, children }: { id: string; kind: CanvasNodeKind; title: string; children: React.ReactNode }) {
  const { errors, lit } = useContext(CanvasContext);
  const error = errors.get(id);
  const cls = ["rnode", `rnode-${kind}`, error ? "has-error" : "", lit.has(id) ? "is-lit" : ""].filter(Boolean).join(" ");
  return (
    <div className={cls} data-kind={kind} data-node-id={id}>
      <span className="rnode-band" aria-hidden="true" />
      <div className="rnode-head">
        <span className="rnode-kind">{KIND_LABEL[kind]}</span>
        <span className="rnode-title">{title}</span>
      </div>
      {/* nokey keeps React Flow's own key handling (arrows nudge, Enter selects) off the controls inside. */}
      <div className="rnode-body nodrag nowheel nokey">{children}</div>
      {error && <p className="rnode-error">{error}</p>}
      {kind !== "event" && kind !== "schedule" && <Handle type="target" position={Position.Left} className="rnode-handle" />}
      <Handle type="source" position={Position.Right} className="rnode-handle" />
    </div>
  );
}

const COMMIT_PAUSE_MS = 400;

/**
 * A text, number or date input (or a textarea) inside a node. Typing edits a local copy; the
 * value is committed to the drawing, as one history step, after a pause or on blur, so undo
 * steps back a phrase rather than a keystroke. An outside change (undo, redo) replaces the
 * local copy while the field is not being typed in.
 */
function Field({ label, value, onCommit, multiline, className, ...rest }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "className">) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(onCommit);
  latest.current = onCommit;
  useEffect(() => {
    if (!dirty.current) setText(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flush = (v: string) => {
    window.clearTimeout(timer.current);
    dirty.current = false;
    if (v !== value) latest.current(v);
  };
  const change = (v: string) => {
    setText(v);
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush(v), COMMIT_PAUSE_MS);
  };
  const cls = `input ${className ?? ""}`.trim();
  return (
    <label className="rnode-field">
      <span>{label}</span>
      {multiline ? (
        <textarea className={`${cls} rnode-textarea`} rows={3} value={text} onChange={(e) => change(e.target.value)} onBlur={() => flush(text)} placeholder={rest.placeholder} />
      ) : (
        <input className={cls} {...rest} value={text} onChange={(e) => change(e.target.value)} onBlur={() => flush(text)} />
      )}
    </label>
  );
}

const numberOrUndefined = (v: string) => (v === "" ? undefined : Number(v));

function useNode(id: string, data: RuleNodeData) {
  const ctx = useContext(CanvasContext);
  const values = data.values;
  const set = (next: Record<string, unknown>) => ctx.setData(id, next);
  /** Merges a change; a value of undefined drops the key, so the strict schemas never see a stale one. */
  const patch = (delta: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...values };
    for (const [k, v] of Object.entries(delta)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    set(next);
  };
  return { ...ctx, values, set, patch };
}

/** The event node: which chain event starts the rule, and its parameters when it has any. */
export function EventNode({ id, data }: NodeProps<RuleNode>) {
  const { options, names, values, set, patch } = useNode(id, data);
  const type = values.type as string | undefined;
  return (
    <Card id={id} kind="event" title={eventSentence(values, names)}>
      <Picker id={`${id}-event`} label="Event" options={EVENT_OPTIONS} value={type ?? null} onChange={(v) => set(v ? { type: v } : {})} placeholder="Choose an event" />
      {type === "ticket.moved" && (
        <div className="rnode-row">
          <Picker id={`${id}-from`} label="From lane" options={laneOptions(options)} value={(values.fromLaneId as string) ?? null} onChange={(v) => patch({ fromLaneId: v ?? undefined })} clearable swatch placeholder="Any lane" />
          <Picker id={`${id}-to`} label="To lane" options={laneOptions(options)} value={(values.toLaneId as string) ?? null} onChange={(v) => patch({ toLaneId: v ?? undefined })} clearable swatch placeholder="Any lane" />
        </div>
      )}
      {type === "evidence.added" && (
        <div className="rnode-row">
          <Picker id={`${id}-etype`} label="Evidence type" options={evidenceOptions(options)} value={(values.typeId as string) ?? null} onChange={(v) => patch({ typeId: v ?? undefined })} clearable placeholder="Any type" />
          <Picker id={`${id}-result`} label="Result" options={RESULT_OPTIONS} value={(values.result as string) ?? null} onChange={(v) => patch({ result: v ?? undefined })} clearable placeholder="Any result" />
        </div>
      )}
      {(type === "ticket.flag_set" || type === "ticket.flag_cleared") && (
        <Picker id={`${id}-flag`} label="Flag" options={flagOptions(options)} value={(values.flag as string) ?? null} onChange={(v) => patch({ flag: v ?? undefined })} clearable searchable onCreate={createFlag} createLabel={(t) => `Use flag '${t}'`} placeholder="Any flag" />
      )}
      {type === "ticket.updated" && (
        <Picker id={`${id}-changed`} label="What changed" options={CHANGED_OPTIONS} value={(values.changed as string) ?? null} onChange={(v) => patch({ changed: v ?? undefined })} clearable searchable onCreate={(t) => ({ id: t.trim(), label: t.trim() })} placeholder="Anything" />
      )}
    </Card>
  );
}

const IS_SINGLE = ["is", "is_not", "contains", "gte", "lte"];
const NO_VALUE = ["exists", "not_exists"];

/** The condition node: what to check, how, and against what, plus the sentence it reads as. */
export function ConditionNode({ id, data }: NodeProps<RuleNode>) {
  const { options, names, values, set, patch } = useNode(id, data);
  const kind = values.kind as string | undefined;
  const op = values.op as string | undefined;
  const fieldKind = values.fieldKind as string | undefined;
  const sentence = conditionSentence(values, names);
  const composite = kind === "all" || kind === "any" || kind === "not";

  function changeKind(next: string | null) {
    set(next ? { kind: next } : {});
  }
  function changeOp(next: string | null) {
    const keep: Record<string, unknown> = { kind };
    if (kind === "field") Object.assign(keep, { key: values.key, fieldKind });
    if (kind === "evidence") Object.assign(keep, { typeId: values.typeId, result: values.result });
    if (!next) {
      set(keep);
      return;
    }
    keep.op = next;
    if (kind === "evidence" && !NO_VALUE.includes(next)) keep.count = typeof values.count === "number" ? values.count : 1;
    if (next === "in") keep.values = Array.isArray(values.values) ? values.values : [];
    else if (IS_SINGLE.includes(next) && values.value !== undefined && !Array.isArray(values.value)) keep.value = values.value;
    set(keep);
  }
  function changeField(key: string | null) {
    const def = options.fields.find((f) => f.key === key);
    set(def ? { kind: "field", key: def.key, fieldKind: def.kind } : { kind: "field" });
  }

  const idOptions = (): PickerOption[] => {
    switch (kind) {
      case "lane":
        return laneOptions(options);
      case "board":
        return boardOptions(options);
      case "epic":
        return epicOptions(options);
      case "tag":
        return tagOptions(options);
      case "flag":
        return flagOptions(options);
      case "assignee":
        return actorOptions(options);
      case "actor":
        return ACTOR_OPTIONS;
      default:
        return [];
    }
  };
  const isIdKind = ["lane", "board", "epic", "tag", "flag", "assignee", "actor"].includes(kind ?? "");
  const selectDef = kind === "field" && fieldKind === "select" ? options.fields.find((f) => f.key === values.key) : undefined;
  const swatch = kind === "lane" || kind === "board" || kind === "epic" || kind === "tag";

  const valueControl = () => {
    if (!op || NO_VALUE.includes(op)) return null;
    if (isIdKind) {
      const opts = idOptions();
      if (op === "in") return <Picker id={`${id}-values`} label="Values" multi values={(values.values as string[]) ?? []} onChange={(ids) => patch({ values: ids })} options={opts} swatch={swatch} searchable={opts.length > 8} placeholder="Choose one or more" />;
      return <Picker id={`${id}-value`} label="Value" value={(values.value as string) ?? null} onChange={(v) => patch({ value: v ?? undefined })} options={opts} swatch={swatch} searchable={opts.length > 8} placeholder="Choose" />;
    }
    if (kind === "evidence") {
      return <Field label="Count" className="mono-input" type="number" min={0} step={1} value={typeof values.count === "number" ? String(values.count) : ""} onCommit={(v) => patch({ count: v === "" ? 0 : Math.max(0, Math.floor(Number(v))) })} />;
    }
    if (kind === "field") {
      if (fieldKind === "select" && selectDef) {
        const opts = selectDef.options.map((o) => ({ id: o.value, label: o.label }));
        if (op === "in") return <Picker id={`${id}-values`} label="Values" multi values={(values.values as string[]) ?? []} onChange={(ids) => patch({ values: ids })} options={opts} placeholder="Choose one or more" />;
        return <Picker id={`${id}-value`} label="Value" value={(values.value as string) ?? null} onChange={(v) => patch({ value: v ?? undefined })} options={opts} placeholder="Choose" />;
      }
      if (fieldKind === "checkbox") {
        const v = values.value === true ? "true" : values.value === false ? "false" : null;
        return <Picker id={`${id}-value`} label="Value" value={v} onChange={(x) => patch({ value: x === null ? undefined : x === "true" })} options={[{ id: "true", label: "Checked" }, { id: "false", label: "Unchecked" }]} placeholder="Choose" />;
      }
      if (fieldKind === "number") {
        return <Field label="Value" className="mono-input" type="number" value={typeof values.value === "number" ? String(values.value) : ""} onCommit={(v) => patch({ value: numberOrUndefined(v) })} />;
      }
      if (fieldKind === "date") {
        return <Field label="Date" type="date" value={(values.value as string) ?? ""} onCommit={(v) => patch({ value: v || undefined })} />;
      }
    }
    if (kind === "due_date") {
      return <Field label="Date" type="date" value={(values.value as string) ?? ""} onCommit={(v) => patch({ value: v || undefined })} />;
    }
    return <Field label="Text" type="text" value={(values.value as string) ?? ""} onCommit={(v) => patch({ value: v })} placeholder="Type a value" />;
  };

  return (
    <Card id={id} kind="condition" title={sentence}>
      {composite ? (
        <p className="rnode-note muted">Written outside the canvas. It runs as drawn; delete it to redraw.</p>
      ) : (
        <>
          <Picker id={`${id}-kind`} label="Check" options={CONDITION_KINDS} value={kind ?? null} onChange={changeKind} placeholder="Choose what to check" />
          {kind === "field" && <Picker id={`${id}-key`} label="Field" options={fieldOptions(options)} value={(values.key as string) ?? null} onChange={changeField} searchable={options.fields.length > 8} placeholder="Choose a field" />}
          {kind === "evidence" && (
            <div className="rnode-row">
              <Picker id={`${id}-etype`} label="Evidence type" options={evidenceOptions(options)} value={(values.typeId as string) ?? null} onChange={(v) => patch({ typeId: v ?? undefined })} placeholder="Choose a type" />
              <Picker id={`${id}-result`} label="Result" options={RESULT_OPTIONS} value={(values.result as string) ?? null} onChange={(v) => patch({ result: v ?? undefined })} clearable placeholder="Any result" />
            </div>
          )}
          {kind && (kind !== "field" || values.key) && opsFor(kind, fieldKind).length > 0 && (
            <div className="rnode-row">
              <Picker id={`${id}-op`} label="Operator" options={OP_OPTIONS(kind, fieldKind)} value={op ?? null} onChange={changeOp} placeholder="Choose" />
              {valueControl()}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const NONE = "__none__";

/** The action node: what the engine does, and the target it needs. */
export function ActionNode({ id, data }: NodeProps<RuleNode>) {
  const { options, names, values, set, patch } = useNode(id, data);
  const type = values.type as string | undefined;
  const setFieldDef = type === "set_field" ? options.fields.find((f) => f.key === values.key) : undefined;

  const fieldValueControl = () => {
    if (!setFieldDef) return null;
    switch (setFieldDef.kind) {
      case "select":
        return <Picker id={`${id}-value`} label="Value" options={setFieldDef.options.map((o) => ({ id: o.value, label: o.label }))} value={(values.value as string) ?? null} onChange={(v) => patch({ value: v ?? null })} placeholder="Choose" />;
      case "checkbox":
        return <Picker id={`${id}-value`} label="Value" options={[{ id: "true", label: "Checked" }, { id: "false", label: "Unchecked" }]} value={values.value === true ? "true" : values.value === false ? "false" : null} onChange={(v) => patch({ value: v === null ? null : v === "true" })} placeholder="Choose" />;
      case "number":
        return <Field label="Value" className="mono-input" type="number" value={typeof values.value === "number" ? String(values.value) : ""} onCommit={(v) => patch({ value: v === "" ? null : Number(v) })} />;
      case "date":
        return <Field label="Date" type="date" value={(values.value as string) ?? ""} onCommit={(v) => patch({ value: v || null })} />;
      default:
        return <Field label="Value" type="text" value={(values.value as string) ?? ""} onCommit={(v) => patch({ value: v })} placeholder="Type a value" />;
    }
  };

  return (
    <Card id={id} kind="action" title={actionSentence(values, names)}>
      <Picker id={`${id}-action`} label="Action" options={ACTION_OPTIONS} value={type ?? null} onChange={(v) => set(v ? { type: v } : {})} searchable placeholder="Choose an action" />
      {(type === "move_to_lane" || type === "create_ticket") && (
        <Picker id={`${id}-lane`} label="Lane" options={laneOptions(options)} value={(values.laneId as string) ?? null} onChange={(v) => patch({ laneId: v ?? undefined })} swatch placeholder="Choose a lane" />
      )}
      {type === "create_ticket" && (
        <>
          <Field label="Title" type="text" value={(values.title as string) ?? ""} onCommit={(v) => patch({ title: v })} placeholder="Follow up on {{ticket.key}}" />
          <div className="rnode-row">
            <Picker id={`${id}-board`} label="Board" options={boardOptions(options)} value={(values.boardId as string) ?? null} onChange={(v) => patch({ boardId: v ?? undefined })} clearable swatch placeholder="Same board" />
            <Picker id={`${id}-epic`} label="Arc" options={epicOptions(options)} value={(values.epicId as string) ?? null} onChange={(v) => patch({ epicId: v ?? undefined })} clearable swatch placeholder="No arc" />
          </div>
          <Picker id={`${id}-tags`} label="Tags" multi options={tagOptions(options)} values={(values.tagIds as string[]) ?? []} onChange={(ids) => patch({ tagIds: ids.length ? ids : undefined })} swatch placeholder="No tags" />
        </>
      )}
      {type === "move_to_board" && <Picker id={`${id}-board`} label="Board" options={boardOptions(options)} value={(values.boardId as string) ?? null} onChange={(v) => patch({ boardId: v ?? undefined })} swatch placeholder="Choose a board" />}
      {type === "set_flag" && (
        <Picker id={`${id}-flag`} label="Flag" options={flagOptions(options)} value={(values.flag as string) ?? null} onChange={(v) => patch({ flag: v ?? undefined })} searchable onCreate={createFlag} createLabel={(t) => `Use flag '${t}'`} placeholder="Choose a flag" />
      )}
      {type === "clear_flag" && (
        <Picker id={`${id}-flag`} label="Flag" options={flagOptions(options, "needs_human")} value={(values.flag as string) ?? null} onChange={(v) => patch({ flag: v ?? undefined })} searchable onCreate={createFlag} createLabel={(t) => `Use flag '${t}'`} placeholder="Choose a flag" describedBy={`${id}-flag-note`} />
      )}
      {type === "clear_flag" && <p id={`${id}-flag-note`} className="rnode-note muted">Only a person clears needs_human.</p>}
      {type === "assign" && (
        <Picker
          id={`${id}-assignee`}
          label="Assignee"
          options={[{ id: NONE, label: "Nobody" }, ...actorOptions(options)]}
          value={values.actorId === null ? NONE : ((values.actorId as string) ?? null)}
          onChange={(v) => patch({ actorId: v === NONE ? null : (v ?? undefined) })}
          placeholder="Choose"
        />
      )}
      {(type === "add_tag" || type === "remove_tag") && <Picker id={`${id}-tag`} label="Tag" options={tagOptions(options)} value={(values.tagId as string) ?? null} onChange={(v) => patch({ tagId: v ?? undefined })} swatch placeholder="Choose a tag" />}
      {type === "set_field" && (
        <div className="rnode-row">
          <Picker id={`${id}-key`} label="Field" options={fieldOptions(options, ["text", "number", "date", "select", "checkbox"])} value={(values.key as string) ?? null} onChange={(v) => set(v ? { type, key: v, value: null } : { type })} placeholder="Choose a field" />
          {fieldValueControl()}
        </div>
      )}
      {type === "set_epic" && (
        <Picker id={`${id}-epic`} label="Arc" options={[{ id: NONE, label: "No arc" }, ...epicOptions(options)]} value={values.epicId === null ? NONE : ((values.epicId as string) ?? null)} onChange={(v) => patch({ epicId: v === NONE ? null : (v ?? undefined) })} swatch placeholder="Choose an arc" />
      )}
      {type === "add_comment" && <Field label="Comment" multiline value={(values.body as string) ?? ""} onCommit={(v) => patch({ body: v })} placeholder="Posted by the system" />}
      {type === "emit_webhook" && (
        <Picker id={`${id}-dest`} label="Destination" options={destinationOptions(options)} value={(values.destinationId as string) ?? null} onChange={(v) => patch({ destinationId: v ?? undefined })} placeholder={options.destinations.length ? "Choose" : "No destinations yet"} />
      )}
    </Card>
  );
}

const CUSTOM = "__custom__";

let zones: PickerOption[] | null = null;
function timezoneOptions(current: string | undefined): PickerOption[] {
  if (!zones) {
    let list: string[] = [];
    try {
      const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
      list = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
    } catch {
      list = [];
    }
    if (!list.includes("UTC")) list = ["UTC", ...list];
    zones = list.map((z) => ({ id: z, label: z }));
  }
  return current && !zones.some((z) => z.id === current) ? [{ id: current, label: current }, ...zones] : zones;
}

/** The schedule node: a cron expression (a preset or typed) and its timezone. Task 9 brings the builder. */
export function ScheduleNode({ id, data }: NodeProps<RuleNode>) {
  const { values, patch } = useNode(id, data);
  const cron = (values.cron as string) ?? "";
  const preset = CRON_PRESETS.find((p) => p.id === cron);
  // Whether the cron field is shown lives here, not in the data: the schema is strict.
  const [customOn, setCustomOn] = useState(cron !== "" && !preset);
  const custom = customOn || (cron !== "" && !preset);
  return (
    <Card id={id} kind="schedule" title={scheduleSentence(values)}>
      <Picker
        id={`${id}-preset`}
        label="Schedule"
        options={[...CRON_PRESETS, { id: CUSTOM, label: "Custom cron" }]}
        value={custom ? CUSTOM : (preset?.id ?? null)}
        onChange={(v) => {
          if (v === CUSTOM) setCustomOn(true);
          else {
            setCustomOn(false);
            patch({ cron: v ?? undefined });
          }
        }}
        placeholder="Choose a schedule"
      />
      {custom && <Field label="Cron, five fields" className="mono-input" type="text" value={cron} onCommit={(v) => patch({ cron: v || undefined })} placeholder="0 9 * * 1-5" spellCheck={false} />}
      <Picker id={`${id}-tz`} label="Timezone" options={timezoneOptions(values.timezone as string | undefined)} value={(values.timezone as string) ?? null} onChange={(v) => patch({ timezone: v ?? undefined })} searchable placeholder="Choose a timezone" />
    </Card>
  );
}

export const nodeTypes = { event: EventNode, condition: ConditionNode, action: ActionNode, schedule: ScheduleNode };
