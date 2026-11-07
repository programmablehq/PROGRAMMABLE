import { productionWorkerRoutes } from "@/lib/custom-ai/platform/run-production.server";
import { productionProjectAgent } from "@/lib/custom-ai/platform/agent-production.server";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = (request: Request) => productionWorkerRoutes((grant, token, signal) => productionProjectAgent().advance(grant, token, signal)).POST(request);
