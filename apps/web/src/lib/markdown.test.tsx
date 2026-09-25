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

  it("renders task-list checkboxes as inert markers, and strips any other input outright", () => {
    // Ticket success criteria and comments both go through here: a task-list checkbox is the one
    // interactive element markdown is allowed to produce, and even that keeps only the attributes
    // that make it a checkbox marker. A smuggled-in text field (a real form control, however
    // harmless-looking) must not survive at all.
    const [b] = renderBlocks('- [ ] Todo one\n- [x] Todo two <input type="text" onfocus="steal()" id="x">\n');
    const inputs = Array.from(new DOMParser().parseFromString(b.html, "text/html").querySelectorAll("input"));
    expect(inputs.map((i) => [i.type, i.disabled, i.checked, i.dataset.taskIndex])).toEqual([["checkbox", true, false, "0"], ["checkbox", true, true, "1"]]);
    expect(inputs.every((i) => i.attributes.length === 3 + (i.checked ? 1 : 0))).toBe(true);
    expect(b.html).not.toContain("onfocus");
    expect(b.html).not.toContain('id="x"');
  });

  it("strips a literal checkbox written inline, so a comment never shows a tickable box", () => {
    const [b] = renderBlocks('Tick <input type="checkbox"> here, or <input type="checkbox" checked disabled> there\n');
    const parsed = new DOMParser().parseFromString(b.html, "text/html");
    expect(parsed.querySelector("input")).toBeNull();
    expect(parsed.body.textContent).toContain("Tick  here");
  });

  it("keeps each task item's own index when an inline input sits among them", () => {
    const [b] = renderBlocks('- [ ] One <input type="checkbox">\n- [x] Two\n\n> - [ ] Three\n');
    const parsed = new DOMParser().parseFromString(b.html, "text/html");
    const boxes = Array.from(parsed.querySelectorAll("input"));
    expect(boxes.map((i) => i.dataset.taskIndex)).toEqual(["0", "1", "2"]);
    expect(boxes.map((i) => i.checked)).toEqual([false, true, false]);
  });

  it("does not honour an authored data-task-index", () => {
    const [b] = renderBlocks('- [ ] One\n\nFake <input type="checkbox" data-task-index="0"> and <span data-task-index="0">x</span>\n');
    const parsed = new DOMParser().parseFromString(b.html, "text/html");
    expect(parsed.querySelectorAll("[data-task-index]")).toHaveLength(1);
    expect(parsed.querySelectorAll("input")).toHaveLength(1);
  });

  it("does not turn a plain list item into a checkbox", () => {
    const [b] = renderBlocks("- [ ] A task\n- Not a task\n");
    const parsed = new DOMParser().parseFromString(b.html, "text/html");
    expect(parsed.querySelectorAll('input[type="checkbox"]').length).toBe(1);
  });
});
