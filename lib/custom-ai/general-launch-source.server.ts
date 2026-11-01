import "server-only";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { bindGeneralCheckBlueprint } from "./check-blueprint";
import { generalCheckCaseCount } from "./behavior-checks";
import { GENERAL_PROJECT_COMPILER, projectCompilerInput } from "./contract-project";
import { cachedLaunchIntent, intentHasOpenParts } from "./launch-intent";
import { CustomAIError, type ChatRequest, type ChatResult } from "./types";
import { builderChain, type BuilderChainId } from "./execution-routing";
import type { BlueprintCheckpoint, ProjectCheckpoint } from "./project-store.server";
import type { Conversation } from "./conversation";
import type { StudioState } from "./studio";
import {checkedGeneralSourceAudit} from "./source-audit.server";

export type GeneralLaunchSourceSelection = {
  id: string; account: string; conversation: string; studioRevision: number; chainId: BuilderChainId;
  projectHash: `sha256:${string}`; artifactHash: `sha256:${string}`; intentRevision: string;
  /** Revalidation after an async preparation may tolerate an unsent-input-only
   * studio revision. Its complete semantic binding must still match exactly. */
  bindingHash?: `sha256:${string}`;
};
export type GeneralLaunchSourceSnapshot = {
  conversation: Conversation; studioRevision: number; studio: StudioState;
  sourceJob: { state: string; payloadHash: string; request: ChatRequest; result: ChatResult };
  contextJob: { state: string; request: ChatRequest; result: ChatResult };
  checkpoint: ProjectCheckpoint; declared: BlueprintCheckpoint;
};
const changed = (): never => { throw new CustomAIError("launch-source-changed", "This chat or source changed. Refresh the saved design before preparing it.", 409); };
const checks = (): never => { throw new CustomAIError("launch-source-checks", "Finish the saved source and behavior checks before preparing this launch.", 422); };
const hashPattern = /^sha256:[a-f0-9]{64}$/u;

/** A bound source snapshot for subsequent packing, never a deployment permit.
 * Network/profile constraints and the existing backend admission still follow. */
