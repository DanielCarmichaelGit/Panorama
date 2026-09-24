// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Evidence, EvidenceType } from "@panorama/core";
import { EvidenceChip } from "./EvidenceChip";

afterEach(cleanup);

const prLinkType: EvidenceType = { id: "et_pr_link", name: "Pull request", kind: "pr_link", params: {}, humanOnly: false, needsAttachment: false, createdAt: "" };

const evidence = (payload: Record<string, unknown>): Evidence => ({
  id: "e1", ticketId: "t1", typeId: "et_pr_link", commentId: null, attachmentId: null, actorId: "a1", payload, result: "info", createdAt: "",
});

describe("EvidenceChip", () => {
  it("links an http(s) pull request in a new tab, with the opener kept away", () => {
    const { container } = render(<EvidenceChip evidence={evidence({ url: "https://example.com/pr/1", title: "Fix the gate" })} type={prLinkType} />);
    const anchor = container.querySelector("a") as HTMLAnchorElement;
    expect(anchor.getAttribute("href")).toBe("https://example.com/pr/1");
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toBe("noreferrer noopener");
    expect(anchor.textContent).toBe("Fix the gate");
  });

  it("renders a javascript: url as plain text with no anchor at all", () => {
    const { container } = render(<EvidenceChip evidence={evidence({ url: "javascript:alert(1)" })} type={prLinkType} />);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
  });

  it("renders a data: url as plain text with no anchor at all", () => {
    const { container } = render(<EvidenceChip evidence={evidence({ url: "data:text/html,<script>alert(1)</script>" })} type={prLinkType} />);
    expect(container.querySelector("a")).toBeNull();
  });
});
