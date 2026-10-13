"use client";
import { foundationPlatformFeeBps } from "@/lib/module-foundation/constants";
import ethereum from "@/contracts/spec/module-foundation/chain-1.v1.json";

import { foundationBindingChainId, foundationChainProfile, type FoundationChainId } from "@/lib/module-foundation/chains";

import { foundationCreatorFeeFields, foundationCreatorFeeRates } from "@/lib/module-foundation/creator-fees";
import { foundationParseAmount } from "@/lib/module-foundation/price";
import type { FoundationFundingHop } from "@/lib/module-foundation/atomic-launch";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatUnits, getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { ModuleFoundationBuilder } from "./module-foundation-builder";
import { useFoundationLaunchBalance } from "./use-foundation-launch-balance";
import { FoundationSessionStatus, useFoundationSession, type FoundationExecutionResult } from "./module-foundation-session";
import { uploadModuleModeImage } from "./module-mode-wallet-state";
import { bindFoundationCatalogV1 } from "@/lib/module-foundation/catalog";
import { presentFoundationLaunchCatalogV1 } from "@/lib/module-foundation/launch-availability";
import { FOUNDATION_HOST_ADAPTER_ID_V1 } from "@/lib/module-foundation/manifest";
import { parseFoundationAssetPinsV1 } from "@/lib/module-foundation/assets";
import { createFoundationClient, foundationMetadata, prepareFoundationLaunch } from "@/lib/module-foundation/client";
import { readFoundationQuoteForDisplay, readFoundationFirstBuyPolicyForDisplay } from "@/lib/module-foundation/launch-display-cache";
import { isFoundationDefaultImage } from "@/lib/module-foundation/default-image";
import { FoundationPreparationUnavailableError, retryFoundationReadOnlyPreparation } from "@/lib/module-foundation/preparation-retry";
import { foundationSupportsEth } from "@/lib/module-foundation/native-funding";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { FOUNDATION_SUPPLY } from "@/lib/module-foundation/constants";
import type { FoundationContractModule } from "@/lib/module-foundation/abi";
import { verifyFoundationLaunchReceipt } from "@/lib/module-foundation/readback";
import { fetchFoundationAvailability, FoundationProviderDisagreementError } from "@/lib/module-foundation/availability";
import { discoverFoundationLaunch } from "@/lib/module-foundation/discovery";
import type { FoundationResolution } from "@/lib/module-foundation/result-store";
import { foundationLaunchPositionPresentation, foundationPoolPresentation, foundationPositionPresentation } from "@/lib/module-foundation/ui-readback";
import { foundationStepSummary } from "@/lib/module-foundation/wallet";
import { isFoundationQuotePrice, type FoundationStartPrice } from "@/lib/module-foundation/start-price";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT, foundationSelectionErrors, type FoundationImage,
  type FoundationLaunchDraft, type FoundationLaunchReview, type FoundationQuoteAsset, type FoundationTransactionResult } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";
import studioStyles from "./module-studio/studio.module.css";
import { StudioAtmosphere } from "./module-studio/studio-atmosphere";
import { ChainMark } from "./chain-mark";
import { clearFoundationLaunchDraft } from "@/lib/module-foundation/launch-draft";

