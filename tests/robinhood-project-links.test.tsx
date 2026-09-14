import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RobinhoodProjectLinks } from "@/components/robinhood-project-links";
import { MODULE_TOKEN_FALLBACK_IMAGE, RobinhoodCoinArtwork } from "@/components/robinhood-coin-artwork";

describe("Coin metadata presentation", () => {
  it("renders remaining socials as named external links and omits GitHub", () => {
    const links = ["Website", "X", "Telegram", "Discord", "GitHub", "GitBook"].map(label => ({ label, url: `https://example.com/${label.toLowerCase()}` }));
    const html = renderToStaticMarkup(<RobinhoodProjectLinks links={links} name="Coin" />);
    expect(html).toContain('aria-label="Coin links"');
    expect(html.match(/<a /g)).toHaveLength(5);
    for (const link of links) {
      if (link.label === "GitHub") {
        expect(html).not.toContain(`href="${link.url}"`);
        continue;
      }
      expect(html).toContain(`aria-label="${link.label} (opens in a new tab)"`);
      expect(html).toContain(`href="${link.url}"`);
    }
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(5);
    expect(renderToStaticMarkup(<RobinhoodProjectLinks links={[{ label: "Website", url: "https://github.com/example/project" }]} name="Coin" />)).toBe("");
    expect(renderToStaticMarkup(<RobinhoodProjectLinks links={[]} name="Coin" />)).toBe("");
  });

  it("uses the supplied fallback only for missing or invalid artwork", () => {
    expect(renderToStaticMarkup(<RobinhoodCoinArtwork fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />)).toContain(`src="${MODULE_TOKEN_FALLBACK_IMAGE}"`);
    expect(renderToStaticMarkup(<RobinhoodCoinArtwork imageUrl="javascript:bad" fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />)).toContain(`src="${MODULE_TOKEN_FALLBACK_IMAGE}"`);
    const chosen = "https://example.com/chosen.png";
    const custom = renderToStaticMarkup(<RobinhoodCoinArtwork imageUrl={chosen} fallbackImageUrl={MODULE_TOKEN_FALLBACK_IMAGE} />);
    expect(custom).toContain(`src="${chosen}"`);
    expect(custom).not.toContain(`src="${MODULE_TOKEN_FALLBACK_IMAGE}"`);
    expect(renderToStaticMarkup(<RobinhoodCoinArtwork />)).not.toContain("<img");
  });
});
