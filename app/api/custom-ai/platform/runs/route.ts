import { productionRunRoutes } from "@/lib/custom-ai/platform/run-production.server";
export const runtime = "nodejs";
const routes = productionRunRoutes();
export const GET = routes.GET;
export const POST = routes.POST;
export const DELETE = routes.DELETE;
export const PATCH = routes.PATCH;
