import {productionAccountDependencies} from "@/lib/custom-ai/platform/production.server";
import {productionRepositoryImporter,productionRepositoryDelivery} from "@/lib/custom-ai/platform/repository-production.server";
import {createRepositoryRoutes} from "@/lib/custom-ai/platform/repository-http.server";
export const runtime="nodejs";
export const maxDuration=800;
const routes=()=>createRepositoryRoutes({...productionAccountDependencies(),importer:productionRepositoryImporter,delivery:productionRepositoryDelivery});
export const GET=(request:Request)=>routes().GET(request);
export const POST=(request:Request)=>routes().POST(request);
