import "server-only";
import Ajv from "ajv";
import type { createRunStore } from "./runs.server";
import type { createPlatformStore } from "./project-store.server";
import type { WorkerGrantClaims } from "./protocol.generated";
import type { ProjectLevel } from "./builds.server";
import { canonicalProjectJSON, projectHash } from "./document";
import { ProjectError, type ProjectRevision, type ProjectScope, type JsonValue } from "./types";
import { CustomAIError } from "../types";

export type AgentDecision = { kind: "tool" | "reply" | "question"; tool: string | null; input: JsonValue; message: string; claim: ProjectLevel };
export type ToolContext = ProjectScope & { runId: string; leaseToken: string; stepId: string; revision: ProjectRevision; prompt: string; signal: AbortSignal };
export type ProjectTool = { id: string; version: string; description: string; schema: object;
  execute(context: ToolContext, input: JsonValue): Promise<JsonValue>;
  reconcile?(context: ToolContext, input: JsonValue): Promise<JsonValue>;
};
type Step = { id: string; cursor: number; capability_id: string; input: JsonValue; result: JsonValue; state: string };
export type AgentContext = { project: ProjectRevision; prompt: string; operation: string; tools: Pick<ProjectTool, "id" | "version" | "description" | "schema">[]; steps: Step[]; history: Record<string, unknown>[] };
const levels: ProjectLevel[] = ["discussed", "planned", "built", "verified", "deployed", "operational"];
export function parseAgentDecision(raw: unknown): AgentDecision {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProjectError("agent-response", "The agent returned an incomplete decision.", 502);
  const item = raw as AgentDecision;
  if (!["tool", "reply", "question"].includes(item.kind) || typeof item.message !== "string" || !item.message.trim() || item.message.length > 4000
    || !levels.includes(item.claim) || item.kind === "tool" && (typeof item.tool !== "string" || !item.tool) || item.kind !== "tool" && item.tool !== null
    || canonicalProjectJSON(item.input).length > 550000) throw new ProjectError("agent-response", "The agent returned an incomplete decision.", 502);
  return item;
}

