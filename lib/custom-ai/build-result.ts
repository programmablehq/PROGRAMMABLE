type BuildResult = {
  compilation: { compiled: boolean };
  sourceAudit?: { status: "passed" | "changes_required"; findings: ReadonlyArray<{ message: string }> };
  scenarios?: { passed: boolean; cases: number };
};

/** Completion is reported from persisted check results, never a source model's
 * prediction written before the compiler and independent checks have run. */
export function generalBuildReply(value: BuildResult): string {
  if (value.sourceAudit?.status === "changes_required") {
    return `The source is saved. The independent review found a correction: ${value.sourceAudit.findings[0]?.message ?? "Update this source before continuing."}`;
  }
  if (!value.compilation.compiled) return "The source is saved, but it has compiler diagnostics. Ask me to fix this source.";
  if (value.scenarios?.passed === false) return "The source is saved, but a declared contract check failed. Ask me to fix this source.";
  if (value.scenarios?.passed && value.sourceAudit?.status === "passed") {
    return `Your hook is built and saved. It compiled successfully, the independent source review passed, and all ${value.scenarios.cases} declared checks passed. No launch transaction has been sent.`;
  }
  if (value.scenarios?.passed) {
    return `Your source compiled and all ${value.scenarios.cases} declared checks passed. Independent source review is still required before launch preparation.`;
  }
  return value.sourceAudit?.status === "passed"
    ? "Your source compiled and the independent source review passed. The declared behavior checks are not complete yet."
    : "Your source compiled and is saved. Independent source review and behavior checks are not complete yet.";
}
