"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatUnits, getAddress, toHex, type Address, type Hex } from "viem";
import { ModuleFoundationBuilder } from "./module-foundation-builder";
import { FoundationSessionStatus, useFoundationSession, type FoundationExecutionResult } from "./module-foundation-session";
import { uploadModuleModeImage } from "./module-mode-wallet-state";
import { bindFoundationCatalogV1 } from "@/lib/module-foundation/catalog";
import { presentFoundationCatalogV1 } from "@/lib/module-foundation/presentation";
import { FOUNDATION_HOST_ADAPTER_ID_V1 } from "@/lib/module-foundation/manifest";
import { parseFoundationAssetPinsV1 } from "@/lib/module-foundation/assets";
import { foundationMetadata, prepareFoundationLaunch, readFoundationQuote } from "@/lib/module-foundation/client";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { FOUNDATION_INFRASTRUCTURE, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import type { FoundationContractModule } from "@/lib/module-foundation/abi";
import { verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { foundationPoolPresentation, foundationPositionPresentation } from "@/lib/module-foundation/ui-readback";
import { foundationStepSummary } from "@/lib/module-foundation/wallet";
import { FOUNDATION_PLATFORM_FEE_BPS, FOUNDATION_PLATFORM_FEE_RECIPIENT, type FoundationImage,
  type FoundationLaunchDraft, type FoundationLaunchReview, type FoundationQuoteAsset, type FoundationTransactionResult } from "@/lib/module-foundation/ui-types";

export function ModuleFoundationLaunchHost() {
  const router = useRouter(), session = useFoundationSession();
  const [quoteState, setQuoteState] = useState<{ context: string; assets: FoundationQuoteAsset[] }>({ context: "", assets: [] });
  const quotes = quoteState.context === session.contextKey ? quoteState.assets : [];
  const uploads = useRef(new Map<string, Hex>());
  const prepared = useRef(new WeakMap<FoundationLaunchReview, Awaited<ReturnType<typeof prepareFoundationLaunch>>>());
  const catalog = useMemo(() => session.envelope ? presentFoundationCatalogV1({
    catalog: bindFoundationCatalogV1(session.envelope.catalog.document, session.envelope.catalog.authority),
    chainId: 4663, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1,
  }) : [], [session.envelope]);

  useEffect(() => {
    let active = true;
    // A convenience choice from the existing chain asset registry; all displayed metadata is read fresh.
    void readFoundationQuote(session.client, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", session.account).then(quote => {
      if (!active) return;
      const asset: FoundationQuoteAsset = { address: quote.address, chainId: 4663, name: quote.name, symbol: quote.symbol,
        decimals: quote.decimals, supported: true, ...(quote.balance === null ? {} : { balance: formatUnits(quote.balance, quote.decimals) }) };
      setQuoteState(current => ({ context: session.contextKey, assets: [asset, ...(current.context === session.contextKey ? current.assets.filter(item => item.address !== asset.address) : [])] }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session.client, session.account, session.contextKey]);

  async function resolveQuote(address: Address): Promise<FoundationQuoteAsset> {
    const expectedContext = session.contextKey;
    const quote = await readFoundationQuote(session.client, getAddress(address), session.account);
    if (session.account) session.assertCurrent(session.account, expectedContext);
    const asset: FoundationQuoteAsset = { address: quote.address, chainId: 4663, name: quote.name, symbol: quote.symbol,
      decimals: quote.decimals, supported: true, ...(quote.balance === null ? {} : { balance: formatUnits(quote.balance, quote.decimals) }) };
    setQuoteState(current => ({ context: expectedContext, assets: [...(current.context === expectedContext ? current.assets.filter(item => item.address !== asset.address) : []), asset] }));
    return asset;
  }
  async function prepare(draft: FoundationLaunchDraft): Promise<FoundationLaunchReview> {
    const account = session.account;
    if (!account) throw new Error("Connect your wallet to prepare the launch.");
    const context = session.contextKey; session.assertCurrent(account, context);
    if (uploads.current.get(`${account.toLowerCase()}:${draft.image.url}`) !== draft.image.sha256) throw new Error("Choose and upload the exact coin image for this wallet before preparing.");
    const binding = await session.resolveAuthority();
    const tokenSalt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const response = await fetch("/api/module-foundation/compose", { method: "POST", credentials: "same-origin", redirect: "error",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, releaseDigest: binding.releaseDigest, tokenSalt, draft }) });
    const composition = await response.json() as { error?: string; releaseDigest: Hex; token: Address; modules: FoundationContractModule[];
      moduleAssetPins: unknown; metadata: unknown };
    if (!response.ok || composition.error || composition.releaseDigest !== binding.releaseDigest) throw new Error(composition.error ?? "The module composition changed. Review again.");
    const moduleAssetPins = parseFoundationAssetPinsV1(composition.moduleAssetPins);
    const metadata = foundationMetadata({ ...draft, imageURI: draft.image.url,
      modulePackageIds: draft.modules.map(item => item.id as Hex), moduleAssetPins });
    if (nativeCanonicalJson(nativeJson(composition.metadata)) !== nativeCanonicalJson(metadata)) throw new Error("The coin metadata changed. Review again.");
    session.assertCurrent(account, context);
    const sequence = await prepareFoundationLaunch({ client: session.client, binding, account, tokenSalt,
      metadata, quote: draft.quoteAsset,
      startValuationQuote: draft.startValuationQuote, initialBuy: draft.initialBuy, additionalLiquidity: draft.additionalLiquidity,
      creatorFeeBps: draft.creatorFeeBps, modules: composition.modules, slippageBps: 100 });
    session.assertCurrent(account, context);
    if (getAddress(composition.token) !== getAddress(sequence.result.token)) throw new Error("The source-bound coin address changed. Review again.");
    const quote: FoundationQuoteAsset = { address: sequence.quote.address, chainId: 4663, name: sequence.quote.name,
      symbol: sequence.quote.symbol, decimals: sequence.quote.decimals, supported: true, balance: formatUnits(sequence.quote.balance ?? 0n, sequence.quote.decimals) };
    const review: FoundationLaunchReview = { id: crypto.randomUUID(), contextKey: context, account, chainId: 4663,
      simulationBlock: sequence.checkpoint.blockNumber.toString(), expiresAt: Number(sequence.expiresAt), quote,
      tokenAddress: sequence.result.token, metadataHash: sequence.metadataHash,
      pool: { ...sequence.poolKey, poolId: sequence.result.poolId, poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address },
      positions: [{ label: "Permanent launch liquidity", positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address,
        tokenId: sequence.result.basePositionId.toString(), owner: sequence.result.baseVault,
        tickLower: sequence.price.base.tickLower, tickUpper: sequence.price.base.tickUpper,
        ownershipDescription: "The base position is held by an immutable vault. Its principal cannot be removed or its NFT transferred." },
      ...(sequence.price.creator ? [{ label: "Additional creator liquidity", positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address,
        tokenId: sequence.result.creatorPositionId.toString(), owner: account,
        tickLower: sequence.price.creator.tickLower, tickUpper: sequence.price.creator.tickUpper,
        ownershipDescription: "This separate NFT belongs to your wallet. You can withdraw or transfer it through the official PositionManager." }] : [])],
      platformFeeBps: FOUNDATION_PLATFORM_FEE_BPS, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT,
      creatorFeeBps: draft.creatorFeeBps, initialBuy: draft.initialBuy,
      minimumInitialTokens: formatUnits(sequence.parameters.initialBuyMinimumTokenAmount, 18),
      additionalLiquidity: formatUnits(sequence.price.creator?.principal ?? 0n, quote.decimals), supply: formatUnits(FOUNDATION_SUPPLY, 18),
      actualStartValuationQuote: formatUnits(sequence.price.actualValuationQuote.numerator / sequence.price.actualValuationQuote.denominator, quote.decimals),
      transactions: sequence.steps.map(foundationStepSummary), notes: ["The initial buy is optional. No creator quote is required for the permanent base position.",
        "The starting valuation is denominated in the selected quote token. It is rounded to the pool's supported tick."] };
    prepared.current.set(review, sequence); return review;
  }
  async function resultFrom(outcome: FoundationExecutionResult): Promise<FoundationTransactionResult> {
    if (!outcome.receipt || outcome.receipt.status !== "success" || outcome.sequence.kind !== "launch"
      || outcome.sequence.steps[outcome.stepIndex].kind !== "launch") return outcome.result;
    const sequence = outcome.sequence;
    try {
      const verified = await verifyFoundationLaunchReceipt({ client: session.client, binding: sequence.binding, transactionHash: outcome.result.transactionHash,
        expected: { transaction: sequence.steps[outcome.stepIndex].transaction, parameters: sequence.parameters, result: sequence.result, metadataHash: sequence.metadataHash } });
      return { ...outcome.result, tokenUrl: `/modules/${verified.details.token.address}?transaction=${outcome.result.transactionHash}`, metadataStatus: "stored", verificationStatus: "verified", operationComplete: true,
        pool: foundationPoolPresentation(verified.details), positions: foundationPositionPresentation(verified.details),
        message: "The coin metadata, launch pool and liquidity positions were verified in the confirmed transaction." };
    } catch {
      return { ...outcome.result, operationComplete: true, verificationStatus: "pending", metadataStatus: "pending",
        message: "The launch transaction is confirmed. Its coin and position details need another readback. Keep this transaction; do not launch it again." };
    }
  }
  async function upload(input: { image: { kind: "local"; sha256: Hex; mimeType: "image/webp"; bytes: number }; blob: Blob }): Promise<FoundationImage> {
    const account = session.account; if (!account) throw new Error("Connect your wallet to upload the coin image.");
    const context = session.contextKey;
    const result = await uploadModuleModeImage({ ...input, getAccessToken: session.walletContext.getAccessToken,
      assertCurrentSession: () => session.assertCurrent(account, context) });
    if (result.sourceSha256 !== input.image.sha256) throw new Error("The stored image does not match the selected file.");
    uploads.current.set(`${account.toLowerCase()}:${result.uri}`, input.image.sha256);
    return { url: result.uri, sha256: input.image.sha256 };
  }
  return <><FoundationSessionStatus session={session} /><ModuleFoundationBuilder key={session.resultGeneration} availability={session.availability} contextKey={session.contextKey}
    catalog={catalog} quoteAssets={quotes} onResolveQuote={resolveQuote} onUploadImage={upload}
    onPrepareLaunch={prepare} onConfirmLaunch={async review => { const sequence = prepared.current.get(review);
      if (!sequence) throw new Error("Prepare this launch again with your current wallet."); session.assertCurrent(sequence.account, review.contextKey);
      return resultFrom(await session.execute(sequence)); }} onRefreshResult={async result => resultFrom(await session.refreshResult(result))}
    walletAction={session.walletAction} submissionBlocked={session.submissionBlocked} onBack={() => router.push("/launch")} onRetryAvailability={session.retryAvailability} /></>;
}
