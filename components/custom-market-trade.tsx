"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { formatUnits, getAddress, parseUnits, type Address, type Hex } from "viem";

import type {
  DiscoverableMarketTradeSideV1,
} from "@/lib/custom-launch/contract-v2";
import {
  CUSTOM_TRADE_REQUEST_SCHEMA_V1,
  validateCustomMarketTradePreparationV1,
  type CustomMarketTradePreparationV1,
  type CustomMarketTradeRequestV1,
} from "@/lib/custom-launch/trade-v1";
import type { CustomProjectExploreEntry } from "@/lib/tokens";
import type {
  WalletNativeBalance,
  WalletTradeBalances,
} from "./wallet-provider";
import styles from "./token-experience.module.css";

type CustomMarket = CustomProjectExploreEntry["markets"][number];

export const DEFAULT_CUSTOM_TRADE_SLIPPAGE_BPS = 500;

export function customTradeSlippagePercent(
  maximumSlippageBps: number,
  currentPercent?: string,
) {
  if (!Number.isSafeInteger(maximumSlippageBps) || maximumSlippageBps < 1) {
    throw new TypeError("Custom trade slippage policy is invalid");
  }
  const fallbackBps = Math.min(
    DEFAULT_CUSTOM_TRADE_SLIPPAGE_BPS,
    maximumSlippageBps,
  );
  if (currentPercent === undefined) return String(fallbackBps / 100);

  const normalized = currentPercent.trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) {
    return String(fallbackBps / 100);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const currentBps = Number(whole) * 100
    + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(currentBps) || currentBps < 1) {
    return String(fallbackBps / 100);
  }
  return String(Math.min(currentBps, maximumSlippageBps) / 100);
}

function assetLabel(asset: CustomMarket["baseAsset"]) {
  return asset.symbol?.trim() || asset.name?.trim() || asset.assetId;
}

function assetDecimals(asset: CustomMarket["baseAsset"]) {
  if (asset.identity.value === "0x0000000000000000000000000000000000000000") {
    return 18;
  }
  return asset.decimals;
}

function displayAmount(value: string, decimals: number, symbol: string) {
  const amount = Number(formatUnits(BigInt(value), decimals));
  const formatted = Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 }).format(amount)
    : value;
  return `${formatted} ${symbol}`;
}

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1_000);
}

function customMarketLabel(market: CustomMarket) {
  return `${assetLabel(market.baseAsset)} / ${assetLabel(market.quoteAsset)}`;
}

function customTradeSideOptions(
  capability: CustomMarket["tradeCapability"] | undefined,
): readonly DiscoverableMarketTradeSideV1[] {
  const supported = capability?.supportedSides ?? [];
  return supported.includes("quote-to-base")
    ? [
        "quote-to-base",
        ...supported.filter((side) => side !== "quote-to-base"),
      ]
    : supported;
}

function preferredCustomTradeSide(
  capability: CustomMarket["tradeCapability"] | undefined,
) {
  return customTradeSideOptions(capability)[0] ?? "base-to-quote";
}

