import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Flask, Plus, Trash } from "@phosphor-icons/react";
import type { CanvasError, Lane, Project, Rule } from "@boomerang/core";
import { canonical, canvasToRule } from "@boomerang/core";
import { Chip } from "../components/Chip";
import { Picker } from "../components/Picker";
import { RowConfirm } from "../components/settings/primitives";
import { RuleCanvas } from "../components/automations/RuleCanvas";
import { RunLog, ago } from "../components/automations/RunLog";
import { EMPTY_OPTIONS, namesFrom, type CanvasOptions } from "../components/automations/nodes";
import { initialDoc, initialState, isElseId, ownerOf, reducer, toDoc } from "../components/automations/store";
import { actionSentence, errorSentence, eventLabel, refusalSentence, type Names } from "../components/automations/vocab";
import { ApiError } from "../lib/api";
import {
  useAgents,
  useBoards,
  useCreateRule,
  useDeleteRule,
  useDestinations,
  useEpics,
  useEvidenceTypes,
  useFields,
  useRules,
  useTags,
  useTestRule,
  useTickets,
  useUpdateRule,
  type RuleSummary,
  type RuleTestResult,
} from "../lib/hooks";
import { BoomerangScene } from "../lib/iso";

/**
 * Automations: the rule list on the left, the canvas for the selected rule on the right, the
 * run log below it. A new rule is a draft (one event node in the middle) until its first save;
 * saving runs canvasToRule here first and names the offending nodes, then the server runs it
 * again and its canvas_invalid answer is mapped to the same nodes.
 */

export const DRAFT_ID = "new";

function eventFamily(rule: Rule): "coral" | "lilac" {
  return rule.event.type === "schedule" ? "lilac" : "coral";
}

