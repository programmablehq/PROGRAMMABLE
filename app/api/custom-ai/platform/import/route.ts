import {productionProjectAuthority} from "@/lib/custom-ai/platform/production.server";
import {projectPlatformRollout} from "@/lib/custom-ai/platform/rollout.server";
import { productionAIPool, productionAIStore } from "@/lib/custom-ai/store.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { createPlatformStore } from "@/lib/custom-ai/platform/project-store.server";
import { createLegacyProjectImporter } from "@/lib/custom-ai/platform/legacy-adapter.server";
import { ProjectError } from "@/lib/custom-ai/platform/types";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (projectPlatformRollout() === null) throw new CustomAIError("unavailable", "Project workspaces are not enabled here yet.", 404);
    const authority = await productionProjectAuthority(request,true);
    await productionAIStore().consume(authority.owner, "platform-project-import", 20);
    const body = await readPreviewBody(request, 16_000);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => !["projectId", "requestId", "account", "conversationId"].includes(key))) throw new CustomAIError("project-input", "Choose a saved contract from your chat.");
    const value = body as Record<string, unknown>;
    if (["projectId", "requestId", "account", "conversationId"].some(key => typeof value[key] !== "string")) throw new CustomAIError("project-input", "Choose a saved contract from your chat.");
    const pool = productionAIPool();
    const project = await createLegacyProjectImporter(pool, createPlatformStore(pool)).importProject({
      ownerId: authority.owner, projectId: value.projectId as string, requestId: value.requestId as string,
      account: value.account as string, conversationId: value.conversationId as string, linkedWallets: authority.principal.wallets,
    });
    return Response.json({ project }, { status: 201, headers: aiHeaders });
  } catch (error) {
    return aiError(error instanceof ProjectError ? new CustomAIError(error.code, error.message, error.status) : error);
  }
}
