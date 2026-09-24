import type { MetadataRoute } from "next";

const SITE_ORIGIN = "https://programmable.market";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/agent"],
      disallow: ["/api/", "/analytics"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