/** The enable toggle. It flips at once and settles on what the server answers; while the PATCH is in flight it takes no second click. */
function EnableSwitch({ rule, onChange, busy }: { rule: RuleSummary; onChange: (enabled: boolean) => void; busy?: boolean }) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => {
    if (!busy) setOptimistic(null);
  }, [busy, rule.enabled]);
  const checked = optimistic ?? rule.enabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${rule.name} enabled`}
      className="switch"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={(e) => {
        e.stopPropagation();
        setOptimistic(!checked);
        onChange(!checked);
      }}
    >
      <span className="switch-knob" aria-hidden="true" />
    </button>
  );
}

function RuleList({ rules, selectedId, busyId, onSelect, onNew, onToggle }: { rules: RuleSummary[]; selectedId: string | undefined; busyId: string | null; onSelect: (id: string) => void; onNew: () => void; onToggle: (rule: RuleSummary, enabled: boolean) => void }) {
  return (
    <aside className="rule-list" aria-label="Rules">
      <div className="rule-list-head">
        <h2>Rules</h2>
        <button type="button" className="btn small" onClick={onNew}>
          <Plus size={14} weight="bold" aria-hidden="true" /> New rule
        </button>
      </div>
      <ul className="settings-list rule-rows" aria-label="Rules">
        {rules.length === 0 && (
          <li className="settings-empty">
            <p className="muted">No rules yet.</p>
          </li>
        )}
        {rules.map((rule) => (
          <li key={rule.id} className="settings-row rule-row" data-expanded={rule.id === selectedId || undefined} aria-current={rule.id === selectedId || undefined}>
            <div className="row-id">
              <button type="button" className="rule-row-name" onClick={() => onSelect(rule.id)} aria-current={rule.id === selectedId ? "true" : undefined}>
                <span className="row-name">{rule.name}</span>
              </button>
            </div>
            <div className="row-facts">
              <Chip family={eventFamily(rule)}>{eventLabel(rule.event.type)}</Chip>
              <span className="mono">{rule.lastFiredAt ? ago(rule.lastFiredAt) : "Never fired"}</span>
              {typeof rule.runCount === "number" && <span className="mono">{rule.runCount} {rule.runCount === 1 ? "run" : "runs"}</span>}
            </div>
            <div className="row-actions">
              <EnableSwitch rule={rule} busy={busyId === rule.id} onChange={(enabled) => onToggle(rule, enabled)} />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

interface Bar {
  kind: "error" | "test" | "saved";
  lines: string[];
}

type Drawn = { id: string; kind: Rule["canvas"]["nodes"][number]["kind"]; data: Record<string, unknown> };

/** Errors as bar lines and, for the ones that name a node, a ring on the drawn node (a synthesised else node maps to its condition; two_events rings nothing). */
function mapErrors(errors: CanvasError[], nodes: Drawn[], names: Names): { byNode: Map<string, string>; lines: string[] } {
  const describe = (id: string) => nodes.find((n) => n.id === id);
  const byNode = new Map<string, string>();
  const lines: string[] = [];
  for (const e of errors) {
    const owner = e.nodeId ? ownerOf(e.nodeId, nodes) : undefined;
    const sentence = errorSentence({ ...e, nodeId: owner }, describe, names);
    lines.push(sentence);
    if (owner && !byNode.has(owner)) byNode.set(owner, sentence);
  }
  return { byNode, lines };
}

function RuleEditor({ rule, project, lanes, onSaved, onDeleted, onDirtyChange }: { rule: RuleSummary; project: Project; lanes: Lane[]; onSaved: (saved: Rule) => void; onDeleted: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const draft = rule.id === DRAFT_ID;
  const [state, dispatch] = useReducer(reducer, rule.canvas, initialState);
  const [name, setName] = useState(rule.name);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [litEdges, setLitEdges] = useState<Set<string>>(new Set());
  const [bar, setBar] = useState<Bar | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const boards = useBoards(project.id);
  const epics = useEpics(project.id);
  const tags = useTags(project.id);
  const agents = useAgents();
  const evidenceTypes = useEvidenceTypes();
  const fields = useFields(project.id);
  const destinations = useDestinations(project.id);
  const tickets = useTickets(project.id);
  const create = useCreateRule();
  const update = useUpdateRule();
  const remove = useDeleteRule();
  const test = useTestRule();

  const options = useMemo<CanvasOptions>(() => {
    const flags = new Set<string>(EMPTY_OPTIONS.flags);
    for (const t of tickets.data ?? []) for (const f of t.flags) flags.add(f);
    return {
      lanes,
      boards: boards.data ?? [],
      epics: epics.data ?? [],
      tags: tags.data ?? [],
      actors: agents.data ?? [],
      evidenceTypes: evidenceTypes.data ?? [],
      fields: fields.data ?? [],
      destinations: destinations.data ?? [],
      flags: [...flags],
    };
  }, [lanes, boards.data, epics.data, tags.data, agents.data, evidenceTypes.data, fields.data, destinations.data, tickets.data]);
  const names = useMemo(() => namesFrom(options), [options]);

  const doc = useMemo(() => toDoc(state), [state]);
  const dirty = draft || name.trim() !== rule.name || canonical(doc) !== canonical(rule.canvas);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  // What the drawing means, positions and selection left out: editing it again clears what the
  // last save or test said, while moving or selecting a node keeps the rings and the bar.
  const meaning = useMemo(() => canonical({ nodes: state.nodes.map((n) => ({ id: n.id, kind: n.kind, data: n.data })), edges: state.edges }), [state.nodes, state.edges]);
  useEffect(() => {
    setErrors(new Map());
    setLit(new Set());
    setLitEdges(new Set());
    setBar((b) => (b && b.kind !== "test" ? null : b));
  }, [meaning]);

  function showErrors(list: CanvasError[]) {
    const m = mapErrors(list, state.nodes, names);
    setErrors(m.byNode);
    setLit(new Set());
    setLitEdges(new Set());
    setBar({ kind: "error", lines: m.lines });
  }

  async function save() {
    setFailure(null);
    const r = canvasToRule(doc);
    if ("errors" in r) {
      showErrors(r.errors);
      return;
    }
    const trimmed = name.trim() || "Untitled rule";
    try {
      const saved = draft
        ? await create.mutateAsync({ projectId: project.id, name: trimmed, enabled: rule.enabled, canvas: doc })
        : await update.mutateAsync({ id: rule.id, patch: { name: trimmed, canvas: doc } });
      setErrors(new Map());
      setBar({ kind: "saved", lines: ["Saved."] });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "canvas_invalid" && Array.isArray((e.details as { errors?: unknown })?.errors)) {
        showErrors((e.details as { errors: CanvasError[] }).errors);
        return;
      }
      setFailure(e instanceof Error ? e.message : "Could not save the rule.");
    }
  }

  async function runTest(ticketId: string | null) {
    setTesting(false);
    if (!ticketId) return;
    setFailure(null);
    try {
      const result: RuleTestResult = await test.mutateAsync({ id: rule.id, ticketId });
      const key = tickets.data?.find((t) => t.id === ticketId)?.key ?? ticketId;
      // A drawn node lights up; a synthesised else node lights the else edges out of its condition instead.
      const nodesLit = new Set<string>();
      const edgesLit = new Set<string>();
      for (const id of result.nodeIds) {
        if (isElseId(id, state.nodes)) {
          const owner = ownerOf(id, state.nodes);
          for (const e of state.edges) if (e.label === "else" && e.source === owner) edgesLit.add(e.id);
        } else nodesLit.add(id);
      }
      setLit(nodesLit);
      setLitEdges(edgesLit);
      setErrors(new Map());
      const lines: string[] = [];
      if (result.matched) {
        lines.push(`Matched ${key}. Nothing was written.`);
        for (const a of result.actions) lines.push(`Would ${actionSentence(a as unknown as Record<string, unknown>, names).replace(/^./, (c) => c.toLowerCase())}`);
        if (result.actions.length === 0) lines.push("No action would run.");
      } else {
        lines.push(`No match on ${key}. The nodes that matched are lit; the rule stops at the first that is not.`);
      }
      for (const r of result.refusals ?? []) lines.push(refusalSentence({ action: r.action as unknown as Record<string, unknown>, missing: r.missing ?? [] }, names));
      setBar({ kind: "test", lines });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not test the rule.");
    }
  }

  const busy = create.isPending || update.isPending;
  const ticketOptions = useMemo(() => (tickets.data ?? []).filter((t) => !t.archived).map((t) => ({ id: t.id, label: t.title, hint: t.key })), [tickets.data]);

  return (
    <section className="rule-editor" aria-label={draft ? "New rule" : rule.name}>
      <div className="rule-editor-head">
        <input className="rule-name-input" aria-label="Rule name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name this rule" />
        <div className="rule-editor-actions">
          {testing ? (
            <div className="rule-test-picker">
              <Picker id="test-ticket" label="Ticket to test on" hideLabel options={ticketOptions} value={null} onChange={runTest} searchable autoOpen placeholder="Choose a ticket" busy={tickets.isPending} />
            </div>
          ) : (
            <button type="button" className="btn ghost small" onClick={() => setTesting(true)} disabled={draft || dirty || test.isPending} title={draft || dirty ? "Save the rule first" : "Run the rule against a ticket without acting"}>
              <Flask size={14} weight="regular" aria-hidden="true" /> {test.isPending ? "Testing" : "Test on ticket"}
            </button>
          )}
          {!draft && (
            <button type="button" className="btn ghost small" onClick={() => setConfirmDelete(true)} disabled={remove.isPending}>
              <Trash size={14} weight="regular" aria-hidden="true" /> Delete
            </button>
          )}
          <button type="button" className="btn small" onClick={save} disabled={busy || (!dirty && !draft)}>
            {busy ? "Saving" : "Save"}
          </button>
        </div>
      </div>
      {confirmDelete && (
        <div className="rule-confirm">
          <RowConfirm
            question={`Delete ${rule.name}?`}
            note="Its run log stays in the chain."
            action="Delete"
            busy={remove.isPending}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={async () => {
              try {
                await remove.mutateAsync(rule.id);
                onDeleted();
              } catch (e) {
                setFailure(e instanceof Error ? e.message : "Could not delete the rule.");
                setConfirmDelete(false);
              }
            }}
          />
        </div>
      )}
      {failure && <p className="error" role="alert">{failure}</p>}
      {bar && (
        <div className={`canvas-bar canvas-bar-${bar.kind}`} role={bar.kind === "error" ? "alert" : "status"}>
          <ul>
            {bar.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}
      <RuleCanvas state={state} dispatch={dispatch} options={options} names={names} errors={errors} lit={lit} litEdges={litEdges} />
      {!draft && <RunLog ruleId={rule.id} projectId={project.id} />}
    </section>
  );
}

export function Automations() {
  const { project, lanes } = useOutletContext<{ project: Project; lanes: Lane[] }>();
  const { ruleId } = useParams();
  const navigate = useNavigate();
  const rules = useRules(project.id);
  const update = useUpdateRule();
  const [draft, setDraft] = useState<RuleSummary | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const editorDirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    editorDirty.current = d;
  }, []);

  /** Leaving a rule with unsaved changes asks first. */
  function leave(go: () => void) {
    if (editorDirty.current && !window.confirm("You have unsaved changes. Leave this rule?")) return;
    go();
  }

  const list = rules.data ?? [];
  const selected: RuleSummary | undefined = ruleId === DRAFT_ID ? (draft ?? undefined) : list.find((r) => r.id === ruleId);

  function startDraft() {
    leave(() => {
      const now = new Date().toISOString();
      setDraft({ id: DRAFT_ID, projectId: project.id, name: "New rule", enabled: true, event: { type: "ticket.created" }, conditions: [], actions: [], canvas: initialDoc(), createdAt: now, updatedAt: now });
      navigate(`/automations/${DRAFT_ID}`);
    });
  }

  async function toggle(rule: RuleSummary, enabled: boolean) {
    setToggleError(null);
    setBusyId(rule.id);
    try {
      await update.mutateAsync({ id: rule.id, patch: { enabled } });
    } catch (e) {
      setToggleError(e instanceof Error ? e.message : "Could not change the rule.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="view auto-view">
      <div className="view-head enter-header">
        <h1>Automations</h1>
        {rules.data && <span className="count mono">{rules.data.length}</span>}
      </div>
      {rules.isError && <p className="error" role="alert">Could not load the rules.</p>}
      {toggleError && <p className="error" role="alert">{toggleError}</p>}
      <div className="auto-layout">
        {rules.isPending ? (
          <div className="rule-list">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
          </div>
        ) : (
          <RuleList rules={list} selectedId={selected?.id} busyId={busyId} onSelect={(id) => { if (id !== selected?.id) leave(() => navigate(`/automations/${id}`)); }} onNew={startDraft} onToggle={toggle} />
        )}
        {selected ? (
          <RuleEditor
            key={selected.id}
            rule={selected}
            project={project}
            lanes={lanes}
            onSaved={(saved) => {
              if (selected.id === DRAFT_ID) {
                setDraft(null);
                navigate(`/automations/${saved.id}`, { replace: true });
              }
            }}
            onDeleted={() => navigate("/automations", { replace: true })}
            onDirtyChange={onDirtyChange}
          />
        ) : (
          <div className="canvas-empty">
            <BoomerangScene compact />
            <p className="muted">{list.length ? "Choose a rule on the left, or start a new one." : "Draw your first rule: when something happens, if it fits, then act."}</p>
            {list.length === 0 && (
              <button type="button" className="btn" onClick={startDraft}>
                New rule
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
