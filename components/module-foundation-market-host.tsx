"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { decodeEventLog, formatUnits, getAddress, zeroAddress, type Address, type Hex } from "viem";
import type { OpenConfigContext } from "@/packages/classic-modules/src/open-config.mjs";
import { ModuleFoundationMarket } from "./module-foundation-market";
import { ModuleFoundationActions, type FoundationActionDescriptor, type FoundationActionReview } from "./module-foundation-actions";
import { FoundationSessionStatus, useFoundationSession, type FoundationExecutionResult } from "./module-foundation-session";
import { prepareFoundationClaim, prepareFoundationModuleAction, prepareFoundationTrade } from "@/lib/module-foundation/client";
import { bindFoundationCatalogV1 } from "@/lib/module-foundation/catalog";
import { decodeFoundationLaunchSelectionsV1, readFoundationActionRuntimeV1 } from "@/lib/module-foundation/action-runtime";
import { presentFoundationActionsV1, type FoundationPresentedActionV1 } from "@/lib/module-foundation/presentation";
import { discoverFoundationLaunch } from "@/lib/module-foundation/discovery";
import { readFoundationAssetPins, readFoundationModulePackages } from "@/lib/module-foundation/metadata";
import { refreshFoundationAssetsV1 } from "@/lib/module-foundation/assets";
import { readFoundationPoolDetails, simulateFoundationTradeFees, type FoundationPoolDetails } from "@/lib/module-foundation/readback";
import { foundationMetadataLinks, foundationPoolPresentation, foundationPositionPresentation } from "@/lib/module-foundation/ui-readback";
import { foundationParseAmount } from "@/lib/module-foundation/price";
import { foundationStepSummary } from "@/lib/module-foundation/wallet";
import { foundationLedgerAbi } from "@/lib/module-foundation/abi";
import { FOUNDATION_INFRASTRUCTURE } from "@/lib/module-foundation/constants";
import { FOUNDATION_WETH } from "@/lib/module-foundation/native-funding";
import type { AnyQuoteReadinessV1 } from "@/lib/module-engine/any-quote/types";
import { FOUNDATION_PLATFORM_FEE_BPS, FOUNDATION_PLATFORM_FEE_RECIPIENT, type FoundationTradeDraft,
  type FoundationTradeReview, type FoundationTransactionResult, type FoundationModuleSelection } from "@/lib/module-foundation/ui-types";
import styles from "./module-foundation-ui.module.css";