/** A saved result is only a locator; recover its exact launch from current authority and canonical chain evidence. */
export async function verifiedSavedFoundationLaunchUrl(client: PublicClient, saved: FoundationResolution, signal?: AbortSignal) {
  if (saved.status !== "success" || saved.metadata?.stepKind !== "launch" || saved.metadata.operationKind !== "launch" || !saved.metadata.token) {
    throw new Error("This result is not a completed coin launch.");
  }
  const token = getAddress(saved.metadata.token);
  const chainId = foundationBindingChainId(saved);
  const authority = await (chainId === 4663 ? fetchFoundationAvailability(signal, token) : fetchFoundationAvailability(signal, token, chainId));
  if (!authority.available || !authority.binding || authority.binding.releaseDigest.toLowerCase() !== saved.releaseDigest.toLowerCase()
    || getAddress(authority.binding.ethereumGraph ? ethereum.canonicalStamp.router.address : authority.binding.factory.address) !== getAddress(saved.to)) throw new Error("The saved launch release could not be verified.");
  const found = await discoverFoundationLaunch({ client, binding: authority.binding, token, transactionHash: saved.transactionHash, signal });
  if (signal?.aborted || getAddress(found.token) !== token || found.transactionHash.toLowerCase() !== saved.transactionHash.toLowerCase()
    || getAddress(found.transaction.from) !== getAddress(saved.account) || getAddress(found.transaction.to) !== getAddress(saved.to)
    || keccak256(found.transaction.data).toLowerCase() !== saved.calldataHash.toLowerCase() || found.transaction.value !== BigInt(saved.value)
    || found.checkpoint.blockNumber !== BigInt(saved.blockNumber) || found.checkpoint.blockHash.toLowerCase() !== saved.blockHash.toLowerCase()) {
    throw new Error("The saved result does not match this coin's launch.");
  }
  return `/modules/${token}?${chainId === 1 ? "chainId=1&" : ""}transaction=${found.transactionHash}`;
}

