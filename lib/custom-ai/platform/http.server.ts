import "server-only";
import { readPreviewBody } from "../access.server";
import { aiError, aiHeaders } from "../http.server";
import { CustomAIError } from "../types";
import type { createPlatformStore } from "./project-store.server";
import { ProjectError, type ProjectPatch } from "./types";

type Dependencies = {
  enabled: () => boolean;
  authorize: (request: Request, writing: boolean) => Promise<{ ownerId: string }>;
  store: () => ReturnType<typeof createPlatformStore>;
  consume: (ownerId: string, operation: "read" | "write") => Promise<unknown>;
};
const invalid = () => new CustomAIError("project-input", "Choose a valid project and revision.");
function bodyObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}

export function createProjectRoutes(dependencies: Dependencies) {
  async function execute(request: Request, operation: "read" | "write", run: (ownerId: string) => Promise<Response>) {
    try {
      if (!dependencies.enabled()) throw new CustomAIError("unavailable", "Project workspaces are not enabled here yet.", 404);
      const { ownerId } = await dependencies.authorize(request, operation === "write");
      await dependencies.consume(ownerId, operation);
      return await run(ownerId);
    } catch (error) {
      return aiError(error instanceof ProjectError ? new CustomAIError(error.code, error.message, error.status) : error);
    }
  }

  const GET = (request: Request) => execute(request, "read", async ownerId => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["projectId", "revisionId", "limit"].includes(key))) throw invalid();
    const projectId = query.get("projectId"), revisionId = query.get("revisionId");
    const store = dependencies.store();
    if (projectId) return Response.json({ project: revisionId
      ? await store.readRevision({ ownerId, projectId }, revisionId)
      : await store.readProject({ ownerId, projectId }) }, { headers: aiHeaders });
    if (revisionId) throw invalid();
    return Response.json({ projects: await store.listProjects(ownerId, Number(query.get("limit") ?? 50)) }, { headers: aiHeaders });
  });

  const POST = (request: Request) => execute(request, "write", async ownerId => {
    const body = bodyObject(await readPreviewBody(request, 16_000), ["projectId"]);
    if (typeof body.projectId !== "string") throw invalid();
    return Response.json({ project: await dependencies.store().createProject({ ownerId, projectId: body.projectId }) }, { status: 201, headers: aiHeaders });
  });

  const PATCH = (request: Request) => execute(request, "write", async ownerId => {
    const body = bodyObject(await readPreviewBody(request, 4_100_000), ["projectId", "expectedRevisionId", "idempotencyKey", "patch"]);
    if (typeof body.projectId !== "string" || typeof body.expectedRevisionId !== "string" || typeof body.idempotencyKey !== "string") throw invalid();
    const patch = bodyObject(body.patch, ["title", "requirements", "files", "dependencies", "architecture", "removeRequirementIds"]) as ProjectPatch;
    return Response.json({ project: await dependencies.store().applyProjectPatch({ ownerId, projectId: body.projectId,
      expectedRevisionId: body.expectedRevisionId, idempotencyKey: body.idempotencyKey, patch }) }, { headers: aiHeaders });
  });

  return { GET, POST, PATCH };
}
