import "server-only";
import { authorizeCustomAI, requireFreshCustomAIAuthority } from "../auth.server";
import { productionAIPool, productionAIStore } from "../store.server";
import { CustomAIError } from "../types";
import { createPlatformStore } from "./project-store.server";
import { createProjectRoutes, type ProjectAccountDependencies } from "./http.server";
import { createArtifactStore } from "./artifacts.server";
import { createArtifactRoutes } from "./artifact-http.server";

let store: ReturnType<typeof createPlatformStore> | undefined;
let artifacts: ReturnType<typeof createArtifactStore> | undefined;
export function productionAccountDependencies(): ProjectAccountDependencies {
  return {
    enabled: () => process.env.CUSTOM_AI_PLATFORM_ENABLED === "true",
    authorize: async (request, writing) => {
      const authority = await authorizeCustomAI(request, false, true);
      if (authority.kind !== "account") throw new CustomAIError("auth", "Sign in to open a project.", 401);
      if (writing) requireFreshCustomAIAuthority(request, authority);
      return { ownerId: authority.owner };
    },
    consume: (ownerId, operation) => productionAIStore().consume(ownerId, `platform-project-${operation}`, operation === "read" ? 120 : 30),
  };
}
export function productionProjectRoutes() {
  return createProjectRoutes({ ...productionAccountDependencies(), store: () => store ??= createPlatformStore(productionAIPool()) });
}
export function productionArtifactRoutes() {
  return createArtifactRoutes({ ...productionAccountDependencies(), store: () => artifacts ??= createArtifactStore(productionAIPool()) });
}
