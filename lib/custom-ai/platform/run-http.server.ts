import "server-only";
import { readPreviewBody } from "../access.server";
import { aiError, aiHeaders } from "../http.server";
import { CustomAIError } from "../types";
import { executeProjectRequest, type ProjectAccountDependencies } from "./http.server";
import { ProjectError, type ProjectScope, type JsonValue } from "./types";
import type { createRunStore } from "./runs.server";
import type { WorkerGrantClaims } from "./protocol.generated";

const bad = () => new CustomAIError("run-input", "Choose a valid project work request.");
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw bad();
  return value as Record<string, unknown>;
}
type RunStore = ReturnType<typeof createRunStore>;
export function createRunRoutes(dependencies: ProjectAccountDependencies & { store: () => RunStore; onQueued: (scope: ProjectScope, runId: string) => Promise<void>; prepare?: () => void }) {
  const POST = (request: Request) => executeProjectRequest(dependencies, request, "write", async ownerId => {
    const body = exact(await readPreviewBody(request, 32_000), ["projectId", "revisionId", "operation", "prompt", "idempotencyKey", "budgetUnits"]);
    if (["projectId", "revisionId", "operation", "prompt", "idempotencyKey"].some(key => typeof body[key] !== "string")
      || typeof body.budgetUnits !== "number") throw bad();
    dependencies.prepare?.();
    const run = await dependencies.store().startRun({ ownerId, projectId: body.projectId as string, revisionId: body.revisionId as string,
      operation: body.operation as "plan" | "build" | "test" | "deploy", prompt: body.prompt as string,
      idempotencyKey: body.idempotencyKey as string, budgetUnits: body.budgetUnits });
    if (run.status === "queued") await dependencies.onQueued({ ownerId, projectId: run.projectId }, run.runId).catch(() => undefined);
    return Response.json({ run }, { status: 202, headers: aiHeaders });
  });
  const getScope = (request: Request, ownerId: string) => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["projectId", "runId", "afterCursor"].includes(key)) || !query.get("projectId") || !query.get("runId")) throw bad();
    return { scope: { ownerId, projectId: query.get("projectId")! }, runId: query.get("runId")! };
  };
  const GET = (request: Request) => executeProjectRequest(dependencies, request, "read", async ownerId => {
    const { scope, runId } = getScope(request, ownerId);
    return Response.json(await dependencies.store().readProgress(scope, runId, new URL(request.url).searchParams.get("afterCursor") ?? "0"), { headers: aiHeaders });
  });
  const PATCH = (request: Request) => executeProjectRequest(dependencies, request, "write", async ownerId => {
    const body = exact(await readPreviewBody(request, 4000), ["projectId", "runId", "expectedCursor"]);
    if (typeof body.projectId !== "string" || typeof body.runId !== "string" || typeof body.expectedCursor !== "string") throw bad();
    const scope = { ownerId, projectId: body.projectId };
    const run = await dependencies.store().resumeRun(scope, body.runId, body.expectedCursor);
    if (run.status === "queued") await dependencies.onQueued(scope, run.runId).catch(() => undefined);
    return Response.json({ run }, { status: 202, headers: aiHeaders });
  });
  const DELETE = (request: Request) => executeProjectRequest(dependencies, request, "write", async ownerId => {
    const { scope, runId } = getScope(request, ownerId);
    return Response.json({ run: await dependencies.store().cancelRun(scope, runId) }, { headers: aiHeaders });
  });
  return { POST, GET, DELETE, PATCH };
}

export function createWorkerRoutes(dependencies: { enabled: () => boolean; store: () => RunStore; authorize: (request: Request) => Promise<WorkerGrantClaims>;
  advance?: (grant: WorkerGrantClaims, leaseToken: string) => Promise<unknown> }) {
  const POST = async (request: Request) => {
    try {
      if (!dependencies.enabled()) throw new CustomAIError("unavailable", "Project workers are not enabled.", 404);
      const grant = await dependencies.authorize(request), scope = { ownerId: grant.ownerId, projectId: grant.projectId };
      const body = exact(await readPreviewBody(request, 620_000), ["action", "leaseToken", "step", "summary", "code", "retryable"]);
      const store = dependencies.store();
      if (body.action === "claim") {
        if (Object.keys(body).length !== 1) throw bad();
        return Response.json({ lease: await store.claimRun(scope, grant.runId, grant.workerId) }, { headers: aiHeaders });
      }
      if (typeof body.leaseToken !== "string") throw bad();
      const token = body.leaseToken;
      switch (body.action) {
        case "advance": {
          if (!dependencies.advance) throw new CustomAIError("worker-unavailable", "Project execution is not available yet.", 503);
          return Response.json(await dependencies.advance(grant, token), { headers: aiHeaders });
        }
        case "heartbeat": return Response.json({ active: await store.heartbeat(scope, grant.runId, token) }, { headers: aiHeaders });
        case "read": return Response.json(await store.readWork(scope, grant.runId, token), { headers: aiHeaders });
        case "begin": {
          const step = exact(body.step, ["id", "capabilityId", "input"]);
          if (typeof step.id !== "string" || typeof step.capabilityId !== "string") throw bad();
          return Response.json(await store.beginStep(scope, grant.runId, token, { id: step.id, capabilityId: step.capabilityId, input: step.input as JsonValue }), { headers: aiHeaders });
        }
        case "finish": {
          const step = exact(body.step, ["id", "result", "reconciled"]);
          if (typeof step.id !== "string" || step.reconciled !== undefined && typeof step.reconciled !== "boolean") throw bad();
          return Response.json({ run: await store.finishStep(scope, grant.runId, token, { id: step.id, result: step.result as JsonValue, ...(step.reconciled === undefined ? {} : { reconciled: step.reconciled }) }) }, { headers: aiHeaders });
        }
        case "complete": {
          if (typeof body.summary !== "string") throw bad();
          return Response.json({ run: await store.finishRun(scope, grant.runId, token, body.summary) }, { headers: aiHeaders });
        }
        case "fail": {
          if (typeof body.code !== "string" || typeof body.retryable !== "boolean") throw bad();
          return Response.json({ run: await store.failRun(scope, grant.runId, token, body.code, body.retryable) }, { headers: aiHeaders });
        }
        default: throw bad();
      }
    } catch (error) {
      return aiError(error instanceof ProjectError ? new CustomAIError(error.code, error.message, error.status) : error);
    }
  };
  return { POST };
}
