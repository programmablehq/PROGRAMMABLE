import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleFoundationBuilder } from "@/components/module-foundation-builder";
import { FoundationStudio } from "@/components/module-studio/studio";
import type { FoundationAvailability, FoundationModuleDescriptor } from "@/lib/module-foundation/ui-types";

const actions = { onUploadImage: vi.fn(), onPrepareLaunch: vi.fn(), onConfirmLaunch: vi.fn() };
const quote = { address: "0x1111111111111111111111111111111111111111" as const, chainId: 4663, symbol: "ETH", name: "Ether", decimals: 18, supported: true, supportsNativeEth: true };
const descriptor: FoundationModuleDescriptor = { id: "wallet-cap-fixture", version: "1.0.0", digest: `0x${"11".repeat(32)}`, name: "Initial wallet buy limit", description: "Limits purchases during the selected time.", capabilities: ["beforeSwap"], fields: [], available: true };
const render = (availability: FoundationAvailability, catalog: FoundationModuleDescriptor[] = []) => renderToStaticMarkup(<ModuleFoundationBuilder
  layout="studio" contextKey="studio-test" availability={availability} catalog={catalog} quoteAssets={[quote]} onResolveQuote={vi.fn()} {...actions} />);

describe("Module Studio interface", () => {
  it("opens the invalid module and marks malformed input instead of selecting the first valid module", () => {
    const invalid = { ...descriptor, id: "invalid", name: "Reference module", fields: [
      { key: "pool", label: "Reference pool", kind: "address" as const, required: true },
    ] };
    const html = renderToStaticMarkup(<FoundationStudio
      draft={{ name: "Coin", symbol: "COIN", description: "", image: null, socialLinks: {}, quoteAsset: "", creatorFeeBps: 0,
        initialBuy: "0", additionalLiquidity: "0", modules: [
          { id: descriptor.id, version: descriptor.version, digest: descriptor.digest, configuration: {} },
          { id: invalid.id, version: invalid.version, digest: invalid.digest, configuration: { pool: "bad-address" } },
        ] }} catalog={[descriptor, invalid]} quoteSymbol="ETH" initialBuy="0" actionLabel="Launch coin"
      errors={{ modules: "Enter a valid address for Reference pool." }} customQuote={false} canResolveQuote={false}
      onUpdate={vi.fn()} onChooseImage={vi.fn()} onRemoveImage={vi.fn()} onQuoteChange={vi.fn()}
      onDefaultQuote={vi.fn()} onEnableQuote={vi.fn()} onSubmit={vi.fn()} />);
    expect(html).toContain("<h2>Reference module</h2>");
    expect(html).toMatch(/id="foundation-module-invalid-pool"[^>]*aria-invalid="true"/);
    expect(html).toContain("Back to coin details");
    expect(html).toContain("Remove Reference module");
  });
  it("distinguishes loading, failed loading and an empty verified catalog", () => {
    const availability = { chainId: 4663, chainName: "Robinhood Chain" };
    expect(render({ ...availability, status: "checking" })).toContain("Loading modules…");
    const checking = render({ ...availability, status: "checking" }, [descriptor]);
    expect(checking).toContain('aria-label="Any Quote Pool"');
    expect(checking).toContain('aria-label="Initial wallet buy limit"');
    // A recent catalog may be shown while fresh authority is loading, but it cannot launch.
    expect(checking).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(render({ ...availability, status: "checking" })).not.toContain('aria-label="Any Quote Pool"');
    const ready = render({ ...availability, status: "ready" }, [descriptor]);
    expect(ready).toContain('aria-label="Any Quote Pool"');
    expect(ready).toContain('aria-label="Initial wallet buy limit"');
    const unavailable = render({ ...availability, status: "unavailable", reason: "The module service is unavailable." });
    expect(unavailable).toContain("Modules could not load.");
    expect(unavailable).not.toContain("Loading modules…");
    expect(render({ ...availability, status: "ready" })).toContain("No modules available");
  });

  it("keeps financial inputs visible and groups optional metadata in one disclosure", () => {
    const html = render({ status: "ready", chainId: 4663, chainName: "Robinhood Chain" });
    for (const id of ["foundation-name", "foundation-symbol", "foundation-initial-buy", "foundation-creator-fee-inline", "foundation-description", "foundation-social-twitter", "foundation-social-telegram"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toMatch(/<h2>Coin details<\/h2>/);
    expect(html).not.toMatch(/<button[^>]*>Coin details<\/button>/);
    expect(html).not.toContain('aria-label="Selected settings"');
    expect(html).toContain('aria-label="Edit coin details"');
    expect(html).toContain('draggable="false"');
    expect(html).not.toContain('id="foundation-social-github"');
    expect(html).not.toContain('id="foundation-social-discord"');
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Description &amp; links/);
    expect(html).toMatch(/inert="" aria-hidden="true"[^>]*><div><div[^>]*><div[^>]*><label[^>]*for="foundation-description"/);
    expect(actions.onPrepareLaunch).not.toHaveBeenCalled();
    expect(actions.onConfirmLaunch).not.toHaveBeenCalled();
  });

  it.each(["description", "social-website"])("reveals an invalid optional field: %s", key => {
    const html = renderToStaticMarkup(<FoundationStudio
      draft={{ name: "Coin", symbol: "COIN", description: "", image: null, socialLinks: {}, quoteAsset: "", creatorFeeBps: 0,
        initialBuy: "0.001", additionalLiquidity: "0", modules: [] }} catalog={[]} quoteSymbol="ETH" initialBuy="0.001" actionLabel="Launch coin"
      errors={{ [key]: "Check this field" }} customQuote={false} canResolveQuote={false}
      onUpdate={vi.fn()} onChooseImage={vi.fn()} onRemoveImage={vi.fn()} onQuoteChange={vi.fn()}
      onDefaultQuote={vi.fn()} onEnableQuote={vi.fn()} onSubmit={vi.fn()} />);
    expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*>Description &amp; links/);
    expect(html).toContain('aria-invalid="true"');
  });

  it("adds the quote module to the map only when the creator selects a custom pairing", () => {
    const availability = { status: "ready" as const, chainId: 4663, chainName: "Robinhood Chain" };
    const native = render(availability);
    expect(native).not.toContain('data-node-id="quote"');
    expect(native).not.toContain('aria-label="Edit Any Quote Pool"');
    expect(native).toContain("$COIN / ETH");
    const custom = renderToStaticMarkup(<ModuleFoundationBuilder layout="studio" contextKey="studio-test" availability={availability}
      catalog={[]} quoteAssets={[quote]} onResolveQuote={vi.fn()} {...actions}
      initialDraft={{ quoteAsset: "0x2222222222222222222222222222222222222222" }} />);
    expect(custom).toContain('data-node-id="quote"');
    expect(custom).toContain('aria-label="Edit Any Quote Pool"');
    expect(custom).toContain("$COIN / TOKEN");
  });
});
