import { describe, expect, it } from "vitest";
import { completedBuildReply, generalBuildReply, BUILD_REPLY_LOCALES } from "../lib/custom-ai/build-result";

type Result = Parameters<typeof generalBuildReply>[0];
const compiled = { compiled: true };
const audit = { status: "passed" as const, findings: [] };
const scenarios = { passed: true, cases: 21 };
describe("observed build completion instead of a model's predicted result", () => {
  it("reports completed checks without claiming launch admission or settlement", () => {
    const result = generalBuildReply({ compilation: compiled, sourceAudit: audit, scenarios });
    expect(result).toBe(completedBuildReply());
    expect(result).not.toMatch(/launch ready|deployed|still have to run/iu);
  });
  it.each<Result>([
    { compilation: { ...compiled, compiled: false }, sourceAudit: audit, scenarios },
    { compilation: compiled, sourceAudit: { ...audit, status: "changes_required", findings: [{ message: "Counter doubles the required increment." }] }, scenarios },
    { compilation: compiled, sourceAudit: audit, scenarios: { ...scenarios, passed: false } },
  ])("keeps failed compilation, audit or behavior from becoming a success claim", value => {
    expect(generalBuildReply(value)).not.toBe(completedBuildReply());
  });
  it("does not invent an audit or behavior result when that stage is missing", () => {
    expect(generalBuildReply({ compilation: compiled, scenarios })).toContain("Independent source review is still required");
    expect(generalBuildReply({ compilation: compiled, sourceAudit: audit })).toContain("behavior checks are not complete");
    expect(generalBuildReply({ compilation: compiled })).not.toContain("passed");
  });
});

it("keeps completion distinct from failures in every supported language",()=>{
 for(const locale of BUILD_REPLY_LOCALES){
  expect(generalBuildReply({compilation:compiled,sourceAudit:audit,scenarios},locale)).toBe(completedBuildReply(locale));
  expect(generalBuildReply({compilation:{compiled:false},sourceAudit:audit,scenarios},locale)).not.toBe(completedBuildReply(locale));
 }
 expect(completedBuildReply("de")).not.toBe(completedBuildReply("en"));
});
