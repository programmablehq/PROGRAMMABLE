import "server-only";
import type { AIStore } from "./store.server";
import { jobMatchesConversation } from "./conversation.server";
import type { LaunchIntent } from "./launch-intent";
import { CustomAIError, type ChatProgress, type ChatRequest, type ChatResult } from "./types";
import { compileContractProject } from "./contract-project.server";
import type { ProjectCheckpoint } from "./project-store.server";
import { selectExecutionRoute } from "./execution-routing";
import { generalProjectView } from "./project-view";

type CompilationSource = ProjectCheckpoint & { summary: string };

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
  return { ...saved, summary: job.result?.generalProject?.summary ?? "Saved contract source" };
}

/** Called inside the existing lease/cancellation/transport. No inference,
 * provider-health check, paid repair, RPC, signing or wallet operation. */
export async function compileExistingProject(input: {
  store: AIStore; owner: string; id: string; lease: string; source: CompilationSource;
  onProgress?: (event: ChatProgress) => void;
}, signal?: AbortSignal, compile = compileContractProject): Promise<ChatResult> {
  signal?.throwIfAborted();
  const { store, owner, id, lease, source } = input;
  await store.projects.save(owner, id, lease, source.project);
  signal?.throwIfAborted(); input.onProgress?.({ type: "phase", phase: "checking" });
  const compilation = source.compilation ?? await compile(source.project, signal);
  signal?.throwIfAborted();
  await store.projects.complete(owner, id, lease, compilation);
  const selection = selectExecutionRoute(source.project.intent, source.project.chainId, { route: "custom-contract", requirementIds: source.project.intent.requirements.map(rule => rule.id), missingCapabilities: [] });
  const reply = compilation.compiled ? "The saved source compiled. Its behavior and launch preparation still need verification."
    : "The saved source has compiler diagnostics. The complete source is kept for the next edit.";
  return { reply, intent: source.project.intent, selection,
    generalProject: generalProjectView({ version: 1, reply, summary: source.summary, project: source.project, compilation, selection, requirementCoverage: "proposed", launchReady: false }),
    change: compilation.compiled ? "applied" : "blocked", memory: "", chargedAs: "build" };
}
