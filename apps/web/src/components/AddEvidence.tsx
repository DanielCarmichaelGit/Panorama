import { useEffect, useState } from "react";
import type { EvidenceType, EvidenceResult } from "@panorama/core";
import { ApiError } from "../lib/api";
import { uploadFile } from "../lib/attachments";
import { useAddEvidence } from "../lib/hooks";
import { useFocusTrap } from "../lib/useFocusTrap";

/** A zod issue from a 400 response, as the server's error handler reports it (`err.issues`). */
interface ZodIssue {
  path: (string | number)[];
  message: string;
}

function issueLines(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return null;
  return (error.details as ZodIssue[]).map((i) => `${i.path.length ? i.path.join(".") : "value"}: ${i.message}`);
}

/**
 * Dialog to attach one piece of evidence to a ticket. The type select drives which fields show,
 * matching the payload each kind's zod schema accepts server-side (`EvidencePayload` in
 * `@panorama/core`). Screenshot and file types upload through `uploadFile` first and attach the
 * resulting attachment id; every other kind posts payload fields only.
 */
export function AddEvidence({ ticketId, types, onClose }: { ticketId: string; types: EvidenceType[]; onClose: () => void }) {
  const add = useAddEvidence();
  const dialogRef = useFocusTrap<HTMLDivElement>(onClose);

  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId) ?? null;

  const [passed, setPassed] = useState("0");
  const [failed, setFailed] = useState("0");
  const [output, setOutput] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [score, setScore] = useState("1");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<EvidenceResult>("pass");

  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Switching evidence type starts the form over: the fields shown, and what counts as valid,
  // change with the kind.
  useEffect(() => {
    setPassed("0");
    setFailed("0");
    setOutput("");
    setUrl("");
    setTitle("");
    setScore("1");
    setNote("");
    setResult("pass");
    setAttachmentId(null);
    setFilename("");
    setUploadError("");
  }, [typeId]);

  async function pickFile(file: File) {
    setUploading(true);
    setUploadError("");
    try {
      const attachment = await uploadFile(ticketId, file);
      setAttachmentId(attachment.id);
      setFilename(attachment.filename);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Could not upload the file.");
    } finally {
      setUploading(false);
    }
  }

  /** The payload for the current kind, or null while the fields don't yet make a valid one. */
  function payload(): Record<string, unknown> | null {
    if (!type) return null;
    switch (type.kind) {
      case "test_run": {
        const p = Number(passed), f = Number(failed);
        if (!Number.isInteger(p) || p < 0 || !Number.isInteger(f) || f < 0) return null;
        return { passed: p, failed: f, output: output.trim() || undefined };
      }
      case "pr_link":
        return url.trim() ? { url: url.trim(), title: title.trim() || undefined } : null;
      case "eval_score": {
        const s = Number(score);
        if (Number.isNaN(s) || s < 0 || s > 1) return null;
        return { score: s, note: note.trim() || undefined };
      }
      case "screenshot":
      case "file":
        return attachmentId ? { note: note.trim() || undefined } : null;
      case "human_signoff":
        return { note: note.trim() || undefined };
      case "custom":
        return { result, note: note.trim() || undefined };
      default:
        return null;
    }
  }

  const body = payload();
  const valid = !!type && body !== null && !uploading && !add.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !type || body === null) return;
    try {
      await add.mutateAsync({
        ticketId,
        typeId: type.id,
        payload: body,
        attachmentId: type.needsAttachment && attachmentId ? attachmentId : undefined,
      });
      onClose();
    } catch {
      // add.error renders below
    }
  }

  const lines = issueLines(add.error);

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="add-evidence-title" ref={dialogRef}>
        <form onSubmit={submit}>
          <h2 id="add-evidence-title">Add evidence</h2>
          <div className="field">
            <label htmlFor="ae-type">Type</label>
            <select id="ae-type" className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {type?.kind === "test_run" && (
            <>
              <div className="field">
                <label htmlFor="ae-passed">Passed</label>
                <input id="ae-passed" className="input" type="number" inputMode="numeric" min={0} value={passed} onChange={(e) => setPassed(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ae-failed">Failed</label>
                <input id="ae-failed" className="input" type="number" inputMode="numeric" min={0} value={failed} onChange={(e) => setFailed(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ae-output">Output</label>
                <textarea id="ae-output" className="input" value={output} onChange={(e) => setOutput(e.target.value)} />
              </div>
            </>
          )}

          {type?.kind === "pr_link" && (
            <>
              <div className="field">
                <label htmlFor="ae-url">Pull request URL</label>
                <input id="ae-url" className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ae-title">Title</label>
                <input id="ae-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </>
          )}

          {type?.kind === "eval_score" && (
            <>
              <div className="field">
                <label htmlFor="ae-score">Score, 0 to 1</label>
                <input id="ae-score" className="input" type="number" inputMode="numeric" min={0} max={1} step={0.01} value={score} onChange={(e) => setScore(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ae-note">Note</label>
                <textarea id="ae-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}

          {(type?.kind === "screenshot" || type?.kind === "file") && (
            <>
              <div className="field">
                <label htmlFor="ae-file">File</label>
                <input
                  id="ae-file"
                  className="input"
                  type="file"
                  accept={type.kind === "screenshot" ? "image/*" : undefined}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); }}
                />
                {uploading && <p className="mono muted">Uploading</p>}
                {filename && !uploading && <p className="muted">{filename}</p>}
                {uploadError && <p className="error" role="alert">{uploadError}</p>}
              </div>
              <div className="field">
                <label htmlFor="ae-note">Note</label>
                <textarea id="ae-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}

          {type?.kind === "human_signoff" && (
            <div className="field">
              <label htmlFor="ae-note">Note</label>
              <textarea id="ae-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}

          {type?.kind === "custom" && (
            <>
              <div className="field">
                <label htmlFor="ae-result">Result</label>
                <select id="ae-result" className="input" value={result} onChange={(e) => setResult(e.target.value as EvidenceResult)}>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="info">Info</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="ae-note">Note</label>
                <textarea id="ae-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </>
          )}

          {add.isError && (
            <div role="alert" className="error">
              {lines
                ? lines.map((l) => <p key={l} style={{ margin: 0 }}>{l}</p>)
                : <p style={{ margin: 0 }}>{add.error instanceof Error ? add.error.message : "Could not attach evidence."}</p>}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={!valid}>{add.isPending ? "Attaching" : "Attach"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