export function ModuleFoundationMarketHost({ token, transactionHash }: { token: Address; transactionHash?: Hex }) {
  const session = useFoundationSession(token);
  const [readback, setReadback] = useState<{ context: string; details: FoundationPoolDetails } | null>(null);
  const [error, setError] = useState(""); const [refreshKey, setRefreshKey] = useState(0);
  const trades = useRef(new WeakMap<FoundationTradeReview, Awaited<ReturnType<typeof prepareFoundationTrade>>>());
  const claims = useRef(new WeakMap<FoundationActionReview, Awaited<ReturnType<typeof prepareFoundationClaim>> | Awaited<ReturnType<typeof prepareFoundationModuleAction>>>());
  const [moduleState, setModuleState] = useState<{ key: string; error?: string; selections?: readonly FoundationModuleSelection[];
    context?: OpenConfigContext; actions?: readonly (FoundationPresentedActionV1 & { moduleIndex: number })[] } | null>(null);
  const [recoveryHash, setRecoveryHash] = useState(transactionHash ?? "");
  const [selectedHash, setSelectedHash] = useState(transactionHash);
  const details = readback?.context === session.contextKey ? readback.details : null;
  const binding = session.envelope?.binding;
  const catalog = useMemo(() => session.envelope ? bindFoundationCatalogV1(session.envelope.catalog.document, session.envelope.catalog.authority) : null, [session.envelope]);
  const moduleKey = `${session.contextKey}:${token}:${details?.checkpoint.blockHash ?? "loading"}`;
  const modules = moduleState?.key === moduleKey ? moduleState : null;
  useEffect(() => {
    if (!binding || !session.envelope?.available) return;
    let active = true;
    void readFoundationPoolDetails({ client: session.client, binding, token, account: session.account }).then(value => {
      if (active) { setReadback({ context: session.contextKey, details: value }); setError(""); }
    }).catch(caught => { if (active) setError(caught instanceof Error && caught.message.length < 240 ? caught.message : "This pool could not be verified. Refresh its chain state."); });
    return () => { active = false; };
  }, [binding, session.envelope?.available, session.client, session.account, session.contextKey, token, refreshKey]);
  useEffect(() => {
    if (!details || details.ledger.modules.length === 0 || !binding || !catalog || !session.account) return;
    const controller = new AbortController(), account = session.account;
    const context: OpenConfigContext = { roles: { creator: details.creator }, assets: {
      token: { chainId: 4663, address: token, decimals: 18 }, quote: { chainId: 4663, address: details.quote.address, decimals: details.quote.decimals } },
    components: { factory: binding.factory.address, ...Object.fromEntries(Object.entries(FOUNDATION_INFRASTRUCTURE).map(([role, pin]) => [role, pin.address])) } };
    void (async () => {
      const discovered = await discoverFoundationLaunch({ client: session.client, binding, token, transactionHash: selectedHash, signal: controller.signal,
        locator: async (address, options) => {
          const response = await fetch(`/api/module-foundation/locate?token=${address}`, { credentials: "same-origin", redirect: "error", cache: "no-store", signal: options?.signal });
          if (!response.ok) throw new Error("The original launch transaction could not be located. Enter its transaction hash below.");
          const value = await response.json() as { transactionHash?: Hex | null };
          return value.transactionHash ?? null;
        } });
      const restored = await refreshFoundationAssetsV1({ client: session.client,
        pins: readFoundationAssetPins(discovered.parameters.metadata.socialData), context });
      const decoded = decodeFoundationLaunchSelectionsV1({ catalog, calldata: discovered.transaction.data, context: restored.context,
        packageIds: readFoundationModulePackages(discovered.parameters.metadata.socialData, discovered.moduleSelections.length) });
      const runtime = await readFoundationActionRuntimeV1({ client: session.client, binding, catalog, pool: details.pool, selections: decoded.selections, context: restored.context });
      const actions = runtime.instances.flatMap((instance, moduleIndex) => presentFoundationActionsV1({ catalog, instance, account,
        context: runtime.configurationContext }).map(action => ({ ...action, moduleIndex })));
      if (!controller.signal.aborted) setModuleState({ key: moduleKey, selections: decoded.selections, context: runtime.configurationContext, actions });
    })().catch(caught => { if (!controller.signal.aborted) setModuleState({ key: moduleKey, error: caught instanceof Error && caught.message.length < 240
      ? caught.message : "The installed module actions could not be verified. Refresh the pool or enter its original launch transaction." }); });
    return () => controller.abort();
  }, [details, binding, catalog, session.client, session.account, token, selectedHash, moduleKey]);

  async function prepareTrade(draft: FoundationTradeDraft): Promise<FoundationTradeReview> {
    if (!session.account || !details) throw new Error("Connect your wallet and load the verified pool first.");
    const account = session.account, context = session.contextKey; session.assertCurrent(account, context);
    const current = await session.resolveAuthority();
    if (details.ledger.modules.length > 0 && (!modules?.selections || !modules.context || modules.error)) {
      throw new Error("Wait for this pool's original module sources and asset bindings to be verified before trading.");
    }
    const amountIn = foundationParseAmount(draft.amount, 18, false);
    let externalRoute;
    if (getAddress(details.quote.address) !== FOUNDATION_WETH) {
      const response = await fetch("/api/module-foundation/eth-route", { method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteAsset: details.quote.address,
          ...(draft.side === "buy" ? { probeEthAmount: amountIn.toString() } : {}) }) });
      const readiness = await response.json() as AnyQuoteReadinessV1;
      if (!response.ok || readiness.status !== "compatible") throw new Error("An executable ETH route is currently unavailable for this pool. Try again when liquidity is available.");
      externalRoute = readiness.routes[draft.side];
    }
    session.assertCurrent(account, context);
    const sequence = await prepareFoundationTrade({ client: session.client, binding: current, account, pool: details.pool,
      side: draft.side, amountIn, slippageBps: draft.slippageBps, nativeEth: true, externalRoute,
      ...(details.ledger.modules.length > 0 ? { moduleReview: { catalog: await session.resolveCatalog(),
        selections: modules!.selections!, context: modules!.context } } : {}) });
    const fees = await simulateFoundationTradeFees({ client: session.client, binding: current, pool: details.pool,
      steps: sequence.steps, checkpoint: sequence.checkpoint });
    session.assertCurrent(account, context);
    const outputDecimals = 18;
    const review: FoundationTradeReview = { id: crypto.randomUUID(), contextKey: context, account, chainId: 4663, side: draft.side,
      expiresAt: Number(sequence.expiresAt), simulationBlock: sequence.checkpoint.blockNumber.toString(), inputAmount: draft.amount,
      outputAmount: formatUnits(sequence.amountOut, outputDecimals), minimumOutput: formatUnits(sequence.minimumOutput, outputDecimals),
      platformFeeAmount: formatUnits(fees.platformQuote, details.quote.decimals), creatorFeeAmount: formatUnits(fees.creatorQuote, details.quote.decimals),
      ...(externalRoute ? {} : { lpFeeAmount: "0" }), platformFeeBps: FOUNDATION_PLATFORM_FEE_BPS, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT,
      universalRouter: FOUNDATION_INFRASTRUCTURE.universalRouter.address, transactions: sequence.steps.map(foundationStepSummary) };
    trades.current.set(review, sequence); return review;
  }
  async function verifiedResult(outcome: FoundationExecutionResult): Promise<FoundationTransactionResult> {
    try {
    if (outcome.receipt?.status === "success" && outcome.sequence.kind === "claim") {
      const sequence = outcome.sequence;
      const events = outcome.receipt.logs.filter(log => getAddress(log.address) === getAddress(sequence.provenance.record.ledger)).flatMap(log => {
        try { return [decodeEventLog({ abi: foundationLedgerAbi, data: log.data, topics: log.topics, eventName: "QuoteClaimed", strict: true }).args]; }
        catch { return []; }
      });
      if (events.length !== 1 || getAddress(events[0].beneficiary) !== getAddress(sequence.recipient)
        || events[0].budget !== (sequence.beneficiary === "platform" ? 0 : 1) || events[0].amount < sequence.minimumOutput) throw new Error("The actual fee payout could not be verified.");
      outcome.result = { ...outcome.result, verificationStatus: "verified", message: "The fee payout reached its fixed quote-token recipient in the confirmed transaction." };
    }
    } catch {
      outcome.result = { ...outcome.result, operationComplete: true, verificationStatus: "pending",
        message: "The transaction is confirmed. Its payout details need another readback; keep this transaction and check its details again." };
    }
    if (outcome.receipt) setRefreshKey(value => value + 1);
    return outcome.result;
  }

  if (!details) return <><FoundationSessionStatus session={session} /><div className={styles.page}><div className={styles.pageHeading}><h1>Module Mode coin</h1>
    <p role="status">{error || session.availability.reason || "Reading the coin metadata and pool from its verified release…"}</p></div>
    {error ? <button type="button" className={styles.secondaryButton} onClick={() => setRefreshKey(value => value + 1)}>Read pool again</button> : null}</div></>;
  const quote = { address: details.quote.address, chainId: 4663, name: details.quote.name, symbol: details.quote.symbol, decimals: details.quote.decimals,
    supported: true, ...(details.quote.balance === null ? {} : { balance: formatUnits(details.quote.balance, details.quote.decimals) }) };
  const coin = { address: token, name: details.token.name, symbol: details.token.symbol, description: details.token.description, decimals: 18,
    imageURI: details.token.imageURI, socialLinks: foundationMetadataLinks(details),
    ...(details.token.balance === null ? {} : { balance: formatUnits(details.token.balance, 18) }) };
  const payoutActions: FoundationActionDescriptor[] = (["creator", "platform"] as const).filter(kind =>
    !session.account || getAddress(details.ledger[kind].beneficiary) === getAddress(session.account)).map(kind => {
    const budget = details.ledger[kind];
    return { id: `fee:${kind}`, label: kind === "creator" ? "Pay out creator fees" : "Pay out platform fees",
      description: "Accrued quote tokens are paid directly to the fixed recipient.", fields: [], available: budget.withdrawable > 0n,
      unavailableReason: budget.withdrawable === 0n ? "No fees are available for payout yet." : undefined,
      payout: { asset: quote, recipient: budget.beneficiary, claimableAmount: formatUnits(budget.withdrawable, quote.decimals),
        creditedAmount: formatUnits(budget.credited, quote.decimals), paidAmount: formatUnits(budget.claimed, quote.decimals), asOfBlock: details.checkpoint.blockNumber.toString() } };
  });
  return <><FoundationSessionStatus session={session} /><ModuleFoundationMarket key={session.resultGeneration} availability={session.availability} contextKey={session.contextKey}
    coin={coin} quote={quote} tradeAsset={{ address: zeroAddress, chainId: 4663, name: "Ether", symbol: "ETH", decimals: 18, supported: true }}
    pool={foundationPoolPresentation(details)} positions={foundationPositionPresentation(details)} creatorFeeBps={details.creatorFeeBps}
    walletAction={session.walletAction} submissionBlocked={session.submissionBlocked} onPrepareTrade={prepareTrade}
    onConfirmTrade={async review => { const sequence = trades.current.get(review); if (!sequence) throw new Error("Review this trade again.");
      session.assertCurrent(sequence.account, review.contextKey); return verifiedResult(await session.execute(sequence)); }}
    onRefreshResult={async result => verifiedResult(await session.refreshResult(result))}
    feeLedger={{ asOfBlock: details.checkpoint.blockNumber.toString(), platformCredited: formatUnits(details.ledger.platform.credited, quote.decimals),
      platformPaid: formatUnits(details.ledger.platform.claimed, quote.decimals), creatorCredited: formatUnits(details.ledger.creator.credited, quote.decimals),
      creatorPaid: formatUnits(details.ledger.creator.claimed, quote.decimals) }}
    moduleActions={<><button type="button" className={styles.secondaryButton} onClick={() => setRefreshKey(value => value + 1)}>Refresh pool and fees</button>
      {details.positions.creator?.status === "closed" ? <p className={styles.help}>The separate creator position has been closed. The permanent base position remains locked.</p> : null}
      {details.ledger.modules.length > 0 ? <div><p className={styles.help} role="status">{!session.account ? "Connect your wallet to view its available module actions."
        : modules?.error ?? (!modules?.actions ? "Reading the installed modules and their original launch configuration…" : `${details.ledger.modules.length} installed module${details.ledger.modules.length === 1 ? "" : "s"} verified.`)}</p>
        {modules?.error ? <form className={styles.field} onSubmit={event => { event.preventDefault();
          if (/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)) { setSelectedHash(recoveryHash as Hex); setRefreshKey(value => value + 1); } }}>
          <label htmlFor="foundation-original-launch">Original launch transaction hash</label>
          <input id="foundation-original-launch" value={recoveryHash} onChange={event => setRecoveryHash(event.target.value.trim())} placeholder="0x…" autoComplete="off" />
          <button type="submit" className={styles.secondaryButton} disabled={!/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)}>Read installed modules</button>
        </form> : null}</div> : null}
      <ModuleFoundationActions availability={session.availability} contextKey={session.contextKey} actions={[...payoutActions, ...(modules?.actions ?? [])]}
        walletAction={session.walletAction} submissionBlocked={session.submissionBlocked}
        onPrepare={async (actionId, configuration) => {
          if (!session.account) throw new Error("Connect your wallet to prepare this action.");
          const context = session.contextKey, account = session.account;
          if (!["fee:creator", "fee:platform"].includes(actionId)) {
            const action = modules?.actions?.find(item => item.id === actionId);
            if (!action || !modules?.selections || !modules.context) throw new Error("Refresh the installed module actions before preparing.");
            const sequence = await prepareFoundationModuleAction({ client: session.client, binding: await session.resolveAuthority(), catalog: await session.resolveCatalog(),
              account, pool: details.pool, selections: modules.selections, context: modules.context, moduleIndex: action.moduleIndex,
              selection: { id: action.moduleId, version: action.version, digest: action.digest, actionId: action.actionId, configuration } });
            session.assertCurrent(account, context);
            const review: FoundationActionReview = { id: crypto.randomUUID(), actionId, configuration, contextKey: context, account, chainId: 4663,
              simulationBlock: sequence.checkpoint.blockNumber.toString(), expiresAt: Number(sequence.expiresAt),
              transfers: sequence.balanceChecks.filter(check => (check.minimumDelta ?? 0n) > 0n).map(check => {
                const observed = sequence.assets.find(asset => getAddress(asset.address) === getAddress(check.token));
                if (!observed) throw new Error("The action's output asset metadata could not be verified.");
                const asset = { ...observed, supported: true };
                return { asset, recipient: account, amount: formatUnits(check.minimumDelta!, asset.decimals) };
              }), transactions: sequence.steps.map(foundationStepSummary),
              notes: ["The preview checks your coin, quote and configured ERC20 balances. Execution limits are set by this action's inputs."] };
            claims.current.set(review, sequence); return review;
          }
          const sequence = await prepareFoundationClaim({ client: session.client, binding: await session.resolveAuthority(), account,
            pool: details.pool, beneficiary: actionId === "fee:creator" ? "creator" : "platform" });
          session.assertCurrent(account, context);
          const review: FoundationActionReview = { id: crypto.randomUUID(), actionId, configuration, contextKey: context, account, chainId: 4663,
            simulationBlock: sequence.checkpoint.blockNumber.toString(), expiresAt: Number(sequence.expiresAt),
            transfers: [{ asset: quote, recipient: sequence.recipient, amount: formatUnits(sequence.minimumOutput, quote.decimals) }], transactions: sequence.steps.map(foundationStepSummary) };
          claims.current.set(review, sequence); return review;
        }} onConfirm={async review => { const sequence = claims.current.get(review); if (!sequence) throw new Error("Review this payout again.");
          session.assertCurrent(sequence.account, review.contextKey); return verifiedResult(await session.execute(sequence)); }}
        onRefreshResult={async result => verifiedResult(await session.refreshResult(result))} /></>} /></>;
}
