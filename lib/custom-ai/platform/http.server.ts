import "server-only";
import { readPreviewBody } from "../access.server";
import { aiError, aiHeaders } from "../http.server";
import { CustomAIError } from "../types";
import type { createPlatformStore } from "./project-store.server";
import { ProjectError, type ProjectPatch } from "./types";
import { exportProjectBundle } from "./transfer";

export type ProjectAccountDependencies = {
  enabled: () => boolean;
  authorize: (request: Request, writing: boolean) => Promise<{ ownerId: string }>;
  consume: (ownerId: string, operation: "read" | "write" | "progress") => Promise<unknown>;
};
type Dependencies = ProjectAccountDependencies & { store: () => ReturnType<typeof createPlatformStore> };
const invalid = () => new CustomAIError("project-input", "Choose a valid project and revision.");
function bodyObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}

export async function executeProjectRequest(dependencies: ProjectAccountDependencies, request: Request, operation: "read" | "write" | "progress", run: (ownerId: string) => Promise<Response>) {
  try {
    if (!dependencies.enabled()) throw new CustomAIError("unavailable", "Project workspaces are not enabled here yet.", 404);
    const { ownerId } = await dependencies.authorize(request, operation === "write");
    await dependencies.consume(ownerId, operation);
    return await run(ownerId);
  } catch (error) {
    return aiError(error instanceof ProjectError ? new CustomAIError(error.code, error.message, error.status) : error);
  }
}

export function createProjectRoutes(dependencies: Dependencies) {
  const execute = (request: Request, operation: "read" | "write", run: (ownerId: string) => Promise<Response>) => executeProjectRequest(dependencies, request, operation, run);

  const GET = (request: Request) => execute(request, "read", async ownerId => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["projectId", "revisionId", "limit", "history"].includes(key))) throw invalid();
    const projectId = query.get("projectId"), revisionId = query.get("revisionId");
    const store = dependencies.store();
    if (query.has("history")) {
      if (query.get("history") !== "true" || !projectId || revisionId) throw invalid();
      return Response.json({ revisions: await store.listRevisionSummaries({ ownerId, projectId }, Number(query.get("limit") ?? 50)) }, { headers: aiHeaders });
    }
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
    const patch = bodyObject(body.patch, ["title", "requirements", "files", "dependencies", "architecture", "removeRequirementIds", "removeFilePaths", "fileChanges"]) as ProjectPatch;
    return Response.json({ project: await dependencies.store().applyProjectPatch({ ownerId, projectId: body.projectId,
      expectedRevisionId: body.expectedRevisionId, idempotencyKey: body.idempotencyKey, patch }) }, { headers: aiHeaders });
  });

  const DOWNLOAD = (request: Request) => execute(request, "read", async ownerId => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["projectId", "revisionId"].includes(key))) throw invalid();
    const projectId = query.get("projectId"), revisionId = query.get("revisionId");
    if (!projectId || !revisionId) throw invalid();
    const project = await dependencies.store().readRevision({ ownerId, projectId }, revisionId);
    return Response.json(exportProjectBundle(project), { headers: { ...aiHeaders, "Content-Disposition": `attachment; filename="project-${project.projectId}.json"` } });
  });

  const RESTORE = (request: Request) => execute(request, "write", async ownerId => {
    const body = bodyObject(await readPreviewBody(request, 16_000), ["projectId", "revisionId", "expectedRevisionId", "idempotencyKey"]);
    if (["projectId", "revisionId", "expectedRevisionId", "idempotencyKey"].some(key => typeof body[key] !== "string")) throw invalid();
    const project = await dependencies.store().restoreProjectRevision({ ownerId, projectId: body.projectId as string,
      revisionId: body.revisionId as string, expectedRevisionId: body.expectedRevisionId as string, idempotencyKey: body.idempotencyKey as string });
    return Response.json({ project }, { headers: aiHeaders });
  });

  return { GET, POST, PATCH, DOWNLOAD, RESTORE };
}
