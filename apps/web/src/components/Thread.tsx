import type { Actor, Comment, Evidence } from "@panorama/core";
import { useEvidenceTypes, useThread } from "../lib/hooks";
import { AttachmentLink, Markdown } from "../lib/markdown";
import { EvidenceChip } from "./EvidenceChip";

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function authorName(actorId: string, actors: Pick<Actor, "id" | "name" | "kind">[]): string {
  const actor = actors.find((a) => a.id === actorId);
  if (!actor) return "Unknown";
  return actor.kind === "human" ? "You" : actor.name;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

type Entry = { key: string; at: string } & ({ kind: "comment"; comment: Comment } | { kind: "evidence"; evidence: Evidence });

function timeline(comments: Comment[], evidence: Evidence[]): Entry[] {
  const entries: Entry[] = [
    ...comments.map((c): Entry => ({ key: `c-${c.id}`, kind: "comment", comment: c, at: c.createdAt })),
    ...evidence.filter((e) => !e.commentId).map((e): Entry => ({ key: `e-${e.id}`, kind: "evidence", evidence: e, at: e.createdAt })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

export function Thread({ ticketId }: { ticketId: string }) {
  const thread = useThread(ticketId);
  const evidenceTypes = useEvidenceTypes();

  if (thread.isPending) {
    return (
      <div className="thread">
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  if (thread.isError || !thread.data) {
    return (
      <div className="thread">
        <p className="error" role="alert">Could not load the thread.</p>
        <button type="button" className="btn ghost" onClick={() => thread.refetch()}>Try again</button>
      </div>
    );
  }

  const { comments, attachments, evidence, actors } = thread.data;
  const typesById = new Map((evidenceTypes.data ?? []).map((t) => [t.id, t]));
  const attachmentsById = new Map(attachments.map((a) => [a.id, a]));
  const entries = timeline(comments, evidence);

  // Wrapped like every other state the thread can be in, so the panel keeps one layout.
  if (entries.length === 0) return <div className="thread"><p className="muted">No comments yet.</p></div>;

  return (
    <div className="thread">
      {entries.map((entry) => {
        if (entry.kind === "evidence") {
          const type = typesById.get(entry.evidence.typeId);
          return (
            <div key={entry.key} className="comment card">
              <p className="who">{authorName(entry.evidence.actorId, actors)} attached evidence</p>
              {type && (
                <div className="chips">
                  <EvidenceChip evidence={entry.evidence} type={type} />
                </div>
              )}
            </div>
          );
        }

        const comment = entry.comment;
        const commentAttachments = comment.attachmentIds.map((id) => attachmentsById.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
        const commentEvidence = evidence.filter((e) => e.commentId === comment.id);

        return (
          <div key={entry.key} className="comment card">
            <p className="who">
              <strong>{authorName(comment.actorId, actors)}</strong> <span className="mono muted">{when(comment.createdAt)}</span>{" "}
              <span className="mono muted">signed</span>
            </p>
            <Markdown body={comment.body} attachments={attachments} />
            {commentAttachments.length > 0 && (
              <div className="attachments">
                {commentAttachments.map((a) => (
                  <p key={a.id} className="attachment-row mono muted">
                    <AttachmentLink id={a.id} filename={a.filename}>{a.filename}</AttachmentLink> {fileSize(a.size)}
                  </p>
                ))}
              </div>
            )}
            {commentEvidence.length > 0 && (
              <div className="chips">
                {commentEvidence.map((e) => {
                  const type = typesById.get(e.typeId);
                  return type ? <EvidenceChip key={e.id} evidence={e} type={type} /> : null;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
