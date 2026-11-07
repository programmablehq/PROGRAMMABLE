import { authorizeCustomAI, requireFreshCustomAIAuthority } from "@/lib/custom-ai/auth.server";
import { productionAIPool, productionAIStore } from "@/lib/custom-ai/store.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { createPlatformStore } from "@/lib/custom-ai/platform/project-store.server";
import { createProjectRoutes } from "@/lib/custom-ai/platform/http.server";

export const runtime = "nodejs";
let store: ReturnType<typeof createPlatformStore> | undefined;
const routes = createProjectRoutes({
  enabled: () => process.env.CUSTOM_AI_PLATFORM_ENABLED === "true",
  authorize: async (request, writing) => {
    const authority = await authorizeCustomAI(request, false, true);
    if (authority.kind !== "account") throw new CustomAIError("auth", "Sign in to open a project.", 401);
    if (writing) requireFreshCustomAIAuthority(request, authority);
    return { ownerId: authority.owner };
  },
  store: () => store ??= createPlatformStore(productionAIPool()),
  consume: (ownerId, operation) => productionAIStore().consume(ownerId, `platform-project-${operation}`, operation === "read" ? 120 : 30),
});

export const GET = routes.GET;
export const POST = routes.POST;
export const PATCH = routes.PATCH;
