import {createHash} from "node:crypto";
import {canonicalBrowserJsonV2} from "../../lib/custom-launch/browser-authority-v2";
import {projectCompilerInput,type ContractProject} from "../../lib/custom-ai/contract-project";
import {SOURCE_AUDIT_POLICY_ID,SOURCE_AUDIT_REVIEWED_POLICY_IDS} from "../../lib/custom-ai/source-audit-policy";

/** Mock inference only; bind its answer to the actual full project input. */
export function sourceAuditModelValue(project:ContractProject,overrides:Record<string,unknown>={}) {
  return {compilerInputHash:`sha256:${createHash("sha256").update(canonicalBrowserJsonV2(projectCompilerInput(project)),"utf8").digest("hex")}`,
    policyId:SOURCE_AUDIT_POLICY_ID,reviewedPolicyIds:[...SOURCE_AUDIT_REVIEWED_POLICY_IDS],
    reviewedRequirementIds:project.intent.requirements.map(rule=>rule.id).sort(),findings:[],...overrides};
}

export function sourceAuditModelReply(project:ContractProject,overrides:Record<string,unknown>={}) {
  return {text:JSON.stringify(sourceAuditModelValue(project,overrides)),inputTokens:100,outputTokens:20};
}