export function ModuleFoundationLaunchHost({ layout = "form", chainId = 4663 }: { layout?: "form" | "studio"; chainId?: FoundationChainId } = {}) {
  const profile = foundationChainProfile(chainId), FOUNDATION_INFRASTRUCTURE = profile.infrastructure, FOUNDATION_WETH = profile.wrappedEth.address;
  const router = useRouter(), session = useFoundationSession(undefined, chainId);
  const launchBalance = useFoundationLaunchBalance(session.client, session.account, profile.name);
  const [changingNetwork, startNetworkChange] = useTransition();
  // Presentation metadata can share one HTTP batch; preparation uses the session's fresh client.
  const displayClient = useMemo(() => createFoundationClient({ batchRpc: true, chainId }), [chainId]);
  const [completedDraft, setCompletedDraft] = useState<string | null>(null);
  const [suggestedInitialBuy, setSuggestedInitialBuy] = useState<string>();
  const [minimumInitialBuy, setMinimumInitialBuy] = useState<string>();
  const suggestedBuyRequest = useRef<Promise<string> | null>(null);
  const draftKey = `${session.contextKey}:${session.resultGeneration}`;
  const [quoteState, setQuoteState] = useState<{ context: string; assets: FoundationQuoteAsset[] }>({ context: "", assets: [] });
  const quotes = quoteState.context === session.contextKey ? quoteState.assets : [];
  const uploads = useRef(new Map<string, Hex>());
  const prepared = useRef(new WeakMap<FoundationLaunchReview, Awaited<ReturnType<typeof prepareFoundationLaunch>>>());
  const acknowledged = useRef(new WeakSet<FoundationLaunchReview>());
  const launching = useRef(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [savedLaunchError, setSavedLaunchError] = useState<string | null>(null);
  const [openingSavedLaunch, setOpeningSavedLaunch] = useState(false);
  const recoveryRequest = useRef<AbortController | null>(null);
  const displayEnvelope = session.envelope ?? session.displayEnvelope;
  const catalog = useMemo(() => displayEnvelope ? presentFoundationLaunchCatalogV1({
    catalog: bindFoundationCatalogV1(displayEnvelope.catalog.document, displayEnvelope.catalog.authority),
    chainId, hostAdapterId: FOUNDATION_HOST_ADAPTER_ID_V1,
  }) : [], [displayEnvelope, chainId]);

  useEffect(() => () => {
    recoveryRequest.current?.abort();
    recoveryRequest.current = null;
  }, [session.account, session.resolution?.operationId]);

  async function openSavedLaunch() {
    const saved = session.resolution;
    if (recoveryRequest.current || launching.current || session.progress || session.pending !== "null" || !session.account || !saved
      || saved.status !== "success" || saved.metadata?.stepKind !== "launch" || !saved.metadata.token
      || getAddress(saved.account) !== getAddress(session.account)) return;
    const controller = new AbortController();
    recoveryRequest.current = controller;
    setOpeningSavedLaunch(true);
    setSavedLaunchError(null);
    try {
      const url = await verifiedSavedFoundationLaunchUrl(session.client, saved, controller.signal);
      if (!controller.signal.aborted && !launching.current) router.push(url);
    } catch {
      if (!controller.signal.aborted) setSavedLaunchError(saved.operationId);
    } finally {
      if (recoveryRequest.current === controller) recoveryRequest.current = null;
      setOpeningSavedLaunch(false);
    }
  }

  const resolveSuggestedInitialBuy = useCallback(() => {
    if (!suggestedBuyRequest.current) suggestedBuyRequest.current = readFoundationFirstBuyPolicyForDisplay(session.client)
      .then(policy => { setSuggestedInitialBuy(policy.suggestedEth); setMinimumInitialBuy(policy.minimumEth); return policy.suggestedEth; })
      .catch(error => { suggestedBuyRequest.current = null; throw error; });
    return suggestedBuyRequest.current;
  }, [session.client]);

  useEffect(() => { void resolveSuggestedInitialBuy().catch(() => undefined); }, [resolveSuggestedInitialBuy]);

  useEffect(() => {
    let active = true;
    // Metadata is display-only and shared across wallet changes. Preparation rereads the exact quote and balance.
    void readFoundationQuoteForDisplay(displayClient, FOUNDATION_WETH).then(quote => {
      if (!active) return;
      const asset: FoundationQuoteAsset = { address: quote.address, chainId, name: quote.name, symbol: quote.symbol,
        decimals: quote.decimals, supported: true, supportsNativeEth: foundationSupportsEth(quote, chainId), ...(quote.balance === null ? {} : { balance: formatUnits(quote.balance, quote.decimals) }) };
      setQuoteState(current => ({ context: session.contextKey, assets: [asset, ...(current.context === session.contextKey ? current.assets.filter(item => item.address !== asset.address) : [])] }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [displayClient, session.contextKey, FOUNDATION_WETH, chainId]);

  async function resolveQuote(address: Address): Promise<FoundationQuoteAsset> {
    const expectedContext = session.contextKey;
    const quote = await readFoundationQuoteForDisplay(displayClient, getAddress(address));
    if (session.account) session.assertCurrent(session.account, expectedContext);
    const asset: FoundationQuoteAsset = { address: quote.address, chainId, name: quote.name, symbol: quote.symbol,
      decimals: quote.decimals, supported: true, supportsNativeEth: foundationSupportsEth(quote, chainId), ...(quote.balance === null ? {} : { balance: formatUnits(quote.balance, quote.decimals) }) };
    // The builder owns custom lookups and discards results from an older wallet context.
    return asset;
  }
  async function prepare(draft: FoundationLaunchDraft, signal?: AbortSignal): Promise<FoundationLaunchReview> {
    const account = session.account;
    if (!account) throw new Error("Connect your wallet to prepare the launch.");
    const context = session.contextKey;
    const assertCurrent = () => { signal?.throwIfAborted(); session.assertCurrent(account, context); };
    assertCurrent();
    if (session.preparationBlocked) throw new Error(session.preparationBlocked);
    await launchBalance.check(draft.initialBuy);
    assertCurrent();
    const moduleErrors = foundationSelectionErrors(draft.modules, catalog);
    if (moduleErrors.length) throw new Error(moduleErrors.join(" "));
    // Reviewing a new draft acknowledges only the completed result currently shown.
    // Keep the draft mounted; the result store still enforces its exact ID and wallet lock.
    const previousResult = session.resolution;
    const acknowledgedResult = Boolean(previousResult && !signal);
    if (previousResult && !signal) {
      await session.acknowledgeResult(previousResult.operationId, false);
      session.assertCurrent(account, context);
    }
    if (!isFoundationDefaultImage(draft.image) && uploads.current.get(`${account.toLowerCase()}:${draft.image.url}`) !== draft.image.sha256) throw new Error("Choose and upload the exact coin image for this wallet before preparing.");
    return retryFoundationReadOnlyPreparation(async () => {
      assertCurrent();
      const binding = await session.resolveAuthority();
      assertCurrent();
      const creatorFees = foundationCreatorFeeFields(draft);
      const feeRates = foundationCreatorFeeRates(creatorFees);
      if (binding.factoryVersion !== "v3" && feeRates.creatorBuyFeeBps !== feeRates.creatorSellFeeBps) throw new Error("Independent buy and sell fees are not live yet.");
      const tokenSalt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const response = await fetch("/api/module-foundation/compose", { method: "POST", credentials: "same-origin", redirect: "error",
        signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, releaseDigest: binding.releaseDigest, tokenSalt, draft, launchFlow: "single-eth-v1", chainId }) });
      // Gateways can return HTML for a timeout or rate limit. Preserve its retry semantics
      // instead of turning it into an opaque JSON parsing error.
      if ([408, 429].includes(response.status) || (response.status >= 500 && (response.status !== 503
        || !response.headers.get("content-type")?.includes("application/json")))) throw new FoundationPreparationUnavailableError();
      const composition = await response.json() as { error?: string; code?: string; retryable?: boolean; releaseDigest: Hex; token: Address; modules: FoundationContractModule[];
        moduleAssetPins: unknown; metadata: unknown; startPrice: FoundationStartPrice; ethFunding: { maximumEth: string; quoteAmount: string; path: FoundationFundingHop[] } | null };
      if (response.status === 503 && composition.code === "MODULE_INDEX_PROVIDER_DISAGREEMENT") throw new FoundationProviderDisagreementError();
      if (response.status === 503 && composition.retryable === true) throw new FoundationPreparationUnavailableError();
      if (!response.ok || composition.error || composition.releaseDigest !== binding.releaseDigest) throw new Error(composition.error ?? "The module composition changed. Review again.");
      const quotePriced = isFoundationQuotePrice(composition.startPrice);
      if (quotePriced !== (draft.quoteValuation !== undefined)
        || (isFoundationQuotePrice(composition.startPrice) && composition.startPrice.valuationQuoteRaw !== foundationParseAmount(draft.quoteValuation!, composition.startPrice.decimals, false).toString())) {
        throw new Error("The starting value changed. Review your coin settings again.");
      }
      const moduleAssetPins = parseFoundationAssetPinsV1(composition.moduleAssetPins);
      const metadata = foundationMetadata({ ...draft, imageURI: draft.image.url,
        modulePackageIds: draft.modules.map(item => item.id as Hex), moduleAssetPins });
      if (nativeCanonicalJson(nativeJson(composition.metadata)) !== nativeCanonicalJson(metadata)) throw new Error("The coin metadata changed. Review again.");
      assertCurrent();
      const maximumEth = foundationParseAmount(draft.initialBuy, 18);
      const ethFunding = composition.ethFunding ? { ...composition.ethFunding, maximumEth: BigInt(composition.ethFunding.maximumEth), quoteAmount: BigInt(composition.ethFunding.quoteAmount) } : undefined;
      if ((maximumEth > 0n) !== Boolean(ethFunding) || (ethFunding && ethFunding.maximumEth !== maximumEth)) throw new Error("The ETH spending amount changed. Create the launch again.");
      const sequence = await prepareFoundationLaunch({ client: session.client, binding, account, tokenSalt,
        metadata, quote: draft.quoteAsset, accessToken: session.walletContext.getAccessToken,
        startPrice: composition.startPrice, initialBuy: ethFunding ? formatUnits(ethFunding.quoteAmount, composition.startPrice.decimals) : "0", additionalLiquidity: "0", ethFunding,
        ...creatorFees, modules: composition.modules, slippageBps: 100, signal });
      assertCurrent();
      if (sequence.steps.length !== 1 || sequence.steps[0].kind !== "launch") throw new Error("This launch could not be prepared as one transaction.");
      if (getAddress(composition.token) !== getAddress(sequence.result.token)) throw new Error("The source-bound coin address changed. Review again.");
      const quote: FoundationQuoteAsset = { address: sequence.quote.address, chainId, name: sequence.quote.name,
        symbol: sequence.quote.symbol, decimals: sequence.quote.decimals, supported: true, supportsNativeEth: foundationSupportsEth(sequence.quote, chainId), balance: formatUnits(sequence.quote.balance ?? 0n, sequence.quote.decimals) };
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
      const review: FoundationLaunchReview = { id: crypto.randomUUID(), contextKey: context, account, chainId,
        simulationBlock: sequence.checkpoint.blockNumber.toString(), expiresAt: Number(sequence.expiresAt), quote,
        tokenAddress: sequence.result.token, metadataHash: sequence.metadataHash,
        pool: { ...sequence.poolKey, poolId: sequence.result.poolId, poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address },
        positions, ...custody,
        platformFeeBps: foundationPlatformFeeBps(binding), platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT,
        ...foundationCreatorFeeFields(sequence.parameters), initialBuy: draft.initialBuy,
        minimumInitialTokens: formatUnits(sequence.parameters.initialBuyMinimumTokenAmount, 18),
        additionalLiquidity: formatUnits(sequence.result.factoryVersion !== "v1" ? sequence.result.creatorQuotePrincipal : sequence.price.creator?.principal ?? 0n, quote.decimals), supply: formatUnits(FOUNDATION_SUPPLY, 18),
        actualStartMarketCapUsd: sequence.price.actualMarketCapUsd,
        actualStartMarketCapQuote: sequence.price.actualMarketCapQuote,
        transactions: sequence.steps.map(step => foundationStepSummary(step, chainId)), notes: ["The coin launch and first buy use one transaction.",
          draft.quoteValuation !== undefined ? "You set the starting valuation in quote tokens. No dollar value is assumed."
            : "The starting market cap is set automatically to approximately $5,000. This is a valuation, not a deposit."] };
      prepared.current.set(review, sequence);
      if (acknowledgedResult) acknowledged.current.add(review);
      return review;
    }, assertCurrent);
  }
  async function resultFrom(outcome: FoundationExecutionResult): Promise<FoundationTransactionResult> {
    if (!outcome.receipt || outcome.receipt.status !== "success" || outcome.sequence.kind !== "launch"
      || outcome.sequence.steps[outcome.stepIndex].kind !== "launch") return outcome.result;
    const sequence = outcome.sequence;
    clearFoundationLaunchDraft(chainId);
    try {
      const verified = await verifyFoundationLaunchReceipt({ client: session.client, binding: sequence.binding, transactionHash: outcome.result.transactionHash,
        expected: { transaction: sequence.steps[outcome.stepIndex].transaction, parameters: sequence.parameters, result: sequence.result, metadataHash: sequence.metadataHash } });
      const tokenUrl = `/modules/${verified.details.token.address}?${chainId === 1 ? "chainId=1&" : ""}transaction=${outcome.result.transactionHash}`;
      router.push(tokenUrl);
      return { ...outcome.result, tokenUrl, metadataStatus: "stored", verificationStatus: "verified", operationComplete: true,
        pool: foundationPoolPresentation(verified.details), positions: foundationPositionPresentation(verified.details),
        message: "Your coin is ready." };
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
  const previousLaunchAction = session.resolution?.status === "success" && session.resolution.metadata?.stepKind === "launch" && session.resolution.metadata.token
    && session.pending === "null" && !session.progress && completedDraft !== draftKey ? <>
      <button type="button" className={styles.secondaryButton} disabled={openingSavedLaunch} onClick={() => void openSavedLaunch()}>
        {openingSavedLaunch ? "Opening your previous coin…" : "Open your previous coin"}
      </button>
      {savedLaunchError === session.resolution.operationId ? <p role="alert">Your previous launch could not be checked yet. Try opening it again.</p> : null}
    </> : null;
  const inlineRecovery = layout === "studio" && session.pending !== "null";
  const sessionStatus = <FoundationSessionStatus key={`${session.account}:${chainId}`} session={session} inline={inlineRecovery} editingNewLaunch={completedDraft !== draftKey} showProgress={false} hideSuccessfulLaunch />;
  return <div className={layout === "studio" ? studioStyles.launchPage : undefined}>{layout === "studio" ? <StudioAtmosphere /> : null}{inlineRecovery ? null : sessionStatus}
    {layout !== "studio" && previousLaunchAction ? <div className={`${styles.page} ${styles.sessionStatus}`}>{previousLaunchAction}</div> : null}
    <ModuleFoundationBuilder key={`${chainId}:${session.resultGeneration}`} persistDraft layout={layout} networkControl={
      <fieldset className={styles.networkChoice} disabled={Boolean(session.progress) || launchBusy || changingNetwork} aria-busy={changingNetwork}>
        <legend className="sr-only">Launch network</legend>
        {([{ id: 4663, name: "Robinhood" }, { id: 1, name: "Ethereum" }] as const).map(network =>
          <label key={network.id}>
            <input type="radio" name="launch-network" value={network.id} checked={chainId === network.id}
              onChange={() => startNetworkChange(() => router.push(`/launch/modules/foundation?chainId=${network.id}`, { scroll: false }))} />
            <span><span aria-hidden="true"><ChainMark chainId={network.id} /></span>{network.name}</span>
          </label>)}
      </fieldset>
    } recoveryAction={inlineRecovery ? sessionStatus : undefined} previousLaunchAction={previousLaunchAction} availability={session.availability} contextKey={session.contextKey}
    platformFeeBps={foundationPlatformFeeBps(session.envelope?.binding ?? {})}
    factoryVersion={session.envelope?.binding ? session.envelope.binding.factoryVersion ?? "v1" : undefined}
    catalog={catalog} quoteAssets={quotes} nativeBalance={launchBalance.balance} onCheckFunding={launchBalance.check} suggestedInitialBuy={suggestedInitialBuy} minimumInitialBuy={minimumInitialBuy} onResolveSuggestedInitialBuy={resolveSuggestedInitialBuy} launchProgress={session.progress} onResolveQuote={resolveQuote} onUploadImage={upload}
    onWarmLaunch={session.account && !session.preparationBlocked ? (draft, signal) => prepare(draft, signal) : undefined}
    onPrepareLaunch={prepare} onConfirmLaunch={async review => { const sequence = prepared.current.get(review);
      if (!sequence) throw new Error("Prepare this launch again with your current wallet."); session.assertCurrent(sequence.account, review.contextKey);
      launching.current = true; setLaunchBusy(true);
      try {
        // Background preparation preserves the previous result. Only this explicit launch click acknowledges it.
        if (session.resolution && !acknowledged.current.has(review)) {
          await session.acknowledgeResult(session.resolution.operationId, false);
          session.assertCurrent(sequence.account, review.contextKey);
        }
        const outcome = await session.execute(sequence); setCompletedDraft(draftKey); return await resultFrom(outcome);
      }
      finally { launching.current = false; setLaunchBusy(false); } }} onRefreshResult={async result => resultFrom(await session.refreshResult(result))}
    walletAction={session.walletAction} submissionBlocked={session.preparationBlocked} onBack={() => router.push(layout === "studio" ? "/launch" : "/")} onRetryAvailability={session.retryAvailability} /></div>;
}
