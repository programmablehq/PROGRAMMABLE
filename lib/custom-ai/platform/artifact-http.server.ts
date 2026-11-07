import "server-only";
import { aiHeaders } from "../http.server";
import { ProjectError } from "./types";
import { executeProjectRequest, type ProjectAccountDependencies } from "./http.server";
import { DEFAULT_ARTIFACT_LIMITS, type createArtifactStore } from "./artifacts.server";

type Dependencies = ProjectAccountDependencies & { store: () => ReturnType<typeof createArtifactStore>; maxBodyBytes?: number };
export function createArtifactRoutes(dependencies: Dependencies) {
  const maximum = dependencies.maxBodyBytes ?? DEFAULT_ARTIFACT_LIMITS.maxArtifactBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > DEFAULT_ARTIFACT_LIMITS.maxArtifactBytes) throw new TypeError("Invalid artifact upload limit");
  const query = (request: Request, keys: string[]) => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !keys.includes(key)) || !params.get("projectId")) throw new ProjectError("project-input", "Choose a project.");
    return params;
  };
  const POST = (request: Request) => executeProjectRequest(dependencies, request, "write", async ownerId => {
    const params = query(request, ["projectId"]);
    if (!request.body) throw new ProjectError("project-input", "Choose an artifact to upload.");
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new ProjectError("project-artifact-size", "This artifact exceeds the file limit.", 413); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const artifact = await dependencies.store().saveArtifact({ ownerId, projectId: params.get("projectId")! }, {
      bytes, mediaType: (request.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim(),
    });
    return Response.json({ artifact }, { status: 201, headers: aiHeaders });
  });
  const GET = (request: Request) => executeProjectRequest(dependencies, request, "read", async ownerId => {
    const params = query(request, ["projectId", "artifactId"]), id = params.get("artifactId");
    if (!id) throw new ProjectError("project-input", "Choose an artifact.");
    const artifact = await dependencies.store().readArtifact({ ownerId, projectId: params.get("projectId")! }, id);
    return new Response(new Uint8Array(artifact.bytes), { headers: { ...aiHeaders, "Content-Type": artifact.mediaType,
      "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": `attachment; filename="artifact-${artifact.id.slice(7, 19)}"` } });
  });
  return { POST, GET };
}
