// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderBlocks } from "./markdown";

describe("renderBlocks", () => {
  it("renders markdown to sanitised html and keeps attachment links", () => {
    const [b] = renderBlocks("# Title\n\nsome **bold** and ![shot](attachment:abc) and [f](attachment:def) <img src=x onerror=alert(1)>");
    expect(b.kind).toBe("rich");
    expect(b.html).toContain("<h1>Title</h1>");
    expect(b.html).toContain("<strong>bold</strong>");
    expect(b.html).toContain('src="attachment:abc"');
    expect(b.html).toContain('href="attachment:def"');
    expect(b.html).not.toContain("onerror");
  });

  it("splits raw html blocks and html fences into frame blocks with scripts removed", () => {
    const blocks = renderBlocks('before\n\n<div class="report"><script>x()</script><b>ok</b></div>\n\nafter\n\n```html\n<p onclick="y()">hi</p>\n```\n');
    expect(blocks.map((b) => b.kind)).toEqual(["rich", "html", "rich", "html"]);
    expect(blocks[1].html).toContain("<b>ok</b>");
    expect(blocks[1].html).not.toContain("script");
    expect(blocks[3].html).toBe("<p>hi</p>");
  });

  it("strips javascript urls", () => {
    expect(renderBlocks("[x](javascript:alert(1))")[0].html).not.toContain("javascript:");
  });

  it("is the only sanitiser: entity-encoded and raw scripts never become elements, and event handlers are stripped from raw html", () => {
    // Comment bodies are stored verbatim on the server, so this pipeline is the only
    // sanitiser standing between a comment and the DOM. An entity-encoded script tag is
    // inert text either way; a literal <script> written inline (mid-paragraph, so it stays
    // part of a "rich" block rather than being pulled out as its own html block) must still
    // be stripped, because rich blocks are rendered with dangerouslySetInnerHTML.
    const [rich] = renderBlocks(
      "encoded &lt;script&gt;alert(1)&lt;/script&gt; and raw <script>alert(2)</script> text",
    );
    expect(rich.kind).toBe("rich");
    expect(rich.html).not.toContain("<script");

    const [htmlBlock] = renderBlocks('<div><img src="x" onerror="alert(1)"></div>');
    expect(htmlBlock.kind).toBe("html");
    expect(htmlBlock.html).not.toContain("onerror");
    expect(htmlBlock.html).toContain("<img");
  });

  it("downgrades attachment references with a crafted id to plain text instead of an img or a element", () => {
    // Only a server-issued id ([A-Za-z0-9-]{1,64}) may ever end up interpolated into an
    // attachment fetch URL or href. A path-traversal- or query-string-shaped "id" must never
    // survive as a real element: it should read as ordinary text, exactly as if the markdown
    // author had just typed the alt text / link text with no attachment reference at all.
    const [b] = renderBlocks("![shot](attachment:../secret?x=1) and [f](attachment:../secret?x=1)");
    expect(b.kind).toBe("rich");
    expect(b.html).not.toContain("<img");
    expect(b.html).not.toContain("<a ");
    expect(b.html).not.toContain("<a>");
    expect(b.html).toContain("shot");
    expect(b.html).toContain("f");

    // Regression: a bad id must be neutralised before marked.parser ever turns it into HTML, not
    // by editing DOMPurify's output afterward. An earlier version of this downgrade ran as a
    // regex pass over the *sanitised* html string, splicing a captured alt="" attribute value
    // back in unescaped; because that ran after DOMPurify, the spliced text was never sanitised,
    // and this exact alt text reparsed into a live, scriptable <img onerror> once set through
    // dangerouslySetInnerHTML. The fix works at the marked token level instead, so DOMPurify
    // still gets exactly one pass over the final string, alt text included.
    const [poc] = renderBlocks("![<img src=1 onerror=alert(1) data-x=](attachment:../secret)");
    expect(poc.kind).toBe("rich");
    // "onerror" as visible, escaped text (part of the author's literal alt text, now displayed
    // as ordinary text) is fine and expected; what must never exist is a DOM element carrying a
    // live onerror attribute, which is what these two DOM-level checks confirm.
    const parsed = new DOMParser().parseFromString(poc.html, "text/html");
    expect(parsed.querySelector("img[onerror]")).toBeNull();
    expect(parsed.querySelector("img")).toBeNull();
  });
});