export function createProjectAgent(dependencies: { runs: ReturnType<typeof createRunStore>; projects: ReturnType<typeof createPlatformStore>; tools: ProjectTool[];
  choose(context: AgentContext, signal: AbortSignal): Promise<AgentDecision>; assess(ref: ProjectScope & { revisionId: string }): Promise<{ level: ProjectLevel }> }) {
  const { runs, projects } = dependencies;
  const tools = new Map(dependencies.tools.map(tool => [tool.id, { tool, validate: new Ajv({ strict: false, allErrors: false }).compile(tool.schema) }]));
  if (tools.size !== dependencies.tools.length) throw new TypeError("Duplicate project tool");
  async function advance(grant: WorkerGrantClaims, leaseToken: string, externalSignal?: AbortSignal) {
    const scope = { ownerId: grant.ownerId, projectId: grant.projectId };
    const saved = await runs.readRun(scope, grant.runId);
    if (["succeeded", "failed", "cancelled", "waiting_user"].includes(saved.status)) return { run: saved };
    let monitor: ReturnType<typeof setInterval> | undefined;
    const controller = new AbortController();
    try {
      const work = await runs.readWork(scope, grant.runId, leaseToken), steps = work.steps as Step[];
      let revisionId = work.run.revisionId;
      for (const step of steps) if (step.state === "completed" && step.capability_id !== "model.plan" && step.result && typeof step.result === "object" && !Array.isArray(step.result)) {
        const result = step.result as Record<string, JsonValue>;
        if (result.ok === true && result.value && typeof result.value === "object" && !Array.isArray(result.value) && typeof result.value.revisionId === "string") revisionId = result.value.revisionId;
      }
      const revision = await projects.readRevision(scope, revisionId), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(250000), ...(externalSignal ? [externalSignal] : [])]);
      let checking = false;
      monitor = setInterval(async () => {
        if (checking || signal.aborted) return;
        checking = true;
        try { if (!await runs.leaseActive(scope, grant.runId, leaseToken)) controller.abort(); } catch { controller.abort(); }
        finally { checking = false; }
      }, 3000);
      monitor.unref?.();
      const pending = steps.find(step => step.state !== "completed"), last = steps.at(-1);
      let stepId: string, capabilityId: string, input: JsonValue;
      if (pending) { stepId = pending.id; capabilityId = pending.capability_id; input = pending.input; }
      else if (last?.capability_id === "model.plan") {
        const decision = parseAgentDecision(last.result);
        if (decision.kind !== "tool") {
          const actual = await dependencies.assess({ ...scope, revisionId });
          if (levels.indexOf(decision.claim) > levels.indexOf(actual.level)) return { run: await runs.failRun(scope, grant.runId, leaseToken, "unverified-completion-claim", false) };
          return { run: await runs.finishRun(scope, grant.runId, leaseToken, decision.message, decision.kind === "question" ? "waiting_user" : "succeeded") };
        }
        stepId = `step-${work.run.cursor}`; capabilityId = decision.tool!; input = decision.input;
      } else {
        stepId = `step-${work.run.cursor}`; capabilityId = "model.plan";
        input = { revisionId, registryHash: projectHash(dependencies.tools.map(({ id, version, schema }) => ({ id, version, schema }))) };
      }
      if (Number(work.run.cursor) >= 23 && !pending) return { run: await runs.finishRun(scope, grant.runId, leaseToken, "This work unit reached its step limit. The project and completed checks are saved; continue from this revision.") };
      const begin = await runs.beginStep(scope, grant.runId, leaseToken, { id: stepId, capabilityId, input });
      if (begin.pending) return { run: await runs.readRun(scope, grant.runId) };
      let result: JsonValue;
      if (capabilityId === "model.plan") {
        if (!begin.execute) return { run: await runs.readRun(scope, grant.runId) };
        const chosen = await dependencies.choose({ project: revision, prompt: work.prompt, operation: work.operation,
          tools: dependencies.tools.filter(tool => runs.allowedCapabilities(work.operation).includes(tool.id)).map(({ id, version, description, schema }) => ({ id, version, description, schema })), steps, history: work.history }, signal);
        result = parseAgentDecision(chosen) as unknown as JsonValue;
      } else {
        const registered = tools.get(capabilityId);
        if (!registered) throw new ProjectError("agent-tool", "This project tool is not registered.", 403);
        if (!registered.validate(input)) throw new ProjectError("agent-input", "The tool arguments did not match its declared schema.", 422);
        const context: ToolContext = { ...scope, runId: grant.runId, leaseToken, stepId: `${grant.runId}:${stepId}`, revision, prompt: work.prompt, signal };
        try {
          if (begin.reconcile) {
            if (!registered.tool.reconcile) throw new ProjectError("agent-reconciliation", "The uncertain action must be reconciled before continuing.", 409);
            result = { ok: true, value: await registered.tool.reconcile(context, input) };
          } else if (begin.execute) result = { ok: true, value: await registered.tool.execute(context, input) };
          else return { run: await runs.readRun(scope, grant.runId) };
        } catch (error) {
          if (error instanceof ProjectError && !["run-lease", "project-conflict", "agent-reconciliation"].includes(error.code)) result = { ok: false, code: error.code, message: error.message };
          else throw error;
        }
      }
      return { run: await runs.finishStep(scope, grant.runId, leaseToken, { id: stepId, result, ...(begin.reconcile ? { reconciled: true } : {}) }) };
    } catch (error) {
      if (error instanceof ProjectError && error.code === "run-lease") throw error;
      const code = error instanceof ProjectError || error instanceof CustomAIError ? error.code : "agent-provider";
      const retryable = ["provider_rate_limit", "provider_overloaded", "provider_cooldown", "connection", "provider_stream"].includes(code);
      return { run: await runs.failRun(scope, grant.runId, leaseToken, code, retryable) };
    } finally { if (monitor) clearInterval(monitor); }
  }
  return { advance };
}
