import { describe, expect, it } from "vitest";
import { checkGate, DEFAULT_EVIDENCE_TYPES, evaluateEvidence } from "./index";

const t = (kind: any, params: any = {}) => ({ kind, params });

describe("evaluateEvidence", () => {
  it("passes a clean test run and fails one with failures", () => {
    expect(evaluateEvidence(t("test_run"), { passed: 12, failed: 0 })).toBe("pass");
    expect(evaluateEvidence(t("test_run"), { passed: 11, failed: 1, output: "x" })).toBe("fail");
  });
  it("applies the eval threshold, defaulting to 0.9", () => {
    expect(evaluateEvidence(t("eval_score"), { score: 0.9 })).toBe("pass");
    expect(evaluateEvidence(t("eval_score"), { score: 0.89 })).toBe("fail");
    expect(evaluateEvidence(t("eval_score", { threshold: 0.5 }), { score: 0.6 })).toBe("pass");
  });
  it("returns info for links and files, pass for sign-off, and the stated result for custom", () => {
    expect(evaluateEvidence(t("pr_link"), { url: "https://example.com/pr/1" })).toBe("info");
    expect(evaluateEvidence(t("file"), {})).toBe("info");
    expect(evaluateEvidence(t("human_signoff"), { note: "ok" })).toBe("pass");
    expect(evaluateEvidence(t("custom"), { result: "fail" })).toBe("fail");
  });
  it("rejects payloads that do not match the kind", () => {
    expect(() => evaluateEvidence(t("test_run"), { passed: "many" })).toThrow();
    expect(() => evaluateEvidence(t("eval_score"), { score: 2 })).toThrow();
    expect(() => evaluateEvidence(t("pr_link"), { url: "not a url" })).toThrow();
    expect(() => evaluateEvidence(t("custom"), { result: "maybe" })).toThrow();
  });
  it("accepts only http and https links for a pull request", () => {
    expect(evaluateEvidence(t("pr_link"), { url: "http://example.com/pr/1" })).toBe("info");
    expect(evaluateEvidence(t("pr_link"), { url: "HTTPS://example.com/pr/1" })).toBe("info");
    expect(() => evaluateEvidence(t("pr_link"), { url: "javascript:alert(1)" })).toThrow();
    expect(() => evaluateEvidence(t("pr_link"), { url: "data:text/html,<script>alert(1)</script>" })).toThrow();
  });
});

describe("checkGate", () => {
  const req = [{ typeId: "et_eval_score", count: 1 }, { typeId: "et_test_run", count: 2 }];
  it("returns only unmet requirements with counts, ignoring failed evidence", () => {
    expect(checkGate(req, [])).toEqual([{ typeId: "et_eval_score", need: 1, have: 0 }, { typeId: "et_test_run", need: 2, have: 0 }]);
    expect(checkGate(req, [{ typeId: "et_eval_score", result: "fail" }, { typeId: "et_test_run", result: "pass" }, { typeId: "et_test_run", result: "info" }]))
      .toEqual([{ typeId: "et_eval_score", need: 1, have: 0 }]);
    expect(checkGate(req, [{ typeId: "et_eval_score", result: "pass" }, { typeId: "et_test_run", result: "pass" }, { typeId: "et_test_run", result: "pass" }])).toEqual([]);
  });
  it("is empty for a lane with no requirements", () => { expect(checkGate([], [])).toEqual([]); });
});

describe("defaults", () => {
  it("ships six evidence types with the ids the default lanes reference", () => {
    const ids = DEFAULT_EVIDENCE_TYPES.map((e) => e.id);
    expect(ids).toEqual(["et_test_run", "et_pr_link", "et_eval_score", "et_screenshot", "et_human_signoff", "et_file"]);
    expect(DEFAULT_EVIDENCE_TYPES.find((e) => e.id === "et_human_signoff")!.humanOnly).toBe(true);
    expect(DEFAULT_EVIDENCE_TYPES.find((e) => e.id === "et_screenshot")!.needsAttachment).toBe(true);
  });
});
