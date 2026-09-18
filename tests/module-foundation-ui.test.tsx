import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleFoundationBuilder } from "@/components/module-foundation-builder";
import { ModuleFoundationMarket } from "@/components/module-foundation-market";
import { FoundationFeeDisclosure, ModuleFoundationLaunchReview, ModuleFoundationTransactionResult } from "@/components/module-foundation-review";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT, foundationDecimalError, foundationReviewError, foundationSelectionErrors, isFoundationCreatorFee, type FoundationLaunchReview, type FoundationModuleDescriptor, type FoundationModuleSelection } from "@/lib/module-foundation/ui-types";
import { FOUNDATION_DEAD_ADDRESS, FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";

const address = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"11".repeat(32)}` as const;
const quote = { address, chainId: 4663, symbol: "Q", name: "Quote fixture", decimals: 6, supported: true };
const availability = { status: "ready" as const, chainId: 4663, chainName: "Robinhood Chain" };
const actions = { onUploadImage: vi.fn(), onPrepareLaunch: vi.fn(), onConfirmLaunch: vi.fn() };
const descriptor: FoundationModuleDescriptor = { id: "technical.fixture.counter", version: "1.0.0", digest: hash, name: "Counter fixture", description: "Technical conformance fixture.", capabilities: ["afterSwap.observe"], fields: [{ key: "recipient", label: "Recipient", kind: "address", required: true }], available: true };
const selected: FoundationModuleSelection = { id: descriptor.id, version: descriptor.version, digest: descriptor.digest, configuration: { recipient: address } };

describe("Module foundation UI financial and lifecycle boundaries", () => {
  it("preserves quote units and rejects rounded or invalid decimal entry", () => {
    expect(foundationDecimalError("0", 6)).toBeNull();
    expect(foundationDecimalError("0", 6, false)).toContain("greater than zero");
    expect(foundationDecimalError("1.000001", 6)).toBeNull();
    expect(foundationDecimalError("1.0000001", 6)).toContain("6 decimal places");
    for (const invalid of ["1e6", "-1", "1,2", "Infinity", "", "1."]) expect(foundationDecimalError(invalid, 18)).not.toBeNull();
    expect(foundationDecimalError("123456789012345678901234567890.123456789012345678", 18)).toBeNull();
  });
  it("keeps 30 bps additive even at zero creator fee and refuses changed fee recipient or stale review", () => {
    for (const value of [0, 100, 999, 1_000]) expect(isFoundationCreatorFee(value)).toBe(true);
    for (const value of [-1, 1, 30, 99, 1_001, 100.5]) expect(isFoundationCreatorFee(value)).toBe(false);
    const review = { contextKey: "wallet:release", expiresAt: 200, platformFeeBps: 30 as const, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT };
    expect(foundationReviewError(review, "wallet:release", 100_000)).toBeNull();
    expect(foundationReviewError(review, "other:release", 100_000)).toContain("changed");
    expect(foundationReviewError(review, "wallet:release", 200_000)).toContain("expired");
    expect(foundationReviewError({ ...review, platformFeeRecipient: address as typeof FOUNDATION_PLATFORM_FEE_RECIPIENT }, "wallet:release", 100_000)).toContain("fee");
    const html = renderToStaticMarkup(<FoundationFeeDisclosure creatorFeeBps={0} quoteSymbol="Q" />);
    expect(html).toContain(FOUNDATION_PLATFORM_FEE_RECIPIENT);
    expect(html).toContain("0.3%");
    expect(html).toContain("Uniswap LP and protocol fees are separate");
  });
  it("validates descriptor binding, requirements and conflicts without business module enums", () => {
    expect(foundationSelectionErrors([], [])).toEqual([]);
    expect(foundationSelectionErrors([selected], [descriptor])).toEqual([]);
    expect(foundationSelectionErrors([{ ...selected, digest: `0x${"22".repeat(32)}` }], [descriptor])[0]).toContain("changed");
    expect(foundationSelectionErrors([selected], [{ ...descriptor, requires: ["other.module"] }])[0]).toContain("requires");
    expect(foundationSelectionErrors([selected], [{ ...descriptor, conflictsWith: [descriptor.id] }])[0]).toContain("cannot be combined");
    expect(foundationSelectionErrors([{ ...selected, configuration: { recipient: "bad-address" } }], [descriptor])[0]).toContain("valid address");
  });
  it("offers a base coin without an editable starting valuation", () => {
    const html = renderToStaticMarkup(<ModuleFoundationBuilder availability={availability} contextKey="fixture" catalog={[]} quoteAssets={[quote]} {...actions} />);
    for (const label of ["Description", "X / Twitter", "Initial buy", "Review launch"]) expect(html).toContain(label);
    expect(html).not.toContain('name="startValuationQuote"');
    expect(html).not.toContain("Starting valuation");
    expect(html).not.toContain("foundation-valuation");
    expect(html).toContain("Enter 0 to launch without an initial buy");
    expect(html).toContain("Your coin works with no additional modules");
    expect(html).not.toContain("5000");
    expect(html).not.toMatch(/Buyback|Rewards|Leverage/);
  });
  it("removes creator liquidity even when an old draft supplied it", () => {
    const html = renderToStaticMarkup(<ModuleFoundationBuilder availability={availability} factoryVersion="v2" contextKey="fixture" catalog={[]} quoteAssets={[{ ...quote, supportsNativeEth: true }]} initialDraft={{ additionalLiquidity: "2" }} {...actions} />);
    expect(html).not.toContain("Add creator liquidity");
    expect(html).not.toContain('name="additionalLiquidity"');
    expect(html).toContain("ETH · Ethereum");
    expect(html).toContain("existing WETH is used first");
    expect(html).toContain("only ETH for network fees");
  });
  it("shows exact V2 principal, refund and token rounding separately from fee claims before the wallet action", () => {
    const review: FoundationLaunchReview = { factoryVersion: "v2", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID,
      id: "fixture", contextKey: "fixture", account: address, chainId: 4663, simulationBlock: "100",
      expiresAt: Math.floor(Date.now() / 1000) + 300, quote, tokenAddress: address, metadataHash: hash,
      pool: { poolId: hash, currency0: address, currency1: address, fee: 0, tickSpacing: 60, hooks: address, poolManager: address },
      positions: [], platformFeeBps: 30, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT, creatorFeeBps: 100,
      initialBuy: "0.125", minimumInitialTokens: "123", additionalLiquidity: "1.999998", supply: "1000000000", actualStartMarketCapUsd: "4998.25",
      quoteFunding: { maximum: "2.125", principal: "1.999998", refund: "0.000002" },
      roundingInventory: { recipient: FOUNDATION_DEAD_ADDRESS, tokenAmount: "0.000000000000000017", unrecoverable: true },
      transactions: [{ label: "Launch coin", to: address, chainId: 4663, value: "0", effect: "Local fixture" }] };
    const render = (value: FoundationLaunchReview) => renderToStaticMarkup(<ModuleFoundationLaunchReview review={value} contextKey="fixture" symbol="UNIT" busy={false} onConfirm={vi.fn()} onEdit={vi.fn()} />);
    const html = render(review);
    expect(html).toContain("Launch liquidity is permanent");
    for (const amount of ["2.125", "1.999998", "0.000002", "0.000000000000000017"]) expect(html).toContain(amount);
    expect(html).toContain(FOUNDATION_DEAD_ADDRESS);
    expect(html).toContain("Creator fees from trading remain separately claimable");
    expect(html).toContain("Later liquidity added by other people has its own ownership");
    expect(html).toContain("total supply stays unchanged");
    expect(html.indexOf("Launch liquidity is permanent")).toBeLessThan(html.indexOf("Continue in wallet"));
    expect(render({ ...review, factoryVersion: "v1", lpCustodyId: undefined, quoteFunding: undefined, roundingInventory: undefined })).not.toContain("Launch liquidity is permanent");
  });
  it("leaves unavailable launch and direct trading unavailable without a source deployment binding", () => {
    const html = renderToStaticMarkup(<ModuleFoundationBuilder availability={{ ...availability, status: "unavailable", reason: "Deployment is not bound." }} contextKey="fixture" catalog={[]} quoteAssets={[quote]} {...actions} />);
    expect(html).toContain("Deployment is not bound.");
    expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain("disabled");
    const market = renderToStaticMarkup(<ModuleFoundationMarket availability={{ ...availability, status: "unavailable" }} contextKey="fixture" coin={{ address, name: "UI fixture", symbol: "UI", description: "Local UI fixture.", decimals: 18 }} quote={quote} pool={{ poolId: hash, currency0: address, currency1: address, fee: 3000, tickSpacing: 60, hooks: address, poolManager: address }} creatorFeeBps={0} onPrepareTrade={vi.fn()} onConfirmTrade={vi.fn()} />);
    expect(market).toContain("Universal Router");
    expect(market.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain("disabled");
  });
  it("does not promote submitted transaction, fee credit or metadata storage into confirmation", () => {
    const submitted = renderToStaticMarkup(<ModuleFoundationTransactionResult result={{ status: "submitted", transactionHash: hash, explorerUrl: "https://explorer.example/tx/fixture", metadataStatus: "stored", tokenUrl: "/coin/fixture" }} />);
    expect(submitted).toContain("Transaction submitted");
    expect(submitted).not.toContain("Transaction confirmed");
    expect(submitted).not.toContain("View coin");
    expect(submitted).toContain("index confirmation pending");
  });
  it("keeps the coin draft editable while an unresolved wallet operation blocks submission", () => {
    const html = renderToStaticMarkup(<ModuleFoundationBuilder availability={availability} contextKey="fixture" catalog={[]} quoteAssets={[quote]} {...actions}
      submissionBlocked="The previous transaction is still awaiting confirmation." initialDraft={{ name: "Next coin", symbol: "NEXT" }} />);
    expect(html.match(/<fieldset[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html).toContain('value="Next coin"');
    expect(html).toContain('value="NEXT"');
    expect(html).toContain("The previous transaction is still awaiting confirmation.");
    expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain("disabled");
    expect(actions.onConfirmLaunch).not.toHaveBeenCalled();
  });
  it("renders host-supplied public metadata and omits unsafe image or social URLs", () => {
    const props = { availability, contextKey: "fixture", quote, pool: { poolId: hash, currency0: address, currency1: address, fee: 3000, tickSpacing: 60, hooks: address, poolManager: address }, creatorFeeBps: 0, onPrepareTrade: vi.fn(), onConfirmTrade: vi.fn() };
    const coin = { address, name: "UI fixture", symbol: "UI", description: "Local UI fixture.", decimals: 18, imageURI: "https://assets.example.com/coin.webp", socialLinks: [{ label: "Website", url: "https://coin.example.com/about" }, { label: "Unsafe script", url: "javascript:alert(1)" }, { label: "Private credential", url: "https://user:secret@coin.example.com" }, { label: "Plain HTTP", url: "http://coin.example.com" }] };
    const html = renderToStaticMarkup(<ModuleFoundationMarket {...props} coin={coin} />);
    expect(html).toContain('src="https://assets.example.com/coin.webp"');
    expect(html).toContain('href="https://coin.example.com/about"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("Website (opens in a new tab)");
    for (const label of ["Unsafe script", "Private credential", "Plain HTTP"]) expect(html).not.toContain(label);
    const unsafeImage = renderToStaticMarkup(<ModuleFoundationMarket {...props} coin={{ ...coin, imageURI: "data:image/svg+xml,unsafe" }} />);
    expect(unsafeImage).not.toContain("data:image");
  });
});
