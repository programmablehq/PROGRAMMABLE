import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { docsNavigation, docsSearchItems } from "../components/docs-data";
import sitemap from "../app/sitemap";
import nextConfig from "../next.config";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("retired prediction product documentation", () => {
  it("removes prediction routes from navigation, search and discovery", () => {
    const navigationEntries = docsNavigation.flatMap((group) => group.items);
    const sitemapUrls = sitemap().map((entry) => entry.url);

    expect(navigationEntries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/docs/tokens/prediction-markets" }),
      ]),
    );
    expect(docsSearchItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: "/docs/tokens/prediction-markets" }),
      ]),
    );
    expect(sitemapUrls).not.toContain(
      "https://programmable.market/docs/tokens/prediction-markets",
    );
    expect(sitemapUrls).not.toContain("https://programmable.market/markets");
  });

  it("redirects stale documentation links to the launch model overview", async () => {
    expect(await nextConfig.redirects?.()).toEqual(
      expect.arrayContaining([
        {
          destination: "/docs",
          permanent: false,
          source: "/docs/models/prediction-markets",
        },
        {
          destination: "/docs",
          permanent: false,
          source: "/docs/tokens/prediction-markets",
        },
      ]),
    );
  });

  it("removes the retired product from public repository and GitBook copy", () => {
    for (const path of [
      "README.md",
      "docs/public/README.md",
      "docs/public/SUMMARY.md",
      "docs/public/tokens.md",
      "docs/public/economics.md",
      "docs/public/infrastructure.md",
      "docs/public/creators/README.md",
      "docs/public/reference/official-links.md",
    ]) {
      expect(read(path)).not.toMatch(/prediction markets?/iu);
    }
  });
});
