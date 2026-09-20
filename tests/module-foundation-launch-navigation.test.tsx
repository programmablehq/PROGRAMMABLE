import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toHex, type PublicClient } from "viem";
import type { ModuleFoundationBuilderProps } from "@/components/module-foundation-builder";
import type { FoundationLaunchDraft } from "@/lib/module-foundation/ui-types";
import type { FoundationResolution } from "@/lib/module-foundation/result-store";
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import { foundationV2Fixture, v2Now } from "./module-foundation-v2-fixture";

const fixture = vi.hoisted(() => ({ session: {} as Record<string, unknown>, builder: null as ModuleFoundationBuilderProps | null,
  push: vi.fn(), prepare: vi.fn(), verify: vi.fn(), availability: vi.fn(), discover: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: fixture.push }) }));
vi.mock("@/components/module-foundation-session", () => ({ useFoundationSession: () => fixture.session, FoundationSessionStatus: () => null }));
vi.mock("@/components/module-foundation-builder", () => ({ ModuleFoundationBuilder: (props: ModuleFoundationBuilderProps) => { fixture.builder = props; return null; } }));
vi.mock("@/components/module-mode-wallet-state", () => ({ uploadModuleModeImage: vi.fn() }));
vi.mock("@/lib/module-foundation/client", async original => ({ ...await original<typeof import("@/lib/module-foundation/client")>(), prepareFoundationLaunch: fixture.prepare }));
vi.mock("@/lib/module-foundation/readback", () => ({ verifyFoundationLaunchReceipt: fixture.verify }));
vi.mock("@/lib/module-foundation/availability", () => ({ fetchFoundationAvailability: fixture.availability }));
vi.mock("@/lib/module-foundation/discovery", () => ({ discoverFoundationLaunch: fixture.discover }));
vi.mock("@/lib/module-foundation/ui-readback", () => ({ foundationLaunchPositionPresentation: () => [], foundationPoolPresentation: () => ({}), foundationPositionPresentation: () => [] }));
import { ModuleFoundationLaunchHost, verifiedSavedFoundationLaunchUrl } from "@/components/module-foundation-launch-host";
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
    const setItem = vi.fn();
    vi.stubGlobal("sessionStorage", { setItem });
    const { f, prepared } = await prepareHost();
    expect(fixture.push).not.toHaveBeenCalled();
    expect(fixture.prepare.mock.calls[0][0].metadata.imageURI).toBe(FOUNDATION_DEFAULT_IMAGE.url);
    const compositionRequest = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(compositionRequest.draft.image).toEqual(FOUNDATION_DEFAULT_IMAGE);
    const result = await fixture.builder!.onConfirmLaunch(prepared);
    expect(fixture.session.execute).toHaveBeenCalledOnce();
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith(`/modules/${f.token}?transaction=${f.transactionHash}`);
    expect(setItem).toHaveBeenCalledWith(`programmable:foundation-launch-opened:v1:${f.account.toLowerCase()}`, f.transactionHash.toLowerCase());
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

function savedLaunch() {
  const f = foundationV2Fixture(false, true), transaction = f.steps[0].transaction;
  const saved: FoundationResolution = { schemaVersion: "programmable.foundation.resolution.v1", account: f.account,
    operationId: "11111111-1111-4111-8111-111111111111", releaseDigest: f.binding.releaseDigest,
    calldataHash: keccak256(transaction.data), to: transaction.to, value: toHex(transaction.value), nonce: 1,
    startBlock: f.checkpoint.blockNumber.toString(), createdAt: v2Now, transactionHash: f.transactionHash,
    status: "success", blockNumber: f.checkpoint.blockNumber.toString(), blockHash: f.checkpoint.blockHash,
    resolvedAt: v2Now, metadata: { stepKind: "launch", operationKind: "launch", token: f.token } };
  const discovered = { token: f.token, transactionHash: f.transactionHash, transaction, checkpoint: f.checkpoint };
  fixture.availability.mockResolvedValue({ available: true, binding: f.binding });
  fixture.discover.mockResolvedValue(discovered);
  return { f, saved, discovered, client: {} as PublicClient };
}

describe("restoring a completed launch after reload", () => {
  it("uses the token's retained release and exact canonical creation transaction", async () => {
    const { f, saved, client } = savedLaunch(), controller = new AbortController();
    await expect(verifiedSavedFoundationLaunchUrl(client, saved, controller.signal)).resolves.toBe(`/modules/${f.token}?transaction=${f.transactionHash}`);
    expect(fixture.availability).toHaveBeenCalledExactlyOnceWith(controller.signal, f.token);
    expect(fixture.discover).toHaveBeenCalledExactlyOnceWith({ client, binding: f.binding, token: f.token,
      transactionHash: f.transactionHash, signal: controller.signal });
  });

  it("does not turn an approval or reverted receipt into a completed launch", async () => {
    const { saved, client } = savedLaunch();
    await expect(verifiedSavedFoundationLaunchUrl(client, { ...saved, status: "reverted" })).rejects.toThrow("not a completed");
    await expect(verifiedSavedFoundationLaunchUrl(client, { ...saved, metadata: { ...saved.metadata!, stepKind: "approve" } })).rejects.toThrow("not a completed");
    expect(fixture.discover).not.toHaveBeenCalled();
  });

  it("refuses a different release before reading the candidate launch", async () => {
    const { saved, client } = savedLaunch();
    await expect(verifiedSavedFoundationLaunchUrl(client, { ...saved, releaseDigest: `0x${"99".repeat(32)}` })).rejects.toThrow("release");
    expect(fixture.discover).not.toHaveBeenCalled();
  });

  it("refuses changed sender, calldata, value, token or canonical block evidence", async () => {
    const { saved, discovered, client } = savedLaunch();
    for (const changed of [
      { ...saved, account: "0x1000000000000000000000000000000000000000" as const },
      { ...saved, calldataHash: `0x${"99".repeat(32)}` as const },
      { ...saved, value: toHex(BigInt(saved.value) + 1n) },
      { ...saved, blockNumber: (BigInt(saved.blockNumber) + 1n).toString() },
      { ...saved, blockHash: `0x${"99".repeat(32)}` as const },
    ]) await expect(verifiedSavedFoundationLaunchUrl(client, changed)).rejects.toThrow("does not match");
    fixture.discover.mockResolvedValueOnce({ ...discovered, token: "0x1000000000000000000000000000000000000000" });
    await expect(verifiedSavedFoundationLaunchUrl(client, saved)).rejects.toThrow("does not match");
  });

  it("does not navigate with an aborted or unavailable readback", async () => {
    const { saved, client } = savedLaunch(), controller = new AbortController();
    controller.abort();
    await expect(verifiedSavedFoundationLaunchUrl(client, saved, controller.signal)).rejects.toThrow("does not match");
    fixture.discover.mockRejectedValueOnce(new Error("Canonical receipt unavailable"));
    await expect(verifiedSavedFoundationLaunchUrl(client, saved)).rejects.toThrow("Canonical receipt unavailable");
  });
});
