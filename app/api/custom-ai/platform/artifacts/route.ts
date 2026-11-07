import { productionArtifactRoutes } from "@/lib/custom-ai/platform/production.server";
export const runtime = "nodejs";
const routes = productionArtifactRoutes();
export const POST = routes.POST;
export const GET = routes.GET;
