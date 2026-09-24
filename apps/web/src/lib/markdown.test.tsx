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
});