export function checkedGeneralLaunchSource(owner: string, selected: GeneralLaunchSourceSelection, snapshot: GeneralLaunchSourceSnapshot) {
  try { builderChain(selected.chainId); } catch { return changed(); }
  const { conversation, studio, sourceJob, contextJob, checkpoint, declared } = snapshot;
  if (!owner || !/^[A-Za-z0-9-]{16,64}$/u.test(selected.id) || !/^0x[a-f0-9]{40}$/iu.test(selected.account)
    || !Number.isSafeInteger(selected.studioRevision) || selected.studioRevision < 1
    || !hashPattern.test(selected.projectHash) || !hashPattern.test(selected.artifactHash) || !/^[a-f0-9]{64}$/u.test(selected.intentRevision)
    || (selected.bindingHash !== undefined && !hashPattern.test(selected.bindingHash))) return changed();
  if (conversation.archived || conversation.activeRequest || conversation.account.toLowerCase() !== selected.account.toLowerCase()
    || conversation.id.toLowerCase() !== selected.conversation.toLowerCase() || !studio || studio.draftId !== selected.id || !studio.contextId
    || studio.pendingChange?.trim() || studio.settings.chainId !== selected.chainId
    || snapshot.studioRevision !== selected.studioRevision && selected.bindingHash === undefined) return changed();
  for (const job of [sourceJob, contextJob]) {
    const scope = job.request?.conversation;
    if (job.state !== "completed" || !scope || scope.account.toLowerCase() !== selected.account.toLowerCase()
      || scope.id.toLowerCase() !== selected.conversation.toLowerCase()) return changed();
  }
  if (contextJob.result?.change === "blocked" || contextJob.result?.unresolved?.length) return changed();
  const { project, compilation, scenarios } = checkpoint;
  if (checkpoint.requestId !== selected.id || checkpoint.payloadHash !== sourceJob.payloadHash
    || declared.requestId !== selected.id || declared.payloadHash !== sourceJob.payloadHash
    || !compilation?.compiled || !scenarios?.passed) return checks();
  try { projectCompilerInput(project); } catch { return checks(); }
  const currentIntent = cachedLaunchIntent(contextJob.result?.intent ?? sourceJob.result?.intent ?? project.intent);
  if (!currentIntent || intentHasOpenParts(currentIntent) || currentIntent.id !== project.intent.id
    || currentIntent.revision !== selected.intentRevision || project.intent.revision !== selected.intentRevision
    || project.chainId !== selected.chainId || project.hash !== selected.projectHash
    || canonicalBrowserSha256V2("programmable.general-check-intent.v1", currentIntent) !== declared.blueprint.intentHash) return changed();
  let plan: ReturnType<typeof bindGeneralCheckBlueprint>;
  try { plan = bindGeneralCheckBlueprint(declared.blueprint, project); } catch { return checks(); }
  if (!Array.isArray(compilation.diagnostics) || !Array.isArray(compilation.contracts)
    || !Array.isArray(scenarios.failures) || !Array.isArray(scenarios.requirementIds)) return checks();
  const { artifactHash, ...artifact } = compilation, { hash: scenarioHash, ...report } = scenarios;
  const view = sourceJob.result?.generalProject;
  if (checkpoint.blueprintId !== declared.blueprint.id || compilation.version !== 1 || compilation.projectHash !== project.hash
    || ![GENERAL_PROJECT_COMPILER, `${GENERAL_PROJECT_COMPILER}.Emscripten.clang`].includes(compilation.compiler)
    || compilation.launchReady !== false || compilation.verification !== "not-run" || compilation.diagnostics.some(item => item.severity === "error")
    || artifactHash !== selected.artifactHash || canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", artifact) !== artifactHash
    || compilation.contracts.length !== project.entrypoints.length || project.entrypoints.some(entry =>
      compilation.contracts.filter(contract => contract.source === entry.source && contract.contract === entry.contract && contract.role === entry.role).length !== 1)
    || scenarios.version !== plan.version || scenarios.scope !== `isolated-declared-scenarios-v${plan.version}` || scenarios.launchReady !== false || scenarios.failures.length !== 0
    || scenarios.projectHash !== project.hash || scenarios.artifactHash !== artifactHash || scenarios.planHash !== plan.id
    || scenarios.cases !== generalCheckCaseCount(plan)
    || JSON.stringify(scenarios.requirementIds) !== JSON.stringify(project.intent.requirements.map(rule => rule.id).sort())
    || canonicalBrowserSha256V2(`programmable.general-scenario-report.v${plan.version}`, report) !== scenarioHash
    || view?.projectHash !== project.hash || view.artifactHash !== artifactHash || view.intentRevision !== currentIntent.revision) return checks();
  const binding = { version: 1 as const, ownerHash: canonicalBrowserSha256V2("programmable.custom-ai-launch-owner.v1", owner),
    account: selected.account.toLowerCase(), conversation: selected.conversation.toLowerCase(), contextId: studio.contextId,
    sourceId: selected.id, payloadHash: sourceJob.payloadHash, chainId: selected.chainId, projectHash: project.hash, artifactHash,
    blueprintId: declared.blueprint.id, scenarioHash, intentRevision: currentIntent.revision,
    settings: studio.settings, image: studio.image ?? null };
  const bindingHash = canonicalBrowserSha256V2("programmable.custom-ai-launch-source.v1", binding);
  if (selected.bindingHash !== undefined && selected.bindingHash !== bindingHash) return changed();
  const sourceAudit=checkpoint.sourceAudit?checkedGeneralSourceAudit(checkpoint.sourceAudit,project):undefined;
  if(sourceAudit?.status==="changes_required")return checks();
  return structuredClone({ bindingHash, binding, studioRevision: snapshot.studioRevision, project, compilation,
    blueprint: declared.blueprint, scenarios,...(sourceAudit?{sourceAudit}:{}), launchReady: false as const });
}