function CustomMarketSelector({
  markets,
  value,
  disabled,
  onChange,
}: {
  markets: readonly CustomMarket[];
  value: string;
  disabled: boolean;
  onChange(nextMarketId: string): void;
}) {
  const groupName = useId();
  const selected = markets.find((market) => market.marketId === value)
    ?? markets[0];
  if (selected === undefined) return null;

  if (markets.length === 1) {
    return (
      <div className={styles.customMarketSelect}>
        <span>Supported market</span>
        <div className={styles.customMarketValue}>
          {customMarketLabel(selected)}
        </div>
      </div>
    );
  }

  return (
    <fieldset className={styles.customMarketSelect}>
      <legend>Supported market</legend>
      <div className={styles.customMarketOptions}>
        {markets.map((market) => {
          const selectedOption = market.marketId === value;
          return (
            <label
              className={styles.customMarketOption}
              data-selected={selectedOption ? "true" : "false"}
              key={market.marketId}
            >
              <input
                className={styles.customMarketOptionInput}
                type="radio"
                name={groupName}
                value={market.marketId}
                checked={selectedOption}
                disabled={disabled}
                onChange={() => onChange(market.marketId)}
              />
              <span>{customMarketLabel(market)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CustomMarketTrade({
  project,
  chainId,
  owner,
  readNativeBalance,
  readBalances,
  onConnect,
  onSubmit,
}: {
  project: Pick<CustomProjectExploreEntry, "customProjectId" | "markets">;
  chainId: number;
  owner: Address | null;
  readNativeBalance(): Promise<WalletNativeBalance>;
  readBalances(asset: Address): Promise<WalletTradeBalances>;
  onConnect(): void;
  onSubmit(transaction: CustomMarketTradePreparationV1["transaction"]): Promise<Hex>;
}) {
  const tradableMarkets = useMemo(() => project.markets.filter(
    (market) => market.tradeCapability !== undefined,
  ), [project.markets]);
  const [marketId, setMarketId] = useState(tradableMarkets[0]?.marketId ?? "");
  const market = tradableMarkets.find((candidate) => candidate.marketId === marketId)
    ?? null;
  const capability = market?.tradeCapability;
  const [selectedSide, setSelectedSide] = useState<DiscoverableMarketTradeSideV1>(
    preferredCustomTradeSide(capability),
  );
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(
    customTradeSlippagePercent(
      capability?.slippagePolicy.maximumSlippageBps
        ?? DEFAULT_CUSTOM_TRADE_SLIPPAGE_BPS,
    ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<Readonly<{
    request: CustomMarketTradeRequestV1;
    preparation: CustomMarketTradePreparationV1;
  }> | null>(null);
  const amountId = useId();
  const slippageId = useId();
  const errorId = useId();

  if (market === null || capability === undefined) return null;
  const activeMarket = market;
  const activeCapability = capability;
  const sideOptions = customTradeSideOptions(activeCapability);
  const side = activeCapability.supportedSides.includes(selectedSide)
    ? selectedSide
    : sideOptions[0];
  if (side === undefined) return null;
  const binding = activeCapability.sideBindings.find((candidate) => candidate.side === side);
  if (binding === undefined) return null;
  const inputAsset = binding.inputAssetId === activeMarket.baseAsset.assetId
    ? activeMarket.baseAsset : activeMarket.quoteAsset;
  const outputAsset = binding.outputAssetId === activeMarket.baseAsset.assetId
    ? activeMarket.baseAsset : activeMarket.quoteAsset;
  const inputDecimals = assetDecimals(inputAsset);
  const outputDecimals = assetDecimals(outputAsset);
  const inputSymbol = assetLabel(inputAsset);
  const outputSymbol = assetLabel(outputAsset);

  async function applyMax() {
    if (pending || !owner || inputDecimals === undefined) return;
    setPending(true);
    setError("");
    try {
      if (binding?.inputCurrencyKind === "native") {
        const balance = await readNativeBalance();
        const reserve = balance.gasPriceWei * 750_000n * 150n / 100n;
        const maximum = balance.nativeBalanceWei > reserve
          ? balance.nativeBalanceWei - reserve : 0n;
        if (maximum <= 0n) {
          throw new Error("Not enough ETH is available after reserving network fees");
        }
        setAmount(formatUnits(maximum, inputDecimals));
      } else {
        const balance = await readBalances(getAddress(inputAsset.identity.value));
        if (balance.tokenBalanceRaw <= 0n) {
          throw new Error(`No ${inputSymbol} balance is available`);
        }
        setAmount(formatUnits(balance.tokenBalanceRaw, inputDecimals));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Balance unavailable");
    } finally {
      setPending(false);
    }
  }

  async function prepare(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    if (!owner) {
      onConnect();
      return;
    }
    if (chainId !== 1 && chainId !== 11_155_111) {
      setError("Trading is not supported on this network");
      return;
    }
    if (inputDecimals === undefined || outputDecimals === undefined) {
      setError("Token details are unavailable for this market. Try again later.");
      return;
    }
    let amountIn: bigint;
    let slippageBps: number;
    try {
      amountIn = parseUnits(amount.trim(), inputDecimals);
      const normalized = slippage.trim();
      if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) throw new Error("Enter valid slippage");
      const [whole, fraction = ""] = normalized.split(".");
      slippageBps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (amountIn <= 0n) throw new Error("Enter an amount greater than zero");
      if (!Number.isSafeInteger(slippageBps) || slippageBps < 1
        || slippageBps > activeCapability.slippagePolicy.maximumSlippageBps) {
        throw new Error(
          `Slippage must be between 0.01% and ${activeCapability.slippagePolicy.maximumSlippageBps / 100}%`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a valid amount");
      return;
    }
    const now = currentUnixSeconds();
    const request: CustomMarketTradeRequestV1 = {
      schemaVersion: CUSTOM_TRADE_REQUEST_SCHEMA_V1,
      projectId: project.customProjectId,
      marketId: activeMarket.marketId,
      tradeCapabilityBindingHash: activeCapability.tradeCapabilityBindingHash,
      chainId,
      owner,
      recipient: owner,
      side,
      amountIn: amountIn.toString(),
      slippageBps,
      deadline: String(now + Math.min(
        1_200,
        activeCapability.deadlinePolicy.maximumHorizonSeconds,
      )),
    };
    setPending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/custom-launch/v2/trade/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const responseError = typeof value === "object" && value !== null
          && "error" in value && typeof value.error === "string"
          ? value.error : "This trade could not be prepared";
        throw new Error(responseError);
      }
      const preparation = validateCustomMarketTradePreparationV1({
        value,
        request,
        capability: activeCapability,
        nowSeconds: now,
      });
      setReview({ request, preparation });
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message : "This trade could not be prepared");
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    if (review === null) return;
    if (owner === null || getAddress(owner) !== getAddress(review.request.owner)) {
      setReview(null);
      setError("The connected wallet changed. Prepare the trade again for the current wallet");
      return;
    }
    setPending(true);
    setError("");
    try {
      const hash = await onSubmit(review.preparation.transaction);
      const wasSwap = review.preparation.transaction.kind === "swap";
      setReview(null);
      setMessage(`${wasSwap ? "Swap" : "Approval"} submitted · ${hash.slice(0, 10)}…${hash.slice(-6)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The transaction was not submitted");
    } finally {
      setPending(false);
    }
  }

  if (review !== null && outputDecimals !== undefined) {
    return (
      <div className={styles.tradeForm} aria-busy={pending}>
        <div className={styles.customTradeReviewHeader}>
          <span>Transaction review</span>
          <h2>{review.preparation.status === "ready" ? "Review swap" : "Review approval"}</h2>
        </div>
        <dl className={styles.tradeFacts}>
          <div><dt>Base / quote</dt><dd>{customMarketLabel(activeMarket)}</dd></div>
          <div><dt>Market ID</dt><dd>{review.request.marketId}</dd></div>
          <div><dt>Trade direction</dt><dd>{inputSymbol} → {outputSymbol}</dd></div>
          <div><dt>Minimum received</dt><dd>{displayAmount(
            review.preparation.quote.amountOutMinimum,
            outputDecimals,
            outputSymbol,
          )}</dd></div>
          <div><dt>Recipient</dt><dd>{review.preparation.recipient.slice(0, 6)}…{review.preparation.recipient.slice(-4)}</dd></div>
        </dl>
        <p className={styles.customTradeBinding}>
          <span className={styles.customTradeBindingHash}>
            Route binding: {review.request.tradeCapabilityBindingHash}
          </span>
          <span className={styles.customTradeBindingNote}>
            Programmable validates this market, route, and recipient before opening your wallet.
          </span>
        </p>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={styles.customTradeReviewActions}>
          <button className={styles.secondaryAction} type="button" disabled={pending} onClick={() => setReview(null)}>Back</button>
          <button className={styles.primaryAction} type="button" disabled={pending} onClick={() => void confirm()}>
            {pending
              ? "Opening wallet"
              : review.preparation.status === "ready"
                ? "Confirm swap in wallet"
                : "Confirm approval in wallet"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.tradeForm} onSubmit={(event) => void prepare(event)} aria-busy={pending}>
      <CustomMarketSelector
        markets={tradableMarkets}
        value={marketId}
        disabled={pending}
        onChange={(nextMarketId) => {
          if (pending) return;
          const nextCapability = tradableMarkets.find(
            (candidate) => candidate.marketId === nextMarketId,
          )?.tradeCapability;
          setMarketId(nextMarketId);
          setSelectedSide(preferredCustomTradeSide(nextCapability));
          if (nextCapability) {
            setSlippage((current) => customTradeSlippagePercent(
              nextCapability.slippagePolicy.maximumSlippageBps,
              current,
            ));
          }
          setAmount("");
          setError("");
        }}
      />
      <div
        className={`${styles.sideControl} ${styles.customSideControl}`}
        role="group"
        aria-label="Trade direction"
      >
        {sideOptions.map((candidate) => {
          const candidateBinding = capability.sideBindings.find((item) => item.side === candidate)!;
          const from = candidateBinding.inputAssetId === market.baseAsset.assetId
            ? assetLabel(market.baseAsset) : assetLabel(market.quoteAsset);
          const to = candidateBinding.outputAssetId === market.baseAsset.assetId
            ? assetLabel(market.baseAsset) : assetLabel(market.quoteAsset);
          return (
            <button
              className={`${styles.sideButton} ${side === candidate ? styles.sideButtonSelected : ""}`}
              type="button"
              aria-pressed={side === candidate}
              key={candidate}
              disabled={pending}
              onClick={() => {
                setSelectedSide(candidate);
                setAmount("");
                setError("");
              }}
            >
              {from} → {to}
            </button>
          );
        })}
      </div>
      <div className={styles.amountCard}>
        <div className={styles.amountHeader}>
          <label htmlFor={amountId}>You send</label>
          <button className={styles.maxButton} type="button" disabled={!owner || pending || inputDecimals === undefined} onClick={() => void applyMax()}>Max</button>
        </div>
        <div className={styles.amountInputRow}>
          <input id={amountId} className={styles.amountInput} inputMode="decimal" autoComplete="off" value={amount} disabled={pending} onChange={(event) => setAmount(event.target.value)} placeholder="0" aria-describedby={error ? errorId : undefined} />
          <span className={styles.asset}>{inputSymbol}</span>
        </div>
      </div>
      <dl className={`${styles.tradeFacts} ${styles.tradeSettings}`}>
        <div><dt>Route</dt><dd>Exact input · single pool</dd></div>
        <div>
          <dt><label htmlFor={slippageId}>Max slippage</label></dt>
          <dd className={styles.slippageControl}>
            <input id={slippageId} inputMode="decimal" value={slippage} disabled={pending} onChange={(event) => setSlippage(event.target.value)} />
            <span aria-hidden="true">%</span>
          </dd>
        </div>
      </dl>
      {error ? <p className={styles.error} id={errorId} role="alert">{error}</p> : null}
      <p className={styles.statusMessage} role="status">{message}</p>
      <div className={styles.tradeFooter}>
        <span>Recipient is fixed to the connected wallet</span>
        <button className={styles.primaryAction} type={owner ? "submit" : "button"} disabled={pending} onClick={owner ? undefined : onConnect}>
          {pending ? "Checking current route" : owner ? "Review trade" : "Connect wallet"}
        </button>
      </div>
    </form>
  );
}
