import {productionAccountDependencies} from "@/lib/custom-ai/platform/production.server";
import {productionAppReleases} from "@/lib/custom-ai/platform/runtime-production.server";
import {createReleaseRoutes} from "@/lib/custom-ai/platform/runtime-http.server";
export const runtime="nodejs";
export const maxDuration=800;
export const GET=(request:Request)=>createReleaseRoutes({...productionAccountDependencies(),releases:productionAppReleases}).GET(request);
export const POST=(request:Request)=>createReleaseRoutes({...productionAccountDependencies(),releases:productionAppReleases}).POST(request);
