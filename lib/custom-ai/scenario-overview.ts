import type { GeneralScenarioReport } from "./behavior-checks.server";

export type ScenarioOverview=Pick<GeneralScenarioReport,"scope"|"hash"|"planHash"|"passed"|"cases"|"failures">;
export const scenarioOverview=(report:GeneralScenarioReport):ScenarioOverview=>({scope:report.scope,hash:report.hash,planHash:report.planHash,passed:report.passed,cases:report.cases,
  failures:report.failures.slice(0,8).map(item=>({caseId:item.caseId,code:item.code,message:item.message.slice(0,500)}))});

/** Advisory browser metadata never grants a permit or changes readiness. */
export function cachedScenarioOverview(value:unknown):ScenarioOverview|undefined{
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const v=value as ScenarioOverview;
  if(v.scope!=="isolated-declared-scenarios-v1"||!/^sha256:[a-f0-9]{64}$/.test(v.hash)||!/^sha256:[a-f0-9]{64}$/.test(v.planHash)
    ||typeof v.passed!=="boolean"||!Number.isSafeInteger(v.cases)||v.cases<0||v.cases>300||!Array.isArray(v.failures)||v.failures.length>8
    ||v.passed!==(v.failures.length===0)||v.failures.some(item=>!item||typeof item.caseId!=="string"||item.caseId.length>100
      ||typeof item.code!=="string"||item.code.length>100||typeof item.message!=="string"||item.message.length>500))return;
  return {scope:v.scope,hash:v.hash,planHash:v.planHash,passed:v.passed,cases:v.cases,failures:v.failures.map(item=>({caseId:item.caseId,code:item.code,message:item.message}))};
}
