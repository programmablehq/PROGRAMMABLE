import "server-only";
import { authorizeCustomAI, requireFreshCustomAIAuthority } from "../auth.server";
import { productionAIPool, productionAIStore } from "../store.server";
import { CustomAIError } from "../types";
import { createPlatformStore } from "./project-store.server";
import { createProjectRoutes, type ProjectAccountDependencies } from "./http.server";
import { createArtifactStore } from "./artifacts.server";
import { createArtifactRoutes } from "./artifact-http.server";
import {assertProjectPlatformOwner,projectPlatformRollout} from "./rollout.server";

let store: ReturnType<typeof createPlatformStore> | undefined;
let artifacts: ReturnType<typeof createArtifactStore> | undefined;
export function productionPlatformStore() { return store ??= createPlatformStore(productionAIPool()); }
export function productionPlatformArtifacts() { return artifacts ??= createArtifactStore(productionAIPool()); }
export async function productionProjectAuthority(request:Request,writing:boolean) {
  const authority=await authorizeCustomAI(request,false,true);
  if(authority.kind!=="account")throw new CustomAIError("auth","Sign in to open a project.",401);
  if(writing)requireFreshCustomAIAuthority(request,authority);
  assertProjectPlatformOwner(authority.owner);
  return authority;
}
export function productionAccountDependencies(): ProjectAccountDependencies {
  return {
    enabled: () => projectPlatformRollout() !== null,
    authorize: async (request, writing) => {
      const authority = await productionProjectAuthority(request,writing);
      return { ownerId: authority.owner };
    },
    consume: (ownerId, operation) => productionAIStore().consume(ownerId, `platform-project-${operation}`,
      operation === "write" ? 30 : 120, operation === "progress" ? 60_000 : 3_600_000),
  };
}
export function productionProjectRoutes() {
  return createProjectRoutes({ ...productionAccountDependencies(), store: productionPlatformStore });
}
export function productionArtifactRoutes() {
  return createArtifactRoutes({ ...productionAccountDependencies(), store: productionPlatformArtifacts });
}
