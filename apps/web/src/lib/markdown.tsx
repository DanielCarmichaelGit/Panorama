import { useMemo, useState } from "react";
import createDOMPurify from "dompurify";
import { marked, type Token, type Tokens } from "marked";
import type { Attachment } from "@panorama/core";
import { fetchBlob, useAttachmentUrl } from "./attachments";

export type Block = { kind: "rich"; html: string } | { kind: "html"; html: string };

// DOMPurify needs a `window` to bind to. Constructing the instance lazily (on first use,
// rather than at module load) means this module works under jsdom in tests the same way it
// works in the browser, without caring which one provides `window` first.
let purifier: ReturnType<typeof createDOMPurify> | null = null;
function purify(): ReturnType<typeof createDOMPurify> {
  if (!purifier) purifier = createDOMPurify(window);
  return purifier;
}

// Restricts sanitised URLs (href/src) to https:, mailto: and our own attachment: pseudo-scheme,
// plus relative/unqualified URLs. Modelled on DOMPurify's own default ALLOWED_URI_REGEXP, just
// with the scheme list narrowed: this is what keeps javascript: and data: links out.
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|attachment):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

/**
 * Sanitises a rendered "rich" markdown block (headings, paragraphs, lists, inline html, etc).
 * Comment bodies are stored verbatim on the server (no server-side sanitisation), so this is
 * the only sanitiser standing between a comment and the DOM: styles, iframes and script-bearing
 * tags are stripped outright, inline style attributes are dropped, and only a safe set of URL
 * schemes survive on links and images.
 */
function sanitizeRich(html: string): string {
  return purify().sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input", "script"],
    FORBID_ATTR: ["style"],
    ALLOWED_URI_REGEXP,
  });
}

/**
 * Sanitises a raw html block (a standalone html token, or a fenced ```html block) before it is
 * handed to <HtmlFrame>. Only <script> is explicitly forbidden here: the surrounding sandboxed
 * iframe (no allow-same-origin, no allow-scripts) is the primary defence for everything else an
 * author might put in one of these blocks, but scripts are stripped up front regardless. Event
 * handler attributes (onerror, onclick, ...) are removed by DOMPurify's default attribute
 * allowlist, which never includes them.
 */
function sanitizeHtmlBlock(html: string): string {
  return purify().sanitize(html, { FORBID_TAGS: ["script"] });
}

function isHtmlToken(t: Token): boolean {
  return t.type === "html" || (t.type === "code" && (t as Tokens.Code).lang === "html");
}

function rawHtmlOf(t: Token): string {
  return t.type === "html" ? (t as Tokens.HTML).text : (t as Tokens.Code).text;
}

/**
 * Lexes markdown into blocks, grouping consecutive non-html tokens into "rich" blocks (rendered
 * with marked.parser, then sanitised) and pulling each raw html token or ```html fence out as
 * its own "html" block (sanitised separately, and rendered in a sandboxed iframe rather than
 * inline). Grouping, instead of rendering every token as its own block, keeps things like a
 * paragraph followed by a list together as one rendered unit, matching how marked.parser expects
 * to render a run of block tokens.
 */
export function renderBlocks(md: string): Block[] {
  const tokensList = marked.lexer(md, { gfm: true });
  const blocks: Block[] = [];
  let group: Token[] = [];

  const flushGroup = () => {
    if (group.length === 0) return;
    // marked.parser looks at `tokens.links` (reference-style link definitions) alongside the
    // token array itself, so it must be carried onto each sliced-out group.
    (group as Tokens.Generic[] & { links?: typeof tokensList.links }).links = tokensList.links;
    const html = marked.parser(group as Tokens.Generic[], { gfm: true });
    blocks.push({ kind: "rich", html: sanitizeRich(html) });
    group = [];
  };

  for (const token of tokensList) {
    if (isHtmlToken(token)) {
      flushGroup();
      blocks.push({ kind: "html", html: sanitizeHtmlBlock(rawHtmlOf(token)) });
    } else {
      group.push(token);
    }
  }
  flushGroup();

  return blocks;
}

