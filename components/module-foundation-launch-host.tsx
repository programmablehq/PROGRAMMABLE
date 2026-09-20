"use client";

import { foundationCreatorFeeFields, foundationCreatorFeeRates } from "@/lib/module-foundation/creator-fees";
import { foundationParseAmount } from "@/lib/module-foundation/price";
import type { FoundationFundingHop } from "@/lib/module-foundation/atomic-launch";

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
import { isFoundationDefaultImage } from "@/lib/module-foundation/default-image";
import { readFoundationSuggestedBuy } from "@/lib/module-foundation/first-buy";
import { FOUNDATION_WETH, foundationSupportsEth } from "@/lib/module-foundation/native-funding";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { FOUNDATION_INFRASTRUCTURE, FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import type { FoundationContractModule } from "@/lib/module-foundation/abi";
import { verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { foundationLaunchPositionPresentation, foundationPoolPresentation, foundationPositionPresentation } from "@/lib/module-foundation/ui-readback";
import { foundationStepSummary } from "@/lib/module-foundation/wallet";
import type { FoundationStartPrice } from "@/lib/module-foundation/start-price";
import { FOUNDATION_PLATFORM_FEE_BPS, FOUNDATION_PLATFORM_FEE_RECIPIENT, type FoundationImage,
  type FoundationLaunchDraft, type FoundationLaunchReview, type FoundationQuoteAsset, type FoundationTransactionResult } from "@/lib/module-foundation/ui-types";

export function ModuleFoundationLaunchHost() {
  const router = useRouter(), session = useFoundationSession();
  const [completedDraft, setCompletedDraft] = useState<string | null>(null);
  const [suggestedInitialBuy, setSuggestedInitialBuy] = useState<string>();
  const draftKey = `${session.contextKey}:${session.resultGeneration}`;
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
    void readFoundationSuggestedBuy(session.client).then(amount => {
      if (active) setSuggestedInitialBuy(amount);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session.client]);

  useEffect(() => {
    let active = true;
    // A convenience choice from the existing chain asset registry; all displayed metadata is read fresh.
    void readFoundationQuote(session.client, FOUNDATION_WETH, session.account).then(quote => {
      if (!active) return;
      const asset: FoundationQuoteAsset = { address: quote.address, chainId: 4663, name: quote.name, symbol: quote.symbol,
        decimals: quote.decimals, supported: true, supportsNativeEth: foundationSupportsEth(quote), ...(quote.balance === null ? {} : { balance: formatUnits(quote.balance, quote.decimals) }) };
      setQuoteState(current => ({ context: session.contextKey, assets: [asset, ...(current.context === session.contextKey ? current.assets.filter(item => item.address !== asset.address) : [])] }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session.client, session.account, session.contextKey]);

  async function resolveQuote(address: Address): Promise<FoundationQuoteAsset> {
    const expectedContext = session.contextKey;
    const quote = await readFoundationQuote(session.client, getAddress(address), session.account);
    if (session.account) session.assertCurrent(session.account, expectedContext);
    const asset: FoundationQuoteAsset = { address: quote.address, chainId: 4663, name: quote.name, symbol: quote.symbol,
      decimals: quote.decimals, supported: true, supportsNativeEth: foundationSupportsEth(quote), ...(quote.balance === null ? {} : { balance: formatUnits(quote.balance, quote.decimals) }) };
    setQuoteState(current => ({ context: expectedContext, assets: [...(current.context === expectedContext ? current.assets.filter(item => item.address !== asset.address) : []), asset] }));
    return asset;
  }
  async function prepare(draft: FoundationLaunchDraft): Promise<FoundationLaunchReview> {
    const account = session.account;
    if (!account) throw new Error("Connect your wallet to prepare the launch.");
    const context = session.contextKey; session.assertCurrent(account, context);
    if (session.preparationBlocked) throw new Error(session.preparationBlocked);
    // Reviewing a new draft acknowledges only the completed result currently shown.
    // Keep the draft mounted; the result store still enforces its exact ID and wallet lock.
    if (session.resolution) {
      await session.acknowledgeResult(session.resolution.operationId, false);
      session.assertCurrent(account, context);
    }
    if (!isFoundationDefaultImage(draft.image) && uploads.current.get(`${account.toLowerCase()}:${draft.image.url}`) !== draft.image.sha256) throw new Error("Choose and upload the exact coin image for this wallet before preparing.");
    const binding = await session.resolveAuthority();
    const creatorFees = foundationCreatorFeeFields(draft);
    const feeRates = foundationCreatorFeeRates(creatorFees);
    if (binding.factoryVersion !== "v3" && feeRates.creatorBuyFeeBps !== feeRates.creatorSellFeeBps) throw new Error("Independent buy and sell fees are not live yet.");
    const tokenSalt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const response = await fetch("/api/module-foundation/compose", { method: "POST", credentials: "same-origin", redirect: "error",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, releaseDigest: binding.releaseDigest, tokenSalt, draft, launchFlow: "single-eth-v1" }) });
    const composition = await response.json() as { error?: string; releaseDigest: Hex; token: Address; modules: FoundationContractModule[];
      moduleAssetPins: unknown; metadata: unknown; startPrice: FoundationStartPrice; ethFunding: { maximumEth: string; quoteAmount: string; path: FoundationFundingHop[] } | null };
    if (!response.ok || composition.error || composition.releaseDigest !== binding.releaseDigest) throw new Error(composition.error ?? "The module composition changed. Review again.");
    const moduleAssetPins = parseFoundationAssetPinsV1(composition.moduleAssetPins);
    const metadata = foundationMetadata({ ...draft, imageURI: draft.image.url,
      modulePackageIds: draft.modules.map(item => item.id as Hex), moduleAssetPins });
    if (nativeCanonicalJson(nativeJson(composition.metadata)) !== nativeCanonicalJson(metadata)) throw new Error("The coin metadata changed. Review again.");
    session.assertCurrent(account, context);
    const maximumEth = foundationParseAmount(draft.initialBuy, 18);
    const ethFunding = composition.ethFunding ? { ...composition.ethFunding, maximumEth: BigInt(composition.ethFunding.maximumEth), quoteAmount: BigInt(composition.ethFunding.quoteAmount) } : undefined;
    if ((maximumEth > 0n) !== Boolean(ethFunding) || (ethFunding && ethFunding.maximumEth !== maximumEth)) throw new Error("The ETH spending amount changed. Create the launch again.");
    const sequence = await prepareFoundationLaunch({ client: session.client, binding, account, tokenSalt,
      metadata, quote: draft.quoteAsset,
      startPrice: composition.startPrice, initialBuy: ethFunding ? formatUnits(ethFunding.quoteAmount, composition.startPrice.decimals) : "0", additionalLiquidity: "0", ethFunding,
      ...creatorFees, modules: composition.modules, slippageBps: 100 });
    session.assertCurrent(account, context);
    if (sequence.steps.length !== 1 || sequence.steps[0].kind !== "launch") throw new Error("This launch could not be prepared as one transaction.");
    if (getAddress(composition.token) !== getAddress(sequence.result.token)) throw new Error("The source-bound coin address changed. Review again.");
    const quote: FoundationQuoteAsset = { address: sequence.quote.address, chainId: 4663, name: sequence.quote.name,
      symbol: sequence.quote.symbol, decimals: sequence.quote.decimals, supported: true, supportsNativeEth: foundationSupportsEth(sequence.quote), balance: formatUnits(sequence.quote.balance ?? 0n, sequence.quote.decimals) };
    const positions = foundationLaunchPositionPresentation(sequence, account);
    const custody = (() => {
      if (sequence.result.factoryVersion === "v1") return { factoryVersion: "v1" as const };
      if (binding.factoryVersion !== sequence.result.factoryVersion) throw new Error("The launch liquidity version changed. Review again.");
      return { factoryVersion: sequence.result.factoryVersion, lpCustodyId: binding.lpCustodyId,
        roundingInventory: { recipient: sequence.result.roundingInventoryRecipient,
          tokenAmount: formatUnits(sequence.result.baseTokenRounding, 18), unrecoverable: true as const },
        quoteFunding: { maximum: formatUnits(sequence.parameters.initialBuyQuoteAmount + sequence.parameters.additionalQuoteAmount, quote.decimals),
          principal: formatUnits(sequence.result.creatorQuotePrincipal, quote.decimals),
          refund: formatUnits(sequence.result.actualQuoteRefund, quote.decimals) } };
    })();
    const review: FoundationLaunchReview = { id: crypto.randomUUID(), contextKey: context, account, chainId: 4663,
      simulationBlock: sequence.checkpoint.blockNumber.toString(), expiresAt: Number(sequence.expiresAt), quote,
      tokenAddress: sequence.result.token, metadataHash: sequence.metadataHash,
      pool: { ...sequence.poolKey, poolId: sequence.result.poolId, poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address },
      positions, ...custody,
      platformFeeBps: FOUNDATION_PLATFORM_FEE_BPS, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT,
      ...foundationCreatorFeeFields(sequence.parameters), initialBuy: draft.initialBuy,
      minimumInitialTokens: formatUnits(sequence.parameters.initialBuyMinimumTokenAmount, 18),
      additionalLiquidity: formatUnits(sequence.result.factoryVersion !== "v1" ? sequence.result.creatorQuotePrincipal : sequence.price.creator?.principal ?? 0n, quote.decimals), supply: formatUnits(FOUNDATION_SUPPLY, 18),
      actualStartMarketCapUsd: sequence.price.actualMarketCapUsd,
      transactions: sequence.steps.map(foundationStepSummary), notes: ["The coin launch and first buy use one transaction.",
        "The starting market cap is set automatically to approximately $5,000. This is a valuation, not a deposit."] };
    prepared.current.set(review, sequence); return review;
  }
  async function resultFrom(outcome: FoundationExecutionResult): Promise<FoundationTransactionResult> {
    if (!outcome.receipt || outcome.receipt.status !== "success" || outcome.sequence.kind !== "launch"
      || outcome.sequence.steps[outcome.stepIndex].kind !== "launch") return outcome.result;
    const sequence = outcome.sequence;
    try {
      const verified = await verifyFoundationLaunchReceipt({ client: session.client, binding: sequence.binding, transactionHash: outcome.result.transactionHash,
        expected: { transaction: sequence.steps[outcome.stepIndex].transaction, parameters: sequence.parameters, result: sequence.result, metadataHash: sequence.metadataHash } });
      const tokenUrl = `/modules/${verified.details.token.address}?transaction=${outcome.result.transactionHash}`;
      router.push(tokenUrl);
      return { ...outcome.result, tokenUrl, metadataStatus: "stored", verificationStatus: "verified", operationComplete: true,
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
  return <><FoundationSessionStatus session={session} editingNewLaunch={completedDraft !== draftKey} /><ModuleFoundationBuilder key={session.resultGeneration} availability={session.availability} contextKey={session.contextKey}
    factoryVersion={session.envelope?.binding ? session.envelope.binding.factoryVersion ?? "v1" : undefined}
    catalog={catalog} quoteAssets={quotes} suggestedInitialBuy={suggestedInitialBuy} onResolveQuote={resolveQuote} onUploadImage={upload}
    onPrepareLaunch={prepare} onConfirmLaunch={async review => { const sequence = prepared.current.get(review);
      if (!sequence) throw new Error("Prepare this launch again with your current wallet."); session.assertCurrent(sequence.account, review.contextKey);
      const outcome = await session.execute(sequence); setCompletedDraft(draftKey);
      return resultFrom(outcome); }} onRefreshResult={async result => resultFrom(await session.refreshResult(result))}
    walletAction={session.walletAction} submissionBlocked={session.preparationBlocked} onBack={() => router.push("/launch")} onRetryAvailability={session.retryAvailability} /></>;
}
