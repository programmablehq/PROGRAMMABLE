import { productionWorkerRoutes } from "@/lib/custom-ai/platform/run-production.server";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = productionWorkerRoutes().POST;