// The one dangerouslySetInnerHTML in the app: `html` here has always already been through
// sanitizeRich or sanitizeHtmlBlock above before it reaches this component.
function RawHtml({ html, as: As = "div" }: { html: string; as?: "div" | "span" }) {
  return <As dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The document a raw/fenced html block is rendered into. It gets its own minimal CSP (no
 * scripts, no external loads besides data/blob images) on top of the sandboxed iframe. The one
 * hex colour below (#1B2230, matching --text) is deliberate: tokens.css cannot reach inside this
 * srcdoc document (sandbox="" makes it a separate, same-origin-less document), so there is no
 * token to inherit and a literal value is the only way to give it a sane default text colour.
 */
function htmlDocument(html: string): string {
  return (
    "<!doctype html><meta charset=\"utf-8\">" +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'\">" +
    "<style>body{margin:0;font:14px/1.5 system-ui;color:#1B2230}</style>" +
    html
  );
}

/**
 * Renders a sanitised raw-html block inside a sandboxed, srcdoc iframe. `sandbox=""` grants no
 * permissions at all (no scripts, no same-origin, no forms, no popups), so the document is
 * opaque to the parent page and can never resize itself to fit its content. It gets a fixed
 * height instead, with a manual vertical resize handle for anything taller.
 */
export function HtmlFrame({ html }: { html: string }) {
  return (
    <iframe
      sandbox=""
      referrerPolicy="no-referrer"
      title="Rendered HTML"
      className="htmlframe"
      srcDoc={htmlDocument(html)}
    />
  );
}

/** Skeleton box, then the loaded image once useAttachmentUrl resolves its object URL. */
export function AttachmentImage({ id, alt }: { id: string; alt: string }) {
  const url = useAttachmentUrl(id);
  if (!url) return <span className="att-img" role="img" aria-label={alt || "Loading image"} />;
  return <img src={url} alt={alt} />;
}

/** Downloads the attachment through fetchBlob on click and saves it via a temporary object URL. */
export function AttachmentLink({ id, filename, children }: { id: string; filename?: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);

  const onClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const blob = await fetchBlob(`/api/v1/attachments/${id}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || id;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <a href={`/api/v1/attachments/${id}`} onClick={onClick} aria-busy={busy}>
      {children}
    </a>
  );
}

type RichSegment =
  | { type: "html"; html: string }
  | { type: "img"; id: string; alt: string }
  | { type: "link"; id: string; inner: string };

// Matches the two attachment reference shapes sanitizeRich can leave behind:
//   <img ... src="attachment:ID" ...>
//   <a ... href="attachment:ID" ...>inner</a>
const ATTACHMENT_RE = /<img\b[^>]*\bsrc="attachment:([^"]+)"[^>]*>|<a\b[^>]*\bhref="attachment:([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

function altOf(imgTag: string): string {
  const m = /\balt="([^"]*)"/.exec(imgTag);
  return m ? m[1] : "";
}

/** Splits sanitised rich html at attachment img/link boundaries so those can render as React components. */
function splitAttachments(html: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let last = 0;
  ATTACHMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTACHMENT_RE.exec(html))) {
    if (m.index > last) segments.push({ type: "html", html: html.slice(last, m.index) });
    if (m[1] !== undefined) segments.push({ type: "img", id: m[1], alt: altOf(m[0]) });
    else segments.push({ type: "link", id: m[2]!, inner: m[3] ?? "" });
    last = ATTACHMENT_RE.lastIndex;
  }
  if (last < html.length) segments.push({ type: "html", html: html.slice(last) });
  return segments;
}

function RichBlock({ html, attachmentsById }: { html: string; attachmentsById: Map<string, Attachment> }) {
  const segments = useMemo(() => splitAttachments(html), [html]);
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === "img") return <AttachmentImage key={i} id={s.id} alt={s.alt} />;
        if (s.type === "link") {
          return (
            <AttachmentLink key={i} id={s.id} filename={attachmentsById.get(s.id)?.filename}>
              <RawHtml as="span" html={s.inner} />
            </AttachmentLink>
          );
        }
        return <RawHtml key={i} html={s.html} />;
      })}
    </>
  );
}

/**
 * Renders a comment/ticket body as sanitised markdown. `attachments` (the ticket's known
 * attachments, if the caller has them handy) is only used to resolve a friendly filename for
 * attachment: links' downloads; it is not required for images or for sanitisation, which is
 * driven entirely by renderBlocks.
 */
export function Markdown({ body, attachments = [] }: { body: string; attachments?: Attachment[] }) {
  const blocks = useMemo(() => renderBlocks(body), [body]);
  const attachmentsById = useMemo(() => new Map(attachments.map((a) => [a.id, a])), [attachments]);

  return (
    <div className="md">
      {blocks.map((b, i) =>
        b.kind === "html" ? (
          <HtmlFrame key={i} html={b.html} />
        ) : (
          <RichBlock key={i} html={b.html} attachmentsById={attachmentsById} />
        ),
      )}
    </div>
  );
}
