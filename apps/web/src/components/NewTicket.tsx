import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { Lane, Ticket } from "@panorama/core";
import { uploadFile } from "../lib/attachments";
import type { GateMiss } from "../lib/hooks";
import { useAgents, useAddComment, useBoards, useCreateTicket, useEvidenceTypes, useLanes, useSetFlag, useUpdateTicket } from "../lib/hooks";
import { useFocusTrap } from "../lib/useFocusTrap";
import { Composer } from "./Composer";
import { laneOptionLabel } from "./GateList";

interface PendingFile { id: string; file: File }
interface UploadedAttachment { id: string; filename: string; isImage: boolean }

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Full-detail dialog to create a ticket: title, description, attachments, board, lane,
 * assignee, dates, and needs-human, all in one place rather than a title box. `boardId` is the
 * board the opener has showing (Queue passes the project's first board by position, Board passes
 * whatever is selected); `returnTo` says which route to land on afterward, since the same dialog
 * opens from both places. Rendered through a portal so it always sits at the end of `document.body`,
 * clear of the panel/sidebar stacking contexts it might otherwise open inside.
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
  const boards = [...(boardsQuery.data ?? [])].sort((a, b) => a.position - b.position);
  const lanes = [...(lanesQuery.data ?? [])].sort((a, b) => a.position - b.position);

  const create = useCreateTicket();
  const update = useUpdateTicket();
  const setFlag = useSetFlag();
  const addComment = useAddComment();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedBoard, setSelectedBoard] = useState(boardId);
  const [laneId, setLaneId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [needsHuman, setNeedsHuman] = useState(false);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busyStep, setBusyStep] = useState("");
  const [error, setError] = useState("");
  // Once the ticket itself is created, remember it: a retry after a later step fails (an
  // upload, the description comment) must resume from there rather than creating a duplicate.
  const createdRef = useRef<Ticket | null>(null);
  // Files that have already uploaded successfully, across retries: each one is dropped from
  // `files` as soon as its upload resolves, so a retry after a mid-loop failure only re-uploads
  // what is actually still left, and the description comment can reference every id uploaded so
  // far, not just the ones from this particular attempt.
  const uploadedRef = useRef<UploadedAttachment[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(() => cancel());

  const effectiveLane = laneId || lanes[0]?.id || "";

  // A ticket that does not exist yet carries no evidence, so every requirement a lane has is
  // missing: those lanes are closed to it, and the select says so rather than letting the
  // server refuse the create with a 422.
  const missingFor = (l: Lane): GateMiss[] =>
    l.evidenceRequirements.map((r) => ({
      typeId: r.typeId,
      name: evidenceTypes.find((t) => t.id === r.typeId)?.name ?? r.typeId,
      need: r.count,
      have: 0,
    }));
  const busy = create.isPending || update.isPending || setFlag.isPending || addComment.isPending || !!busyStep;

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

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || busy) return;
    setError("");

    let ticket = createdRef.current;
    if (!ticket) {
      try {
        setBusyStep("Creating the ticket");
        ticket = await create.mutateAsync({ projectId, boardId: selectedBoard || undefined, laneId: effectiveLane || undefined, title: trimmedTitle, metadata: {} });
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
        className="modal card new-ticket-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-ticket-title"
        ref={dialogRef}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <h2 id="new-ticket-title">New ticket</h2>
          <div className="nt-grid">
            <div className="nt-left">
              <div className="field">
                <label htmlFor="nt-title">Title</label>
                <input
                  id="nt-title"
                  className="input nt-title-input"
                  placeholder="What needs doing"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="field">
                {/* No htmlFor: the composer is a rich text editor carrying its own aria-label,
                    not a form control this label could be bound to. */}
                <label>Description</label>
                <div style={{ minHeight: "10rem" }}>
                  <Composer mode="draft" onChange={setDescription} onFilesAdded={addFiles} />
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
            <div className="nt-right">
              {boards.length > 1 && (
                <div className="field">
                  <label htmlFor="nt-board">Board</label>
                  <select id="nt-board" className="input" value={selectedBoard} onChange={(e) => setSelectedBoard(e.target.value)}>
                    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="nt-lane">Lane</label>
                <select id="nt-lane" className="input" value={effectiveLane} onChange={(e) => setLaneId(e.target.value)}>
                  {lanes.map((l) => {
                    const missing = missingFor(l);
                    return (
                      <option key={l.id} value={l.id} disabled={missing.length > 0}>
                        {laneOptionLabel(l, missing)}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <label htmlFor="nt-assignee">Assignee</label>
                <select id="nt-assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="nt-start">Start date</label>
                <input id="nt-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="nt-due">Due date</label>
                <input id="nt-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <label className="nt-check" htmlFor="nt-needs-human">
                <input id="nt-needs-human" type="checkbox" checked={needsHuman} onChange={(e) => setNeedsHuman(e.target.checked)} />
                Needs human
              </label>
            </div>
          </div>
          {busyStep && <p className="muted mono">{busyStep}</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="nt-footer">
            <button type="button" className="btn ghost" onClick={cancel}>Cancel</button>
            <button type="submit" className="btn" disabled={!title.trim() || busy}>{busy ? "Creating" : "Create"}</button>
            <span className="mono muted nt-hint">Ctrl or Cmd plus Enter to create</span>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
