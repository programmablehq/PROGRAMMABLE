import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleFoundationBuilderProps } from "@/components/module-foundation-builder";
import type { FoundationLaunchDraft } from "@/lib/module-foundation/ui-types";
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import { foundationV2Fixture, v2Now } from "./module-foundation-v2-fixture";

const fixture = vi.hoisted(() => ({ session: {} as Record<string, unknown>, builder: null as ModuleFoundationBuilderProps | null,
  push: vi.fn(), prepare: vi.fn(), verify: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fixture.push }) }));
vi.mock("@/components/module-foundation-session", () => ({ useFoundationSession: () => fixture.session, FoundationSessionStatus: () => null }));
vi.mock("@/components/module-foundation-builder", () => ({ ModuleFoundationBuilder: (props: ModuleFoundationBuilderProps) => { fixture.builder = props; return null; } }));
vi.mock("@/components/module-mode-wallet-state", () => ({ uploadModuleModeImage: vi.fn() }));
vi.mock("@/lib/module-foundation/client", async original => ({ ...await original<typeof import("@/lib/module-foundation/client")>(), prepareFoundationLaunch: fixture.prepare }));
vi.mock("@/lib/module-foundation/readback", () => ({ verifyFoundationLaunchReceipt: fixture.verify }));
vi.mock("@/lib/module-foundation/ui-readback", () => ({ foundationLaunchPositionPresentation: () => [], foundationPoolPresentation: () => ({}), foundationPositionPresentation: () => [] }));
import { ModuleFoundationLaunchHost } from "@/components/module-foundation-launch-host";
import { foundationMetadata } from "@/lib/module-foundation/client";

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(v2Now); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function prepareHost() {
  const f = foundationV2Fixture(false, true);
  const draft: FoundationLaunchDraft = { name: "Navigation", symbol: "NAV", description: "", image: FOUNDATION_DEFAULT_IMAGE,
    socialLinks: {}, quoteAsset: f.quote, creatorFeeBps: 100, initialBuy: "0", additionalLiquidity: "0", modules: [] };
  const sequence = { kind: "launch", binding: f.binding, account: f.account, steps: f.steps, checkpoint: f.checkpoint,
    expiresAt: f.parameters.deadline, quote: { address: f.quote, symbol: "WETH", name: "Wrapped Ether", decimals: 18, balance: 0n },
    result: { ...f.result, factoryVersion: "v2" }, parameters: f.parameters, poolKey: f.key, metadataHash: f.metadataHash,
    price: { ...f.price, actualMarketCapUsd: "5000" } };
  fixture.prepare.mockResolvedValue(sequence);
  const outcome = { sequence, stepIndex: 0, receipt: { status: "success" },
    result: { status: "confirmed", chainId: 4663, transactionHash: f.transactionHash, explorerUrl: "https://example.com/tx" } };
  fixture.session = { account: f.account, contextKey: "current", client: {}, walletContext: {}, envelope: null, resultGeneration: 0,
    availability: { status: "ready", chainId: 4663, chainName: "Robinhood Chain" }, assertCurrent: vi.fn(),
    resolveAuthority: vi.fn(async () => f.binding), execute: vi.fn(async () => outcome), refreshResult: vi.fn(async () => outcome) };
  fixture.verify.mockResolvedValue({ details: { token: { address: f.token } } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ releaseDigest: f.binding.releaseDigest, token: f.token, modules: [], moduleAssetPins: [],
    startPrice: { decimals: 18 }, ethFunding: null, metadata: foundationMetadata({ ...draft, imageURI: draft.image.url, modulePackageIds: [], moduleAssetPins: [] }) })));
  renderToStaticMarkup(<ModuleFoundationLaunchHost />);
  const prepared = await fixture.builder!.onPrepareLaunch(draft);
  return { f, prepared: prepared!, outcome };
}

describe("launch completion navigation", () => {
  it("opens the verified coin chart in the current tab after the single execution", async () => {
    const { f, prepared } = await prepareHost();
    expect(fixture.push).not.toHaveBeenCalled();
    const result = await fixture.builder!.onConfirmLaunch(prepared);
    expect(fixture.session.execute).toHaveBeenCalledOnce();
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(`/modules/${f.token}?transaction=${f.transactionHash}`);
    expect(result.verificationStatus).toBe("verified");
  });

  it("keeps a confirmed launch from being submitted again while readback is pending", async () => {
    const { prepared } = await prepareHost();
    fixture.verify.mockRejectedValueOnce(new Error("readback temporarily unavailable"));
    const result = await fixture.builder!.onConfirmLaunch(prepared);
    expect(result.operationComplete).toBe(true);
    expect(result.verificationStatus).toBe("pending");
    expect(fixture.push).not.toHaveBeenCalled();
    await fixture.builder!.onRefreshResult!(result);
    expect(fixture.session.execute).toHaveBeenCalledOnce();
    expect(fixture.push).toHaveBeenCalledOnce();
  });

  it("does not navigate from a reverted transaction", async () => {
    const { prepared, outcome } = await prepareHost();
    outcome.receipt.status = "reverted";
    await fixture.builder!.onConfirmLaunch(prepared);
    expect(fixture.verify).not.toHaveBeenCalled();
    expect(fixture.push).not.toHaveBeenCalled();
  });
});
