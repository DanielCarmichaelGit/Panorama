import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import type { FieldDefinition, FieldValue, LinkKind, Ticket } from "@panorama/core";
import {
  useAddLink,
  useAgents,
  useCreateTag,
  useEpics,
  useEvidenceTypes,
  useFields,
  useGates,
  useLanes,
  useLinks,
  useMoveTicket,
  useRemoveLink,
  useSetFlag,
  useTags,
  useTicket,
  useTickets,
  useUpdateTicket,
} from "../lib/hooks";
import { AddEvidence } from "../components/AddEvidence";
import { Chip } from "../components/Chip";
import { Composer } from "../components/Composer";
import { FieldControl, isFieldEmpty } from "../components/FieldControl";
import { GateList, laneOptionLabel, nextLane } from "../components/GateList";
import { Picker, type PickerOption } from "../components/Picker";
import { Thread } from "../components/Thread";
import { toggleTaskItem } from "../lib/criteria";
import { isPickerOpen } from "../lib/keys";
import { Markdown } from "../lib/markdown";

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function metaValue(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** What a `?notice=` on the ticket route means, in the panel's own words. */
const NOTICES: Record<string, string> = {
  partial: "Ticket created; some details did not save",
};

function EpicRow({ ticket }: { ticket: Ticket }) {
  const epics = useEpics(ticket.projectId);
  const update = useUpdateTicket();
  const [error, setError] = useState("");
  const options: PickerOption[] = (epics.data ?? []).filter((e) => !e.archived).map((e) => ({ id: e.id, label: e.name, family: e.family, color: e.color }));

  return (
    <>
      <span className="props-label">Arc</span>
      <div className="props-control">
        <Picker
          id="tp-epic"
          label="Arc"
          hideLabel
          swatch
          clearable
          busy={epics.isPending}
          value={ticket.epicId}
          onChange={(epicId) => {
            setError("");
            update.mutate({ id: ticket.id, patch: { epicId } }, { onError: (e) => setError(errorMessage(e, "Could not save the arc.")) });
          }}
          options={options}
        />
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </>
  );
}

function TagsRow({ ticket }: { ticket: Ticket }) {
  const tags = useTags(ticket.projectId);
  const update = useUpdateTicket();
  const createTag = useCreateTag();
  const [error, setError] = useState("");
  const options: PickerOption[] = (tags.data ?? []).filter((t) => !t.archived).map((t) => ({ id: t.id, label: t.name, family: t.family, color: t.color }));

  return (
    <>
      <span className="props-label">Tags</span>
      <div className="props-control">
        <Picker
          id="tp-tags"
          label="Tags"
          hideLabel
          multi
          swatch
          searchable
          busy={tags.isPending}
          values={ticket.tagIds}
          onChange={(tagIds) => {
            setError("");
            update.mutate({ id: ticket.id, patch: { tagIds } }, { onError: (e) => setError(errorMessage(e, "Could not save the tags.")) });
          }}
          options={options}
          onCreate={async (text) => {
            const tag = await createTag.mutateAsync({ projectId: ticket.projectId, name: text });
            return { id: tag.id, label: tag.name, family: tag.family, color: tag.color };
          }}
        />
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </>
  );
}

interface DependencyRowProps {
  id: string;
  label: string;
  ticket: Ticket;
  options: PickerOption[];
  busy: boolean;
  /** ids of the other tickets currently linked in this row's direction. */
  linkedIds: string[];
  /** linkId for each of those other tickets, so a removal knows which link to delete. */
  linkIdByOther: Map<string, string>;
  /** "blocks": this ticket blocks the other. "blocked_by": the other blocks this ticket. */
  direction: "blocks" | "blocked_by";
}

/**
 * One dependency row (Blocks or Blocked by): a multi Picker over the project's other tickets.
 * A `blocks` link always POSTs from the blocking ticket's own endpoint (the server takes the URL
 * ticket as `fromId`), so "Blocked by" adds the link from the *other* ticket, not this one.
 * Removal always goes through this ticket's own endpoint, which accepts a link touching it from
 * either side.
 */
function DependencyRow({ id, label, ticket, options, busy, linkedIds, linkIdByOther, direction }: DependencyRowProps) {
  const addLink = useAddLink();
  const removeLink = useRemoveLink();
  const [error, setError] = useState("");
  const kind: LinkKind = "blocks";

  function onChange(nextIds: string[]) {
    setError("");
    const added = nextIds.find((x) => !linkedIds.includes(x));
    if (added) {
      const from = direction === "blocks" ? ticket.id : added;
      const to = direction === "blocks" ? added : ticket.id;
      addLink.mutate({ ticketId: from, toId: to, kind }, { onError: (e) => setError(errorMessage(e, "Could not add that link.")) });
      return;
    }
    const removed = linkedIds.find((x) => !nextIds.includes(x));
    if (removed) {
      const linkId = linkIdByOther.get(removed);
      if (!linkId) return;
      removeLink.mutate({ ticketId: ticket.id, linkId }, { onError: (e) => setError(errorMessage(e, "Could not remove that link.")) });
    }
  }

  return (
    <>
      <span className="props-label">{label}</span>
      <div className="props-control">
        <Picker
          id={id}
          label={label}
          hideLabel
          multi
          searchable
          busy={busy}
          values={linkedIds}
          onChange={onChange}
          options={options}
        />
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </>
  );
}

function FieldRow({ ticket, def }: { ticket: Ticket; def: FieldDefinition }) {
  const update = useUpdateTicket();
  const [error, setError] = useState("");
  const committed: FieldValue = ticket.fields[def.key] ?? null;
  const [draft, setDraft] = useState<FieldValue>(committed);

  useEffect(() => {
    setDraft(committed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id, def.key, committed]);

  function save(value: FieldValue) {
    // FieldControl already normalises before calling onCommit (blank text to null, for one), so
    // comparing against `committed` here catches every "nothing actually changed" case: text and
    // number fields commit on blur even when untouched, and this is what stops that from PATCHing.
    if (value === committed) return;
    setError("");
    update.mutate(
      { id: ticket.id, patch: { fields: { [def.key]: value } } },
      { onError: (e) => { setDraft(committed); setError(errorMessage(e, "Could not save this field.")); } },
    );
  }

  const inputId = `tp-field-${def.id}`;

  return (
    <>
      <span className="props-label">
        {def.name}
        {def.required && " *"}
      </span>
      <div className="props-control">
        <FieldControl id={inputId} def={def} value={draft} onChange={setDraft} onCommit={save} ticketId={ticket.id} />
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </>
  );
}

export function TicketPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [searchParams] = useSearchParams();
  const notice = NOTICES[searchParams.get("notice") ?? ""];
  const ticket = useTicket(id);
  const lanes = useLanes(ticket.data?.projectId);
  const agents = useAgents().data ?? [];
  const gates = useGates(id);
  const evidenceTypes = useEvidenceTypes().data ?? [];
  const move = useMoveTicket();
  const setFlag = useSetFlag();
  const update = useUpdateTicket();
  const fields = useFields(ticket.data?.projectId);
  const projectTickets = useTickets(ticket.data?.projectId);
  const links = useLinks(id);
  const criteriaSave = useUpdateTicket();
  const criteriaToggle = useUpdateTicket();

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState("");
  const [laneChoice, setLaneChoice] = useState<string | null>(null);
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState(false);
  const [criteriaDraft, setCriteriaDraft] = useState("");
  const [criteriaError, setCriteriaError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const criteriaRef = useRef<HTMLDivElement>(null);
  // The base every checkbox toggle builds on. Kept as a ref, not a plain closed-over variable, so
  // a second tick fired before the first tick's PATCH resolves reads the *first* tick's already-
  // toggled markdown rather than the stale snapshot from when the listeners were attached: without
  // this, two quick ticks would each rewrite the same original line index against the same
  // original text, and whichever PATCH resolved last would silently win, losing the other's change.
  const latestCriteriaRef = useRef("");

  useEffect(() => {
    if (ticket.data) setTitle(ticket.data.title);
  }, [ticket.data?.id, ticket.data?.title]);

  // The server has spoken: whatever lane it reports is the one to show.
  useEffect(() => {
    setLaneChoice(null);
  }, [ticket.data?.id, ticket.data?.laneId]);

  useEffect(() => {
    if (ticket.data) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.data?.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // TipTap owns Escape inside the editor (e.g. closing its own suggestion popups); the panel
      // must not also close underneath it while the comment composer has focus.
      if (document.activeElement?.closest(".ProseMirror")) return;
      e.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // <Markdown> renders a task-list checkbox as an inert, disabled marker (see lib/markdown.tsx);
  // this is the one place they become interactive. Ticking one rewrites the corresponding line
  // of the stored markdown and PATCHes it back, rather than tracking checked state in React,
  // since the markdown itself (not a parallel bit of state) is the source of truth for it.
  useEffect(() => {
    if (editingCriteria) return;
    const container = criteriaRef.current;
    if (!container || !ticket.data) return;
    latestCriteriaRef.current = ticket.data.successCriteria;
    const boxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    const cleanups: (() => void)[] = [];
    boxes.forEach((box, index) => {
      box.disabled = false;
      const onChange = (e: Event) => {
        const checked = (e.target as HTMLInputElement).checked;
        setCriteriaError("");
        // Read and update the shared ref, not the `ticket.data.successCriteria` this effect
        // closed over: a second tick must build on the first tick's already-toggled text. The
        // index itself stays valid across that: toggling a marker never changes which line is
        // the nth task item.
        const next = toggleTaskItem(latestCriteriaRef.current, index, checked);
        latestCriteriaRef.current = next;
        criteriaToggle.mutate(
          { id, patch: { successCriteria: next } },
          {
            onError: (err) => {
              box.checked = !checked;
              // Discard this failed optimistic step and fall back to the last known server value,
              // rather than leaving the ref pointing at markdown that was never actually saved.
              latestCriteriaRef.current = ticket.data!.successCriteria;
              setCriteriaError(errorMessage(err, "Could not save success criteria."));
            },
          },
        );
      };
      box.addEventListener("change", onChange);
      cleanups.push(() => box.removeEventListener("change", onChange));
    });
    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.data?.successCriteria, editingCriteria, id]);

  function startEditCriteria() {
    if (!ticket.data) return;
    setCriteriaDraft(ticket.data.successCriteria);
    setCriteriaError("");
    setEditingCriteria(true);
  }

  async function saveCriteria() {
    try {
      setCriteriaError("");
      await criteriaSave.mutateAsync({ id, patch: { successCriteria: criteriaDraft } });
      setEditingCriteria(false);
    } catch (e) {
      setCriteriaError(errorMessage(e, "Could not save success criteria."));
    }
  }

  async function saveTitle() {
    const trimmed = title.trim();
    if (!ticket.data || !trimmed || trimmed === ticket.data.title) {
      if (ticket.data) setTitle(ticket.data.title);
      return;
    }
    const previous = ticket.data.title;
    try {
      setTitleError("");
      await update.mutateAsync({ id, patch: { title: trimmed } });
    } catch (e) {
      setTitle(previous);
      setTitleError(e instanceof Error ? e.message : "Could not save the title.");
    }
  }

  if (ticket.isPending) {
    return (
      <aside className="panel" role="dialog" aria-label="Loading ticket">
        <div className="panel-head">
          <span className="mono muted">Loading</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <X size={16} weight="regular" aria-hidden="true" />
          </button>
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
      </aside>
    );
  }

  if (ticket.isError || !ticket.data) {
    return (
      <aside className="panel" role="dialog" aria-label="Ticket">
        <div className="panel-head">
          <span className="mono muted">Ticket</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <X size={16} weight="regular" aria-hidden="true" />
          </button>
        </div>
        <p className="error" role="alert">Could not load the ticket.</p>
        <button className="btn" onClick={() => ticket.refetch()}>Try again</button>
      </aside>
    );
  }

  const t = ticket.data;
  const flagged = t.flags.includes("needs_human");
  const laneList = [...(lanes.data ?? [])].sort((a, b) => a.position - b.position);
  const assignee = agents.find((a) => a.id === t.assigneeId);
  const metaEntries = Object.entries(t.metadata);
  const next = nextLane(laneList, t.laneId);

  const activeFields = [...(fields.data ?? [])].filter((f) => !f.archived).sort((a, b) => a.position - b.position);
  const needsFields = activeFields.some((f) => f.required && isFieldEmpty(f, t.fields[f.key]));

  const dependencyOptions: PickerOption[] = (projectTickets.data ?? [])
    .filter((tk) => tk.id !== t.id)
    .map((tk) => ({ id: tk.id, label: `${tk.key} ${tk.title}` }));
  const allLinks = links.data?.links ?? [];
  const blocksLinks = allLinks.filter((l) => l.kind === "blocks" && l.fromId === t.id);
  const blockedByLinks = allLinks.filter((l) => l.kind === "blocks" && l.toId === t.id);
  const dependenciesBusy = projectTickets.isPending || links.isPending;

  return (
    <aside
      className="panel"
      role="dialog"
      aria-label={t.key}
      onKeyDown={(e) => {
        // Dismissing an open Picker's popover (the Lane picker) must not also close the whole
        // panel underneath it; the document-level Escape handler below runs after this one, but
        // only sees the Picker already closed, so it has to be stopped here instead.
        if (e.key === "Escape" && isPickerOpen()) e.stopPropagation();
      }}
    >
      <div className="panel-head">
        <span className="mono muted">{t.key}</span>
        <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
          <X size={16} weight="regular" aria-hidden="true" />
        </button>
      </div>
      {notice && <p className="error" role="alert">{notice}</p>}
      <div className="panel-title-row">
        <input
          className="title-input"
          aria-label="Title"
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
        />
        {needsFields && <Chip family="coral">Needs fields</Chip>}
      </div>
      {titleError && <p className="error" role="alert">{titleError}</p>}

      <div className="section-row">
        <h2>Success criteria</h2>
        {!editingCriteria && <button type="button" className="btn ghost" onClick={startEditCriteria}>Edit</button>}
      </div>
      {editingCriteria ? (
        <div className="criteria-editor">
          <Composer mode="draft" content={t.successCriteria} onChange={setCriteriaDraft} />
          {criteriaError && <p className="error" role="alert">{criteriaError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={() => setEditingCriteria(false)}>Cancel</button>
            <button type="button" className="btn" disabled={criteriaSave.isPending} onClick={saveCriteria}>
              {criteriaSave.isPending ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      ) : t.successCriteria.trim() === "" ? (
        <p className="muted">No success criteria yet.</p>
      ) : (
        <div ref={criteriaRef}>
          <Markdown body={t.successCriteria} />
          {criteriaError && <p className="error" role="alert">{criteriaError}</p>}
        </div>
      )}

      <h2 className="section-title">Properties</h2>
      <div className="props">
        <EpicRow ticket={t} />
        <TagsRow ticket={t} />
        <DependencyRow
          id="tp-blocks"
          label="Blocks"
          ticket={t}
          options={dependencyOptions}
          busy={dependenciesBusy}
          direction="blocks"
          linkedIds={blocksLinks.map((l) => l.toId)}
          linkIdByOther={new Map(blocksLinks.map((l) => [l.toId, l.id]))}
        />
        <DependencyRow
          id="tp-blocked-by"
          label="Blocked by"
          ticket={t}
          options={dependencyOptions}
          busy={dependenciesBusy}
          direction="blocked_by"
          linkedIds={blockedByLinks.map((l) => l.fromId)}
          linkIdByOther={new Map(blockedByLinks.map((l) => [l.fromId, l.id]))}
        />
        {activeFields.map((f) => <FieldRow key={f.id} ticket={t} def={f} />)}
      </div>

      <Picker
        id="tp-lane"
        label="Lane"
        swatch
        disabled={move.isPending}
        value={laneChoice ?? t.laneId}
        onChange={(laneId) => {
          if (!laneId) return;
          setLaneChoice(laneId);
          move.mutate({ id, laneId }, { onError: () => setLaneChoice(null) });
        }}
        options={laneList.map((l) => {
          const missing = gates.data?.[l.id] ?? [];
          // Until the gates come back, nothing is known about what any other lane needs.
          // Offering them anyway invites a move the server will refuse, so they stay shut.
          const disabled = l.id !== t.laneId && (gates.isPending || missing.length > 0);
          return { id: l.id, label: l.name, family: l.family, disabled, disabledReason: disabled ? laneOptionLabel(l, missing, evidenceTypes) : undefined };
        })}
      />
      {move.isError && <p className="error" role="alert">{move.error instanceof Error ? move.error.message : "Could not move the ticket."}</p>}
      {t.flags.length > 0 && (
        <div className="chips">
          {t.flags.map((f) => <Chip key={f} family={f === "needs_human" ? "coral" : "stone"}>{f.replace(/_/g, " ")}</Chip>)}
        </div>
      )}
      <button
        type="button"
        className={flagged ? "btn" : "btn ghost"}
        disabled={setFlag.isPending}
        onClick={() => setFlag.mutate({ id, flag: "needs_human", on: !flagged })}
      >
        {flagged ? "Clear needs human" : "Flag for human"}
      </button>
      {setFlag.isError && <p className="error" role="alert">{setFlag.error instanceof Error ? setFlag.error.message : "Could not update the flag."}</p>}
      <dl className="kv">
        <dt>Assignee</dt><dd className="mono">{assignee ? assignee.name : "Unassigned"}</dd>
        <dt>Created</dt><dd className="mono">{when(t.createdAt)}</dd>
        <dt>Updated</dt><dd className="mono">{when(t.updatedAt)}</dd>
      </dl>
      {metaEntries.length > 0 && (
        <>
          <h2>Metadata</h2>
          <dl className="kv">
            {metaEntries.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="mono">{k}</dt>
                <dd className="mono">{metaValue(v)}</dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}
      <GateList
        lane={next}
        missing={gates.data?.[next?.id ?? ""] ?? []}
        types={evidenceTypes}
        actions={<button type="button" className="btn ghost" onClick={() => setAddingEvidence(true)}>Add evidence</button>}
      />
      <h2>Thread</h2>
      <Thread ticketId={t.id} />
      <Composer key={t.id} ticketId={t.id} onPosted={() => {}} />
      {addingEvidence && <AddEvidence ticketId={t.id} types={evidenceTypes} onClose={() => setAddingEvidence(false)} />}
    </aside>
  );
}
