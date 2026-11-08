import {createAppRuntimeRoutes} from "@/lib/custom-ai/platform/runtime-http.server";
import {productionRuntimeData} from "@/lib/custom-ai/platform/runtime-production.server";
import {productionConnectionService} from "@/lib/custom-ai/platform/connection-production.server";
export const runtime="nodejs";
export const POST=(request:Request)=>createAppRuntimeRoutes({enabled:()=>process.env.CUSTOM_AI_PLATFORM_ENABLED==="true",data:productionRuntimeData,connections:productionConnectionService}).DATA(request);
