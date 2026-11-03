import "server-only";
import type { AIStore } from "./store.server";
import { jobMatchesConversation } from "./conversation.server";
import type { LaunchIntent } from "./launch-intent";
import { CustomAIError, type ChatProgress, type ChatRequest, type ChatResult } from "./types";
import { compileContractProject } from "./contract-project.server";
import type { ProjectCheckpoint } from "./project-store.server";
import { selectExecutionRoute } from "./execution-routing";
import { generalProjectView } from "./project-view";
import { bindGeneralCheckBlueprint, type GeneralCheckBlueprint } from "./check-blueprint";
import { checkGeneralScenarios } from "./behavior-checks.server";
import { generalBuildReply } from "./build-result";

type CompilationSource = ProjectCheckpoint & { summary: string;blueprint?:GeneralCheckBlueprint };

/** Resolve the exact owned source before reserving work. This does not accept
 * source bytes, a command, a compiler or a replacement implementation. */
export async function readCompilationSource(store: AIStore, owner: string, request: ChatRequest, currentIntent?: LaunchIntent): Promise<CompilationSource> {
  const ref = request.compilationOf, scope = request.conversation;
  if (request.intent !== "compile" || !ref || !scope) throw new CustomAIError("project", "Choose the saved source from this chat.");
  const job = await store.read(owner, ref.id);
  if (!job?.request?.conversation || !jobMatchesConversation(job.request, scope.account, scope.id)) throw new CustomAIError("context", "That source belongs to another chat.", 409);
  if (job.state === "running") throw new CustomAIError("busy", "The original build is still running. Reconnect to check it.", 429, 2000);
  const saved = await store.projects.read(owner, ref.id);
  if (!saved || saved.project.hash !== ref.projectHash) throw new CustomAIError("project-context", "The saved source changed. Reload before retrying.", 409);
  if (request.coin && request.coin.chainId !== saved.project.chainId) throw new CustomAIError("project-context", "Keep this source on its saved network or prepare a new revision.", 409);
  if (currentIntent && (currentIntent.id !== saved.project.intent.id || currentIntent.revision !== saved.project.intent.revision && currentIntent.revision !== saved.project.intent.parentRevision)) throw new CustomAIError("project-context", "Your design changed after this source was saved. Choose the version you want to restore.", 409);
  if (saved.compilation && !saved.compilation.compiled) throw new CustomAIError("project-edit", "The compiler returned source diagnostics. Update that source before building it again.", 422);
  if(saved.scenarios?.passed===false)throw new CustomAIError("project-edit","A declared contract check failed. Edit this source before running the same checks again.",422);
  if(saved.sourceAudit?.status==="changes_required")throw new CustomAIError("project-edit","The independent source review found a correction. Update this source before continuing.",422);
  let blueprint:GeneralCheckBlueprint|undefined;
  if(saved.blueprintId){
    const declared=await store.projects.readBlueprint(owner,ref.id);
    if(!declared||declared.blueprint.id!==saved.blueprintId)throw new CustomAIError("behavior-context","The original contract checks could not be loaded. Your source is kept.",409);
    bindGeneralCheckBlueprint(declared.blueprint,saved.project);blueprint=declared.blueprint;
  }
  return { ...saved,...(blueprint?{blueprint}:{}),summary: job.result?.generalProject?.summary ?? "Saved contract source" };
}

/** Called inside the existing lease/cancellation/transport. No inference,
 * provider-health check, paid repair, RPC, signing or wallet operation. */
export async function compileExistingProject(input: {
  store: AIStore; owner: string; id: string; lease: string; source: CompilationSource;
  onProgress?: (event: ChatProgress) => void;
}, signal?: AbortSignal, compile = compileContractProject,check=checkGeneralScenarios): Promise<ChatResult> {
  signal?.throwIfAborted();
  const { store, owner, id, lease, source } = input;
  if(source.blueprint)await store.projects.saveBlueprint(owner,id,lease,{intent:source.project.intent,blueprint:source.blueprint});
  await store.projects.save(owner, id, lease, source.project, source.requestId);
  if(source.sourceAudit)await store.projects.saveSourceAudit(owner,id,lease,source.sourceAudit);
  signal?.throwIfAborted(); input.onProgress?.({ type: "phase", phase: "checking" });
  const compilation = source.compilation ?? await compile(source.project, signal);
  signal?.throwIfAborted();
  await store.projects.complete(owner, id, lease, compilation);
  const scenarios=source.blueprint&&compilation.compiled?source.scenarios??await check(source.project,compilation,bindGeneralCheckBlueprint(source.blueprint,source.project),signal):undefined;
  signal?.throwIfAborted();
  if(scenarios)await store.projects.saveScenarios(owner,id,lease,scenarios);
  const selection = selectExecutionRoute(source.project.intent, source.project.chainId, { route: "custom-contract", requirementIds: source.project.intent.requirements.map(rule => rule.id), missingCapabilities: [] });
  const passed=compilation.compiled&&scenarios?.passed!==false;
  const reply = generalBuildReply({ compilation, sourceAudit: source.sourceAudit, scenarios });
  return { reply, intent: source.project.intent, selection,
    generalProject: generalProjectView({ version: 1, reply, summary: source.summary, project: source.project, compilation, selection,...(source.blueprint?{blueprintId:source.blueprint.id}:{}),...(source.sourceAudit?{sourceAudit:source.sourceAudit}:{}),...(scenarios?{scenarios}:{}),requirementCoverage: "proposed", launchReady: false }),
    change: passed ? "applied" : "blocked", memory: "", chargedAs: "build" };
}
