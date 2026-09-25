import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import type { CreateTicketInput, EvidenceType, FieldValue, Lane, Ticket } from "@panorama/core";
import { uploadFile } from "../lib/attachments";
import type { GateMiss } from "../lib/hooks";
import {
  useAddComment,
  useAddLink,
  useAgents,
  useBoards,
  useCreateEpic,
  useCreateTag,
  useCreateTicket,
  useEpics,
  useEvidenceTypes,
  useFields,
  useLanes,
  useSetFlag,
  useTags,
  useTickets,
  useUpdateTicket,
} from "../lib/hooks";
import { isPickerOpen } from "../lib/keys";
import { useFocusTrap } from "../lib/useFocusTrap";
import { Composer } from "./Composer";
import { FieldControl, isFieldEmpty } from "./FieldControl";
import { laneOptionLabel } from "./GateList";
import { Picker, type PickerOption } from "./Picker";

interface PendingFile { id: string; file: File }
interface UploadedAttachment { id: string; filename: string; isImage: boolean }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "a", "a and b", or "a, b and c". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The footer's automations preview. Until milestone 3 fills it with the project's rules, it says
 * which lanes will gate this ticket, read straight from the lanes' evidence requirements.
 */
export function gatePreview(lanes: Lane[], types: EvidenceType[]): string {
  const gated = lanes.filter((l) => l.evidenceRequirements.length > 0);
  if (gated.length === 0) return "No lanes gate this ticket yet.";
  const parts = gated.map((l) => {
    const names = l.evidenceRequirements.map((r) => types.find((t) => t.id === r.typeId)?.name ?? r.typeId);
    return `${l.name} (${names.join(", ")})`;
  });
  return `Gated at ${joinNames(parts)}.`;
}

/**
 * The full-screen dialog to create a ticket: title, description, success criteria, and
 * attachments on the left; board, lane, arc, tags, assignee, dates, dependencies, needs human,
 * and the project's custom fields on the right; the automations preview and the actions in the
 * footer. `boardId` is the board the opener has showing (Queue passes the project's first board
 * by position, Board passes whatever is selected); `returnTo` says which route to land on
 * afterward, since the same dialog opens from both places. Rendered through a portal so it
 * always sits at the end of `document.body`, clear of the panel/sidebar stacking contexts it
 * might otherwise open inside.
 */
