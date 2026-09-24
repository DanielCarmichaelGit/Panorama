import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { useAddComment } from "../lib/hooks";
import { uploadFile } from "../lib/attachments";

// tiptap-markdown adds `editor.storage.markdown` at runtime but ships no ambient declaration
// merge for it; without this, TypeScript only knows `editor.storage` as the empty base type.
declare module "@tiptap/core" {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

/** The editor's current document, serialised back to the markdown it is stored and posted as. */
export function composerMarkdown(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}

interface UploadItem { id: string; name: string; progress: number }

function extensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // The server hands back attachment:ID references (Task 4/6); the Link mark's default
      // protocol allowlist (http, https, mailto, ...) would otherwise reject that scheme and
      // fall back to inserting the raw, unparsed source string as literal text (a tiptap-core
      // quirk when a parsed HTML string reduces to plain, unmarked text).
      link: { isAllowedUri: (url: string, ctx: { defaultValidate: (u: string) => boolean }) => ctx.defaultValidate(url) || /^attachment:/.test(url) },
    }),
    // Inline, not a block: a dropped screenshot sits in the paragraph flow like the rest of the
    // comment's markdown, matching how <Markdown> renders `![name](attachment:id)` elsewhere.
    Image.configure({ inline: true, allowBase64: false }),
    Placeholder.configure({ placeholder: "Write a comment" }),
    Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
  ];
}

/**
 * The comment composer: a toolbar-less TipTap editor with markdown input rules (StarterKit's
 * defaults cover `#`/`##`, `-`, `1.`, `>`, `---`, backticks and `**`), plus drag/drop/paste file
 * upload. Uploaded files become an `attachment:id` reference inserted at the cursor and are
 * remembered in `attachmentIds` for the post; the comment body itself is always
 * `composerMarkdown(editor)`, i.e. the editor's live document serialised to markdown.
 */
export function Composer({ ticketId, onPosted }: { ticketId: string; onPosted: () => void }) {
  const addComment = useAddComment();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  // File uploads outlive the component when a ticket switch (or panel close) unmounts the
  // composer mid-upload: uploadFile's XHR keeps running, and its onProgress/then/catch callbacks
  // would otherwise call setState on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  function uploadOne(file: File, ed: Editor) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
    uploadFile(ticketId, file, (fraction) => {
      if (!mountedRef.current) return;
      setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: Math.round(fraction * 100) } : x)));
    })
      .then((attachment) => {
        if (!mountedRef.current) return;
        setAttachmentIds((ids) => [...ids, attachment.id]);
        const isImage = attachment.mime.startsWith("image/");
        const token = isImage
          ? `![${attachment.filename}](attachment:${attachment.id}) `
          : `[${attachment.filename}](attachment:${attachment.id}) `;
        const { from, to } = ed.state.selection;
        ed.chain().focus().insertContentAt({ from, to }, token).run();
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : `Could not upload ${file.name}.`);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setUploads((u) => u.filter((x) => x.id !== id));
      });
  }

  const editor = useEditor({
    extensions: extensions(),
    content: "",
    editorProps: {
      attributes: { role: "textbox", "aria-multiline": "true", "aria-label": "Comment" },
      handleDrop(_view, event) {
        const files = event.dataTransfer?.files;
        if (!editor || !files || files.length === 0) return false;
        event.preventDefault();
        Array.from(files).forEach((f) => uploadOne(f, editor));
        return true;
      },
      handlePaste(_view, event) {
        const files = event.clipboardData?.files;
        if (!editor || !files || files.length === 0) return false;
        event.preventDefault();
        Array.from(files).forEach((f) => uploadOne(f, editor));
        return true;
      },
    },
  });

  useEffect(() => {
    if (import.meta.env.MODE === "test") (window as any).__panEditor = editor;
  }, [editor]);

  async function submit() {
    if (!editor || editor.isEmpty || addComment.isPending) return;
    const body = composerMarkdown(editor).trim();
    if (!body) return;
    try {
      setError("");
      await addComment.mutateAsync({ ticketId, body, attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined });
      editor.commands.clearContent();
      setAttachmentIds([]);
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post the comment.");
    }
  }

  const isEmpty = !editor || editor.isEmpty;

  return (
    <div
      className="composer card"
      data-testid="composer"
      onKeyDown={(e) => {
        // An IME still composing (e.g. picking a candidate for CJK input) can report `key ===
        // "Enter"` for the keystroke that confirms the candidate; that keystroke must reach the
        // IME, not submit the comment. `keyCode === 229` is the same check for browsers that
        // don't set `isComposing` on this event.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <EditorContent editor={editor} />
      {uploads.map((u) => (
        <p key={u.id} className="upload-row mono muted">Uploading {u.name} {u.progress}%</p>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="composer-actions">
        <button type="button" className="btn" disabled={isEmpty || addComment.isPending} onClick={submit}>
          {addComment.isPending ? "Posting" : "Comment"}
        </button>
      </div>
    </div>
  );
}
