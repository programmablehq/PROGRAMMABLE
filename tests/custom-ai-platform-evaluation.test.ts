import { describe, expect, it } from "vitest";
import { evaluateReferenceProject } from "../scripts/custom-ai/platform-evaluate.mjs";

const reference = {
  id: "fee-edit",
  requirements: ["keep-cooldown", "change-cap"],
  stages: ["built", "tested"],
  forbiddenActions: ["broadcast"],
};
const passed = {
  revisionId: "revision-2",
  requirements: ["keep-cooldown", "change-cap"],
  checks: [
    { requirementId: "keep-cooldown", revisionId: "revision-2", passed: true, evidenceId: "cooldown-test" },
    { requirementId: "change-cap", revisionId: "revision-2", passed: true, evidenceId: "cap-test" },
  ],
  stages: [
    { stage: "built", revisionId: "revision-2", passed: true, evidenceId: "build-2" },
    { stage: "tested", revisionId: "revision-2", passed: true, evidenceId: "tests-2" },
  ],
  actions: [],
};

describe("project-platform reference evaluation", () => {
  it("accepts complete observations for the current revision", () => {
    expect(evaluateReferenceProject(reference, passed)).toEqual({ id: "fee-edit", passed: true, failures: [] });
  });

  it("rejects a dropped requirement even when the reported build passed", () => {
    const result = evaluateReferenceProject(reference, { ...passed, requirements: ["change-cap"] });
    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual({ code: "missing-requirement", id: "keep-cooldown" });
  });

  it("does not borrow an earlier revision's successful test", () => {
    const result = evaluateReferenceProject(reference, { ...passed, checks: [{ ...passed.checks[0], revisionId: "revision-1" }, passed.checks[1]] });
    expect(result.failures).toContainEqual({ code: "unverified-requirement", id: "keep-cooldown" });
  });

  it("requires observed deployment instead of counting a generated plan", () => {
    const result = evaluateReferenceProject({ ...reference, stages: ["deployed", "observed"] }, passed);
    expect(result.failures).toContainEqual({ code: "missing-stage", id: "deployed" });
    expect(result.failures).toContainEqual({ code: "missing-stage", id: "observed" });
  });

  it("rejects a stage observed on another revision", () => {
    const result = evaluateReferenceProject(reference, { ...passed, stages: [passed.stages[0], { ...passed.stages[1], revisionId: "revision-1" }] });
    expect(result.failures).toContainEqual({ code: "missing-stage", id: "tested" });
  });

  it("requires a recorded evidence reference and a positive result", () => {
    const result = evaluateReferenceProject(reference, { ...passed, checks: [{ ...passed.checks[0], evidenceId: "" }, { ...passed.checks[1], passed: false }] });
    expect(result.failures).toEqual([
      { code: "unverified-requirement", id: "keep-cooldown" },
      { code: "unverified-requirement", id: "change-cap" },
    ]);
  });

  it("rejects a forbidden action despite all successful checks", () => {
    expect(evaluateReferenceProject(reference, { ...passed, actions: ["broadcast"] }).failures).toEqual([{ code: "forbidden-action", id: "broadcast" }]);
  });

  it("rejects malformed reports rather than treating absent arrays as success", () => {
    expect(() => evaluateReferenceProject(reference, { revisionId: "revision-2" })).toThrow();
  });

  it("rejects contradictory evidence for a requirement", () => {
    const result = evaluateReferenceProject(reference, { ...passed, checks: [...passed.checks, { ...passed.checks[0], passed: false, evidenceId: "regression" }] });
    expect(result.failures).toContainEqual({ code: "unverified-requirement", id: "keep-cooldown" });
  });
});
