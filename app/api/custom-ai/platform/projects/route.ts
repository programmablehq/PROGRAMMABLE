import { productionProjectRoutes } from "@/lib/custom-ai/platform/production.server";

export const runtime = "nodejs";
const routes = productionProjectRoutes();

export const GET = routes.GET;
export const POST = routes.POST;
export const PATCH = routes.PATCH;
