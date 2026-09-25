import { useRef, useState } from "react";
import { File as FileIcon, X } from "@phosphor-icons/react";
import { isFileValue, type FieldDefinition, type FieldValue } from "@boomerang/core";
import { uploadFile, useAttachmentMeta } from "../lib/attachments";
import { errorMessage } from "../lib/errors";
import { AttachmentImage, AttachmentLink } from "../lib/markdown";
import { Picker } from "./Picker";

/**
 * A required field with nothing in it: blank text counts as empty, and a checkbox never does.
 * An unticked box looks like `false`, and `false` is a value, so an untouched required checkbox
 * reads as `false` rather than as missing (the create dialog sends it that way; the panel's
 * "Needs fields" chip does not count it). A file field is empty until it holds an attachment.
 */
export function isFieldEmpty(def: FieldDefinition, value: FieldValue | undefined): boolean {
  if (def.kind === "checkbox") return false;
  if (value === undefined || value === null) return true;
  return def.kind === "text" && value === "";
}

/**
 * A file field: one of the ticket's attachments. Empty, it offers a Choose file button (and takes
 * a drop) and either uploads straight to `ticketId` and commits `{attachmentId}`, or, with no
 * ticket yet (the New ticket dialog), hands the File to `onPickFile` to upload after create. Set,
 * it shows a 64px thumbnail for an image or a file icon, the filename as a download link, and
 * Remove, which commits null.
 */
function FileField({
  id,
  def,
  value,
  ticketId,
  pendingFile,
  onPickFile,
  settle,
}: {
  id: string;
  def: FieldDefinition;
  value: FieldValue;
  ticketId?: string;
  pendingFile?: File | null;
  onPickFile?: (file: File | null) => void;
  settle: (next: FieldValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const attachmentId = isFileValue(value) ? value.attachmentId : null;
  const meta = useAttachmentMeta(attachmentId);

  async function take(file: File | undefined) {
    if (!file || busy) return;
    setError("");
    if (!ticketId) {
      onPickFile?.(file);
      return;
    }
    setBusy(true);
    try {
      const attachment = await uploadFile(ticketId, file);
      settle({ attachmentId: attachment.id });
    } catch (e) {
      setError(errorMessage(e, "Could not upload the file."));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer?.files?.[0]);
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop,
  };

  if (attachmentId) {
    const filename = meta.data?.filename ?? "Attachment";
    return (
      <div className="file-field">
        {meta.data?.isImage ? (
          <span className="file-thumb"><AttachmentImage id={attachmentId} alt={filename} /></span>
        ) : (
          <FileIcon size={16} weight="regular" className="muted" aria-hidden="true" />
        )}
        <span className="file-name"><AttachmentLink id={attachmentId} filename={filename}>{filename}</AttachmentLink></span>
        <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => settle(null)}>
          <X size={14} weight="regular" aria-hidden="true" />
        </button>
        {meta.isError && <p className="error file-error" role="alert">Could not load the attachment.</p>}
      </div>
    );
  }

  if (pendingFile) {
    return (
      <div className="file-field">
        <FileIcon size={16} weight="regular" className="muted" aria-hidden="true" />
        <span className="file-name" title="Uploads when the ticket is created">{pendingFile.name}</span>
        <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => onPickFile?.(null)}>
          <X size={14} weight="regular" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className={over ? "file-field over" : "file-field"} {...dropProps}>
      <button type="button" className="btn ghost small" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? "Uploading" : "Choose file"}
      </button>
      <span className="muted">or drop one here</span>
      <input
        id={id}
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label={def.name}
        disabled={busy}
        onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }}
      />
      {error && <p className="error file-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The input for one custom field, chosen by the definition's kind: a text, number, or date
 * input, a Picker for a select, a checkbox row for a checkbox, a file control for a file. Shared
 * by the ticket panel (which saves on commit) and the New ticket dialog (which only collects a
 * draft), so both surfaces render a field the same way. `onChange` fires on every edit with the
 * field's typed value; `onCommit` fires when the value is settled: on blur for text and number
 * (where typing is still in progress until then), immediately for date, select, checkbox, and
 * file. Blank text commits as `null`, matching the server's "null clears a field" rule. A file
 * field uploads to `ticketId` when given; without one it keeps the File through `onPickFile`
 * and shows `pendingFile` until the caller uploads it.
 */
export function FieldControl({
  id,
  def,
  value,
  onChange,
  onCommit,
  ticketId,
  pendingFile,
  onPickFile,
}: {
  id: string;
  def: FieldDefinition;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  onCommit?: (value: FieldValue) => void;
  ticketId?: string;
  pendingFile?: File | null;
  onPickFile?: (file: File | null) => void;
}) {
  function settle(next: FieldValue) {
    onChange(next);
    onCommit?.(next);
  }

  if (def.kind === "text") {
    return (
      <input
        id={id}
        className="input"
        aria-label={def.name}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.(value === "" ? null : value)}
      />
    );
  }
  if (def.kind === "number") {
    return (
      <input
        id={id}
        className="input"
        type="number"
        inputMode="numeric"
        aria-label={def.name}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        onBlur={() => onCommit?.(value)}
      />
    );
  }
  if (def.kind === "date") {
    return (
      <input
        id={id}
        className="input"
        type="date"
        aria-label={def.name}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => settle(e.target.value || null)}
      />
    );
  }
  if (def.kind === "select") {
    return (
      <Picker
        id={id}
        label={def.name}
        hideLabel
        clearable
        value={typeof value === "string" ? value : null}
        onChange={(next) => settle(next)}
        options={def.options.map((o) => ({ id: o.value, label: o.label }))}
      />
    );
  }
  if (def.kind === "file") {
    return <FileField id={id} def={def} value={value} ticketId={ticketId} pendingFile={pendingFile} onPickFile={onPickFile} settle={settle} />;
  }
  return (
    <label className="checkbox-row">
      <input type="checkbox" checked={value === true} onChange={(e) => settle(e.target.checked)} />
      {def.name}
    </label>
  );
}
