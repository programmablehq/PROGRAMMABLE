import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleFoundationBuilder } from "@/components/module-foundation-builder";
import { ModuleFoundationMarket } from "@/components/module-foundation-market";
import { FoundationFeeDisclosure, ModuleFoundationTransactionResult } from "@/components/module-foundation-review";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT, foundationDecimalError, foundationReviewError, foundationSelectionErrors, isFoundationCreatorFee, type FoundationModuleDescriptor, type FoundationModuleSelection } from "@/lib/module-foundation/ui-types";

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
  it("offers a full base coin with no optional modules and no fabricated valuation", () => {
    const html = renderToStaticMarkup(<ModuleFoundationBuilder availability={availability} contextKey="fixture" catalog={[]} quoteAssets={[quote]} {...actions} />);
    for (const label of ["Description", "X / Twitter", "Initial buy", "Starting valuation", "Add creator liquidity", "Review launch"]) expect(html).toContain(label);
    expect(html).toContain('name="startValuationQuote"');
    expect(html).toContain("Enter 0 to launch without an initial buy");
    expect(html).toContain("Your coin works with no additional modules");
    expect(html).not.toContain("5000");
    expect(html).not.toMatch(/Buyback|Rewards|Leverage/);
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
});
