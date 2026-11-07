import { productionProjectRoutes } from "@/lib/custom-ai/platform/production.server";
export const runtime = "nodejs";
export const GET = productionProjectRoutes().DOWNLOAD;
