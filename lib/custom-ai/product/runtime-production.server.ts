import "server-only";
import {createCustomAIBackendLaunchBridge} from "../backend-launch.server";
import {createProductionDependencyRpcs} from "../dependency-rpc.server";
import {productionAIStore} from "../store.server";
import {createProductRuntimeReader} from "./runtime-service.server";

export const readProductionProductRuntime = createProductRuntimeReader({
  store: productionAIStore,
  rpcs: createProductionDependencyRpcs({productRuntime: true}),
  bridge: () => createCustomAIBackendLaunchBridge({
    backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL!,
    websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN!,
    assertionKey: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_BFF_ASSERTION_KEY_V2!,
    fetchBackend: fetch,
  }),
});