export function NewTicket({
  projectId,
  boardId,
  returnTo,
  onClose,
}: {
  projectId: string;
  boardId: string;
  returnTo: "queue" | "board";
  onClose: (created?: Ticket) => void;
}) {
  const navigate = useNavigate();
  const boardsQuery = useBoards(projectId);
  const lanesQuery = useLanes(projectId);
  const agents = (useAgents().data ?? []).filter((a) => a.status === "active");
  const evidenceTypes = useEvidenceTypes().data ?? [];
  const epicsQuery = useEpics(projectId);
  const tagsQuery = useTags(projectId);
  const fieldsQuery = useFields(projectId);
  const ticketsQuery = useTickets(projectId);
  const boards = [...(boardsQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const lanes = [...(lanesQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const epicOptions: PickerOption[] = (epicsQuery.data ?? []).filter((e) => !e.archived).map((e) => ({ id: e.id, label: e.name, family: e.family, color: e.color }));
  const tagOptions: PickerOption[] = (tagsQuery.data ?? []).filter((t) => !t.archived).map((t) => ({ id: t.id, label: t.name, family: t.family, color: t.color }));
  const activeFields = [...(fieldsQuery.data ?? [])].filter((f) => !f.archived).sort((a, b) => a.position - b.position);
  const dependencyOptions: PickerOption[] = (ticketsQuery.data ?? []).map((t) => ({ id: t.id, label: `${t.key} ${t.title}` }));

  const create = useCreateTicket();
  const update = useUpdateTicket();
  const setFlag = useSetFlag();
  const addComment = useAddComment();
  const addLink = useAddLink();
  const createEpic = useCreateEpic();
  const createTag = useCreateTag();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [selectedBoard, setSelectedBoard] = useState(boardId);
  const [laneId, setLaneId] = useState("");
  const [epicId, setEpicId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [blocksIds, setBlocksIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [needsHuman, setNeedsHuman] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>({});
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busyStep, setBusyStep] = useState("");
  const [error, setError] = useState("");
  // Set by a Ctrl+Enter that could not create; the note it shows tracks the fields still missing
  // and goes away on its own once they are filled in.
  const [showMissing, setShowMissing] = useState(false);
  // Once the ticket itself is created, remember it: a retry after a later step fails (an
  // upload, the description comment) must resume from there rather than creating a duplicate.
  const createdRef = useRef<Ticket | null>(null);
  // Files that have already uploaded successfully, across retries: each one is dropped from
  // `files` as soon as its upload resolves, so a retry after a mid-loop failure only re-uploads
  // what is actually still left, and the description comment can reference every id uploaded so
  // far, not just the ones from this particular attempt.
  const uploadedRef = useRef<UploadedAttachment[]>([]);
  // Dependency links already posted, as "from>to", so a retry after a later failure does not
  // post the same link twice (the server would refuse the duplicate and stall the retry).
  const linkedRef = useRef<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(() => cancel());

  // The focus trap lands on the first focusable control, which is now the header's close
  // button; the title is where typing should start, so it takes focus right after.
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const effectiveLane = laneId || lanes[0]?.id || "";
  const busy =
    create.isPending || update.isPending || setFlag.isPending || addComment.isPending || addLink.isPending || !!busyStep;

  const missingFields = activeFields.filter((f) => f.required && isFieldEmpty(f, fieldValues[f.key]));
  const missingNames = [...(title.trim() ? [] : ["Title"]), ...missingFields.map((f) => f.name)];
  const canCreate = missingNames.length === 0 && !busy;

  // A ticket that does not exist yet carries no evidence, so every requirement a lane has is
  // missing: those lanes are closed to it, and the Lane picker says so rather than letting the
  // server refuse the create with a 422.
  const missingFor = (l: Lane): GateMiss[] =>
    l.evidenceRequirements.map((r) => ({
      typeId: r.typeId,
      name: evidenceTypes.find((t) => t.id === r.typeId)?.name ?? r.typeId,
      need: r.count,
      have: 0,
    }));

  const ticketPath = (ticket: Ticket) => (returnTo === "board" ? `/board/t/${ticket.id}` : `/t/${ticket.id}`);

  /**
   * Dismissing the dialog. If the ticket itself was already created and only a later step failed,
   * it exists on the server and abandoning it here would leave it unfindable, so cancelling opens
   * it instead and the panel says what did not save.
   */
  function cancel() {
    const created = createdRef.current;
    if (!created) {
      onClose();
      return;
    }
    navigate(`${ticketPath(created)}?notice=partial`);
    onClose(created);
  }

  function addFiles(newFiles: File[]) {
    setFiles((fs) => [...fs, ...newFiles.map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file }))]);
  }

  function removeFile(id: string) {
    setFiles((fs) => fs.filter((f) => f.id !== id));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) addFiles(Array.from(dropped));
  }

  function setField(key: string, value: FieldValue) {
    setFieldValues((v) => ({ ...v, [key]: value }));
  }

  /** Everything the single POST carries; empty choices are left out rather than sent as blanks. */
  function createInput(trimmedTitle: string): CreateTicketInput {
    const input: CreateTicketInput = {
      projectId,
      boardId: selectedBoard || undefined,
      laneId: effectiveLane || undefined,
      title: trimmedTitle,
      metadata: {},
    };
    if (epicId) input.epicId = epicId;
    if (tagIds.length > 0) input.tagIds = tagIds;
    const criteria = successCriteria.trim();
    if (criteria) input.successCriteria = criteria;
    // `false` on a checkbox is a value and goes through; null and blank text are "not set". A
    // required checkbox the user never touched reads as unticked, so it goes through as false.
    const fields = Object.entries(fieldValues).filter(([, v]) => v !== null && v !== undefined && v !== "");
    for (const f of activeFields) {
      const untouched = fieldValues[f.key] === undefined || fieldValues[f.key] === null;
      if (f.kind === "checkbox" && f.required && untouched) fields.push([f.key, false]);
    }
    if (fields.length > 0) input.fields = Object.fromEntries(fields);
    return input;
  }

  async function submit() {
    if (busy) return;
    if (missingNames.length > 0) {
      setShowMissing(true);
      return;
    }
    setShowMissing(false);
    setError("");
    const trimmedTitle = title.trim();

    let ticket = createdRef.current;
    if (!ticket) {
      try {
        setBusyStep("Creating the ticket");
        ticket = await create.mutateAsync(createInput(trimmedTitle));
        createdRef.current = ticket;
      } catch (err) {
        setBusyStep("");
        setError(err instanceof Error ? err.message : "Could not create the ticket.");
        return;
      }
    }

    try {
      if (assigneeId || startDate || dueDate) {
        setBusyStep("Saving details");
        const patch: Record<string, unknown> = {};
        if (assigneeId) patch.assigneeId = assigneeId;
        if (startDate) patch.startDate = startDate;
        if (dueDate) patch.dueDate = dueDate;
        await update.mutateAsync({ id: ticket.id, patch });
      }
      if (needsHuman) {
        setBusyStep("Flagging for human");
        await setFlag.mutateAsync({ id: ticket.id, flag: "needs_human", on: true });
      }

      // A blocks link always POSTs from the blocking ticket's own endpoint (the server takes the
      // URL ticket as fromId), so "Blocked by" posts from the other ticket with this one as toId.
      const links = [
        ...blocksIds.map((other) => ({ from: ticket.id, to: other })),
        ...blockedByIds.map((other) => ({ from: other, to: ticket.id })),
      ];
      for (const link of links) {
        const key = `${link.from}>${link.to}`;
        if (linkedRef.current.has(key)) continue;
        setBusyStep("Linking dependencies");
        await addLink.mutateAsync({ ticketId: link.from, toId: link.to, kind: "blocks" });
        linkedRef.current.add(key);
      }

      for (const f of files) {
        setBusyStep(`Uploading ${f.file.name}`);
        const attachment = await uploadFile(ticket.id, f.file);
        uploadedRef.current.push({ id: attachment.id, filename: attachment.filename, isImage: attachment.mime.startsWith("image/") });
        // Drop it the moment its own upload succeeds, not after the whole loop: a later file's
        // failure then leaves only the files that never made it through in `files`, so retrying
        // re-uploads exactly those and none that already succeeded.
        setFiles((fs) => fs.filter((x) => x.id !== f.id));
      }

      const attachmentIds = uploadedRef.current.map((a) => a.id);
      const imageRefs = uploadedRef.current.filter((a) => a.isImage).map((a) => `![${a.filename}](attachment:${a.id})`);
      const body = [description.trim(), ...imageRefs].filter(Boolean).join("\n\n");
      if (body) {
        setBusyStep("Posting the description");
        await addComment.mutateAsync({ ticketId: ticket.id, body, attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined });
      }

      setBusyStep("");
      navigate(ticketPath(ticket));
      onClose(ticket);
    } catch (err) {
      setBusyStep("");
      setError(err instanceof Error ? err.message : "The ticket was created, but something after that failed. Try Create again.");
    }
  }

  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div
        className="modal card create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        ref={dialogRef}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            if (!isPickerOpen()) void submit();
          }
          // Dismissing an open Picker's popover must not also cancel the whole dialog underneath
          // it; useFocusTrap's own Escape handler runs after this one but only sees the Picker
          // already closed, so it has to be stopped here instead.
          if (e.key === "Escape" && isPickerOpen()) e.stopPropagation();
        }}
      >
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <header className="create-head">
            <h2 id="new-ticket-title">New ticket</h2>
            <button type="button" className="btn ghost create-close" onClick={cancel} aria-label="Close">
              <X size={16} weight="regular" aria-hidden="true" />
            </button>
          </header>

          <div className="create-body">
            <div className="create-main">
              <div className="field">
                <label htmlFor="nt-title">Title</label>
                <input
                  id="nt-title"
                  ref={titleRef}
                  className="input nt-title-input"
                  placeholder="What needs doing"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="field">
                {/* No htmlFor: the composer is a rich text editor carrying its own aria-label,
                    not a form control this label could be bound to. */}
                <label>Description</label>
                <div className="create-composer">
                  <Composer mode="draft" onChange={setDescription} onFilesAdded={addFiles} />
                </div>
              </div>
              <div className="field">
                <label>Success criteria</label>
                <p className="muted create-help">One line per criterion. Use task lists so they can be checked off.</p>
                <div className="create-composer">
                  <Composer mode="draft" label="Success criteria" placeholder="What done looks like" onChange={setSuccessCriteria} onFilesAdded={addFiles} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="nt-file-input">Attachments</label>
                <div
                  className={dragOver ? "dropzone over" : "dropzone"}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  <p style={{ margin: 0 }}>Drop files here or choose files</p>
                  <button type="button" className="btn ghost" onClick={() => fileInputRef.current?.click()}>Choose files</button>
                  <input
                    id="nt-file-input"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files) addFiles(Array.from(e.target.files)); e.target.value = ""; }}
                  />
                  {files.map((f) => (
                    <div key={f.id} className="file-row">
                      <span className="fname">{f.file.name}</span>
                      <span className="fsize mono">{formatSize(f.file.size)}</span>
                      <button type="button" className="btn ghost" onClick={() => removeFile(f.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="create-side">
              <div className="props">
                {boards.length > 1 && (
                  <>
                    <span className="props-label">Board</span>
                    <div className="props-control">
                      <Picker
                        id="nt-board"
                        label="Board"
                        hideLabel
                        swatch
                        options={boards.map((b) => ({ id: b.id, label: b.name, family: b.family }))}
                        value={selectedBoard}
                        onChange={(id) => id && setSelectedBoard(id)}
                      />
                    </div>
                  </>
                )}
                <span className="props-label">Lane</span>
                <div className="props-control">
                  <Picker
                    id="nt-lane"
                    label="Lane"
                    hideLabel
                    swatch
                    options={lanes.map((l) => {
                      const missing = missingFor(l);
                      const disabled = missing.length > 0;
                      return { id: l.id, label: l.name, family: l.family, disabled, disabledReason: disabled ? laneOptionLabel(l, missing) : undefined };
                    })}
                    value={effectiveLane}
                    onChange={(id) => id && setLaneId(id)}
                  />
                </div>
                <span className="props-label">Arc</span>
                <div className="props-control">
                  <Picker
                    id="nt-epic"
                    label="Arc"
                    hideLabel
                    swatch
                    clearable
                    searchable
                    placeholder="No arc"
                    busy={epicsQuery.isPending}
                    options={epicOptions}
                    value={epicId}
                    onChange={setEpicId}
                    onCreate={async (text) => {
                      const epic = await createEpic.mutateAsync({ projectId, name: text });
                      return { id: epic.id, label: epic.name, family: epic.family, color: epic.color };
                    }}
                  />
                </div>
                <span className="props-label">Tags</span>
                <div className="props-control">
                  <Picker
                    id="nt-tags"
                    label="Tags"
                    hideLabel
                    multi
                    swatch
                    searchable
                    placeholder="No tags"
                    busy={tagsQuery.isPending}
                    options={tagOptions}
                    values={tagIds}
                    onChange={setTagIds}
                    onCreate={async (text) => {
                      const tag = await createTag.mutateAsync({ projectId, name: text });
                      return { id: tag.id, label: tag.name, family: tag.family, color: tag.color };
                    }}
                  />
                </div>
                <span className="props-label">Assignee</span>
                <div className="props-control">
                  <Picker
                    id="nt-assignee"
                    label="Assignee"
                    hideLabel
                    clearable
                    placeholder="Unassigned"
                    options={agents.map((a) => ({ id: a.id, label: a.name }))}
                    value={assigneeId}
                    onChange={setAssigneeId}
                  />
                </div>
                <label className="props-label" htmlFor="nt-start">Start date</label>
                <div className="props-control">
                  <input id="nt-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <label className="props-label" htmlFor="nt-due">Due date</label>
                <div className="props-control">
                  <input id="nt-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
                <span className="props-label">Blocks</span>
                <div className="props-control">
                  <Picker
                    id="nt-blocks"
                    label="Blocks"
                    hideLabel
                    multi
                    searchable
                    placeholder="None"
                    busy={ticketsQuery.isPending}
                    options={dependencyOptions}
                    values={blocksIds}
                    onChange={setBlocksIds}
                  />
                </div>
                <span className="props-label">Blocked by</span>
                <div className="props-control">
                  <Picker
                    id="nt-blocked-by"
                    label="Blocked by"
                    hideLabel
                    multi
                    searchable
                    placeholder="None"
                    busy={ticketsQuery.isPending}
                    options={dependencyOptions}
                    values={blockedByIds}
                    onChange={setBlockedByIds}
                  />
                </div>
                <label className="nt-check props-span" htmlFor="nt-needs-human">
                  <input id="nt-needs-human" type="checkbox" checked={needsHuman} onChange={(e) => setNeedsHuman(e.target.checked)} />
                  Needs human
                </label>
                {activeFields.map((f) => (
                  <FieldRow key={f.id} name={f.name} required={f.required}>
                    <FieldControl id={`nt-field-${f.id}`} def={f} value={fieldValues[f.key] ?? null} onChange={(v) => setField(f.key, v)} />
                  </FieldRow>
                ))}
              </div>
            </div>
          </div>

          <footer className="create-foot">
            <div className="create-foot-row">
              {/* The lane the ticket starts in is not a gate it has to pass, so it is left out. */}
              <p className="muted create-preview">{gatePreview(lanes.filter((l) => l.id !== effectiveLane), evidenceTypes)}</p>
              <div className="create-actions">
                {busyStep && <span className="mono muted">{busyStep}</span>}
                <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>
                <button type="submit" className="btn" disabled={!canCreate} title="Ctrl or Cmd plus Enter">{busy ? "Creating" : "Create"}</button>
              </div>
            </div>
            {showMissing && missingNames.length > 0 && (
              <p className="muted create-note">Missing required fields: {missingNames.join(", ")}</p>
            )}
            {error && <p className="error create-note" role="alert">{error}</p>}
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** One labelled row of the right column, with the trailing required mark the ticket panel also uses. */
function FieldRow({ name, required, children }: { name: string; required: boolean; children: React.ReactNode }) {
  return (
    <>
      <span className="props-label">
        {name}
        {required && " *"}
      </span>
      <div className="props-control">{children}</div>
    </>
  );
}
