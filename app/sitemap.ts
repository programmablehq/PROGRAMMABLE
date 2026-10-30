import type { MetadataRoute } from "next";
import { DOCUMENTATION } from "@/lib/documentation";

const SITE_ORIGIN = "https://programmable.market";

const PUBLIC_ROUTES = [
  "",
  "/explore",
  "/launch",
  "/launch/custom-ai",
  "/launch/modules",
  "/developers/hooks",
  "/developers/api-keys",
  "/agents.md",
  "/llms.txt",
  "/llms-full.txt",
  "/privacy",
  ...Object.values(DOCUMENTATION),
  "/profile",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_ORIGIN}${route}`,
  }));
}
