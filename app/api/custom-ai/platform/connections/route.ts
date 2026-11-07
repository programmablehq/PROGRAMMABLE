import {productionConnectionRoutes} from "@/lib/custom-ai/platform/connection-production.server";
export const runtime="nodejs";
export const maxDuration=120;
export const GET=(request:Request)=>productionConnectionRoutes().GET(request);
export const POST=(request:Request)=>productionConnectionRoutes().POST(request);
export const DELETE=(request:Request)=>productionConnectionRoutes().DELETE(request);
