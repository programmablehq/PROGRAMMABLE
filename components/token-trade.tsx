"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  formatUnits,
  getAddress,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import type { WalletTradeBalances } from "./wallet-provider";
import {
  validatePreparedTradeResponse,
  type PreparedTokenTrade,
} from "../lib/trade/client";
import {
  calculateNativeHookTradeCosts,
  formatFixedBasisPoints,
} from "../lib/trade/metrics";
import {
  DEFAULT_TRADE_SLIPPAGE_BPS,
  MAX_TRADE_SLIPPAGE_BPS,
  TRADE_QUOTE_VALIDITY_SECONDS,
  TRADE_SLIPPAGE_PRESET_BPS,
} from "../lib/trade/policy";
import styles from "./token-experience.module.css";

export type { PreparedTokenTrade } from "../lib/trade/client";
export { DEFAULT_TRADE_SLIPPAGE_BPS } from "../lib/trade/policy";

type TradeSide = "buy" | "sell";
export type TradeFeePresentation = "legacy-pool" | "classic-v4-hook";
type WalletTradeBalanceState =
  | {
      owner: Address;
      asset: Address;
      status: "ready";
      balances: WalletTradeBalances;
    }
  | {
      owner: Address;
      asset: Address;
      status: "error";
    };

export const MIN_BUY_GAS_RESERVE_WEI = parseEther("0.003");
const BUY_GAS_RESERVE_UNITS = 500_000n;
const BUY_GAS_RESERVE_MULTIPLIER = 150n;

export function parseTradeSlippageBps(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter slippage with up to two decimal places");
  }

  const [wholePart, decimalPart = ""] = normalized.split(".");
  const basisPoints =
    Number(wholePart) * 100 + Number(decimalPart.padEnd(2, "0"));
  if (
    !Number.isSafeInteger(basisPoints) ||
    basisPoints < 1 ||
    basisPoints > MAX_TRADE_SLIPPAGE_BPS
  ) {
    throw new Error("Slippage must be between 0.01% and 10%");
  }
  return basisPoints;
}

export function calculateBuyMaxWei(
  nativeBalanceWei: bigint,
  gasPriceWei: bigint,
) {
  if (nativeBalanceWei < 0n || gasPriceWei < 0n) {
    throw new Error("Wallet balances cannot be negative");
  }

  const estimatedReserve =
    (gasPriceWei * BUY_GAS_RESERVE_UNITS * BUY_GAS_RESERVE_MULTIPLIER) / 100n;
  const reserveWei =
    estimatedReserve > MIN_BUY_GAS_RESERVE_WEI
      ? estimatedReserve
      : MIN_BUY_GAS_RESERVE_WEI;

  return {
    amountWei:
      nativeBalanceWei > reserveWei ? nativeBalanceWei - reserveWei : 0n,
    reserveWei,
  };
}

export function calculateTradeUsdValue(input: {
  side: TradeSide;
  amount: string;
  tokenPriceEth?: string;
  tokenPriceUsdWad?: string;
}) {
  if (
    !/^\d+(?:\.\d+)?$/.test(input.amount.trim()) ||
    !input.tokenPriceUsdWad ||
    !/^\d+$/.test(input.tokenPriceUsdWad)
  ) {
    return null;
  }

  const amount = Number(input.amount);
  const tokenUsd = Number(formatUnits(BigInt(input.tokenPriceUsdWad), 18));
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(tokenUsd) ||
    amount < 0 ||
    tokenUsd < 0
  ) {
    return null;
  }

  if (input.side === "sell") {
    return amount * tokenUsd;
  }
  if (!input.tokenPriceEth || !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth)) {
    return null;
  }

  const tokenEth = Number(input.tokenPriceEth);
  if (!Number.isFinite(tokenEth) || tokenEth <= 0) return null;
  return amount * (tokenUsd / tokenEth);
}

export function calculateTradeTokenEstimate(input: {
  side: TradeSide;
  amount: string;
  tokenPriceEth?: string;
}) {
  if (
    !/^\d+(?:\.\d+)?$/.test(input.amount.trim()) ||
    !input.tokenPriceEth ||
    !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth)
  ) {
    return null;
  }

  const amount = Number(input.amount);
  const tokenPriceEth = Number(input.tokenPriceEth);
  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(tokenPriceEth) ||
    amount < 0 ||
    tokenPriceEth <= 0
  ) {
    return null;
  }

  return input.side === "buy"
    ? amount / tokenPriceEth
    : amount * tokenPriceEth;
}

export function calculateEthVolumeUsdValue(input: {
  grossVolumeEth?: string;
  tokenPriceEth?: string;
  tokenPriceUsdWad?: string;
}) {
  if (
    !input.grossVolumeEth ||
    !/^\d+(?:\.\d+)?$/.test(input.grossVolumeEth) ||
    !input.tokenPriceEth ||
    !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth) ||
    !input.tokenPriceUsdWad ||
    !/^\d+$/.test(input.tokenPriceUsdWad)
  ) {
    return null;
  }

  const grossVolumeEth = Number(input.grossVolumeEth);
  const tokenPriceEth = Number(input.tokenPriceEth);
  const tokenPriceUsd = Number(formatUnits(BigInt(input.tokenPriceUsdWad), 18));
  if (
    !Number.isFinite(grossVolumeEth) ||
    !Number.isFinite(tokenPriceEth) ||
    !Number.isFinite(tokenPriceUsd) ||
    grossVolumeEth < 0 ||
    tokenPriceEth <= 0 ||
    tokenPriceUsd < 0
  ) {
    return null;
  }

  return grossVolumeEth * (tokenPriceUsd / tokenPriceEth);
}

function formatApproximateUsd(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return "";
  if (value > 0 && value < 0.01) return "< $0.01";
  return `≈ ${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatEstimatedOutput(value: number | null, unit: string) {
  if (value === null || !Number.isFinite(value) || value < 0) return "";
  return `Estimated ${new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumSignificantDigits: 7,
  }).format(value)} ${unit}`;
}

function formatBasisPoints(value: number) {
  return formatFixedBasisPoints(value);
}

function formatAmountForInput(value: bigint, decimals: number) {
  return formatUnits(value, decimals).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
}

function formatWalletBalance(value: bigint, decimals: number) {
  const numeric = Number(formatUnits(value, decimals));
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: numeric >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: numeric >= 1 ? 4 : 6,
    maximumSignificantDigits: 7,
  }).format(numeric);
}

export function formatTradeAmount(
  amountRaw: string,
  decimals: number,
  unit: string,
) {
  return `${new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 7,
  }).format(Number(formatUnits(BigInt(amountRaw), decimals)))} ${unit}`;
}

export type TokenTradeApiRequest = {
  chainId: number;
  owner: Address;
  token: Address;
  side: TradeSide;
  amountIn: string;
  slippageBps: number;
  deadline: string;
};

export function buildTokenTradeApiRequest(input: {
  chainId: number;
  owner: string;
  token: string;
  side: TradeSide;
  amount: string;
  tokenDecimals: number;
  slippageBps: number;
  nowSeconds: number;
}): TokenTradeApiRequest {
  if (
    !Number.isInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 255
  ) {
    throw new Error("Token decimals must be between 0 and 255");
  }
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 0) {
    throw new Error("The current timestamp is invalid");
  }
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 1 ||
    input.slippageBps > MAX_TRADE_SLIPPAGE_BPS
  ) {
    throw new Error("Slippage must be between 0.01% and 10%");
  }

  const amountDecimals = input.side === "buy" ? 18 : input.tokenDecimals;
  const amountValidationError = getTradeAmountValidationError(
    input.amount,
    amountDecimals,
  );
  if (amountValidationError) throw new Error(amountValidationError);

  let amountIn: bigint;
  try {
    amountIn = parseUnits(input.amount.trim(), amountDecimals);
  } catch {
    throw new Error("Enter a valid amount");
  }
  if (amountIn <= 0n) {
    throw new Error("The amount must be greater than zero");
  }

  return {
    chainId: input.chainId,
    owner: getAddress(input.owner),
    token: getAddress(input.token),
    side: input.side,
    amountIn: amountIn.toString(),
    slippageBps: input.slippageBps,
    deadline: String(input.nowSeconds + TRADE_QUOTE_VALIDITY_SECONDS),
  };
}

export function getTradeAmountValidationError(
  amount: string,
  decimals: number,
) {
  const trimmedAmount = amount.trim();
  if (!trimmedAmount) return "Enter an amount";
  if (!/^\d+(?:\.\d+)?$/.test(trimmedAmount)) {
    return "Enter a valid amount";
  }

  const fractionalDigits = trimmedAmount.split(".")[1]?.length ?? 0;
  if (fractionalDigits > decimals) {
    return `Use no more than ${decimals} decimal places`;
  }

  try {
    if (parseUnits(trimmedAmount, decimals) <= 0n) {
      return "The amount must be greater than zero";
    }
  } catch {
    return "Enter a valid amount";
  }

  return "";
}

export function TokenTrade({
  chainId,
  owner,
  token,
  hook,
  poolId,
  symbol,
  tokenDecimals = 18,
  tokenPriceEth,
  tokenPriceUsdWad,
  quoteAssetSymbol,
  tokenPriceQuote,
  launchModel,
  launchModelVersion,
  quoteAsset,
  buySwapFeeBps,
  sellSwapFeeBps,
  feePresentation = "legacy-pool",
  readBalances,
  onConnect,
  onPrepared,
}: {
  chainId: number;
  owner: Address | null;
  token: Address;
  hook: Address;
  poolId: Hex;
  symbol: string;
  tokenDecimals?: number;
  tokenPriceEth?: string;
  tokenPriceUsdWad?: string;
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  launchModelVersion?: string;
  quoteAsset?: Address;
  quoteAssetSymbol?: string;
  tokenPriceQuote?: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  feePresentation?: TradeFeePresentation;
  readBalances(inputAsset: Address): Promise<WalletTradeBalances>;
  onConnect(): void;
  onPrepared(prepared: PreparedTokenTrade): void | Promise<void>;
}) {
  const [side, setSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState("");
  const [slippagePercent, setSlippagePercent] = useState(
    String(DEFAULT_TRADE_SLIPPAGE_BPS / 100),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [slippageInvalid, setSlippageInvalid] = useState(false);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<PreparedTokenTrade | null>(null);
  const [maxPending, setMaxPending] = useState(false);
  const [balanceState, setBalanceState] =
    useState<WalletTradeBalanceState | null>(null);
  const formBusy = pending || maxPending;
  const amountInputId = useId();
  const amountErrorId = useId();
  const slippageInputId = useId();
  const slippagePresetsId = useId();
  const amountInputRef = useRef<HTMLInputElement>(null);
  const slippageInputRef = useRef<HTMLInputElement>(null);
  const activeSwapFeeBps = side === "buy" ? buySwapFeeBps : sellSwapFeeBps;
  const activeInputAsset = token;
  const activeInputSymbol = side === "buy" ? "ETH" : symbol;
  const activeBalanceState =
    owner &&
    balanceState?.owner.toLowerCase() === owner.toLowerCase() &&
    balanceState.asset.toLowerCase() === activeInputAsset.toLowerCase()
      ? balanceState
      : null;
  const balances =
    activeBalanceState?.status === "ready" ? activeBalanceState.balances : null;
  const effectiveTokenPriceEth = tokenPriceEth ??
    (quoteAssetSymbol?.toUpperCase() === "ETH" ? tokenPriceQuote : undefined);
  const approximateUsd = formatApproximateUsd(
    calculateTradeUsdValue({
      side,
      amount,
      tokenPriceEth: effectiveTokenPriceEth,
      tokenPriceUsdWad,
    }),
  );
  const estimatedOutput = formatEstimatedOutput(
    calculateTradeTokenEstimate({
      side,
      amount,
      tokenPriceEth: effectiveTokenPriceEth,
    }),
    side === "buy" ? symbol : "ETH",
  );
  const displayBalance = balances
    ? side === "buy"
      ? `Balance ${formatWalletBalance(balances.nativeBalanceWei, 18)} ETH`
      : `Balance ${formatWalletBalance(
          balances.tokenBalanceRaw,
          tokenDecimals,
        )} ${activeInputSymbol}`
    : owner
      ? activeBalanceState?.status === "error"
        ? "Balance unavailable"
        : "Loading balance"
      : "Connect to view balance";

  useEffect(() => {
    if (!owner) return;

    let active = true;
    void readBalances(activeInputAsset)
      .then((nextBalances) => {
        if (active) {
          setBalanceState({
            owner,
            asset: activeInputAsset,
            status: "ready",
            balances: nextBalances,
          });
        }
      })
      .catch(() => {
        if (active) {
          setBalanceState({
            owner,
            asset: activeInputAsset,
            status: "error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [activeInputAsset, owner, readBalances]);

  async function applyMaximumBalance() {
    if (formBusy) return;
    setError("");
    setAmountInvalid(false);
    setSlippageInvalid(false);
    setMessage("");
    if (!owner) {
      setError("Connect a wallet to use your balance");
      return;
    }

    setMaxPending(true);
    try {
      const balances = await readBalances(activeInputAsset);
      setBalanceState({
        owner,
        asset: activeInputAsset,
        status: "ready",
        balances,
      });
      if (side === "sell") {
        if (balances.tokenBalanceRaw <= 0n) {
          throw new Error(`No ${activeInputSymbol} balance is available`);
        }
        setAmount(
          formatAmountForInput(balances.tokenBalanceRaw, tokenDecimals),
        );
        return;
      }

      const maximum = calculateBuyMaxWei(
        balances.nativeBalanceWei,
        balances.gasPriceWei,
      );
      if (maximum.amountWei <= 0n) {
        throw new Error("Not enough ETH after reserving network fees");
      }
      setAmount(formatAmountForInput(maximum.amountWei, 18));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your wallet balance could not be read",
      );
    } finally {
      setMaxPending(false);
    }
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formBusy) return;
    setError("");
    setAmountInvalid(false);
    setSlippageInvalid(false);
    setMessage("");
    if (!owner) {
      setError("Connect a wallet to prepare this trade");
      return;
    }

    const amountValidationError = getTradeAmountValidationError(
      amount,
      side === "buy" ? 18 : tokenDecimals,
    );
    if (amountValidationError) {
      setAmountInvalid(true);
      setError(amountValidationError);
      amountInputRef.current?.focus();
      return;
    }

    let slippageBps: number;
    try {
      slippageBps = parseTradeSlippageBps(slippagePercent);
    } catch (caught) {
      setSlippageInvalid(true);
      setError(
        caught instanceof Error
          ? caught.message
          : "Enter a valid slippage tolerance",
      );
      slippageInputRef.current?.focus();
      return;
    }

    setPending(true);
    try {
      if (chainId !== 1 && chainId !== 11_155_111) {
        throw new Error("Trading is not supported on this network");
      }
      const body = buildTokenTradeApiRequest({
        chainId,
        owner,
        token,
        side,
        amount,
        tokenDecimals,
        slippageBps,
        nowSeconds: Math.floor(Date.now() / 1_000),
      });
      const response = await fetch("/api/trade/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw: unknown = await response.json();
      const responseError =
        typeof raw === "object" &&
        raw !== null &&
        "error" in raw &&
        typeof raw.error === "string"
          ? raw.error
          : "The trade could not be prepared";
      if (!response.ok) {
        throw new Error(responseError);
      }
      const payload = validatePreparedTradeResponse(raw, {
        chainId,
        owner,
        token,
        hook,
        poolId,
        launchModel,
        launchModelVersion,
        quoteAsset,
        side: body.side,
        amountIn: body.amountIn,
        slippageBps: body.slippageBps,
        deadline: body.deadline,
      });

      setReview(payload);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The trade could not be prepared",
      );
    } finally {
      setPending(false);
    }
  }

  async function confirmReview() {
    if (!review) return;
    setPending(true);
    setError("");
    try {
      await onPrepared(review);
      setReview(null);
      setMessage(
        review.status === "approval-required"
          ? "Approval submitted"
          : "Swap submitted",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The transaction could not be submitted",
      );
    } finally {
      setPending(false);
    }
  }

  if (review) {
    return (
      <PreparedTradeReview
        prepared={review}
        symbol={symbol}
        tokenDecimals={tokenDecimals}
        tokenPriceEth={tokenPriceEth}
        launchModel={launchModel}
        totalSwapFeeBps={activeSwapFeeBps}
        feePresentation={feePresentation}
        pending={pending}
        error={error}
        onBack={() => {
          setReview(null);
          setError("");
        }}
        onConfirm={confirmReview}
      />
    );
  }

  return (
    <form
      className={styles.tradeForm}
      onSubmit={prepare}
      aria-label={`Trade ${symbol}`}
      aria-busy={formBusy}
    >
      <div className={styles.sideControl} role="group" aria-label="Trade side">
        <span
          aria-hidden="true"
          className={`${styles.sideIndicator} ${
            side === "sell" ? styles.sideIndicatorSell : ""
          }`}
        />
        {(["buy", "sell"] as const).map((option) => (
          <button
            className={`${styles.sideButton} ${
              side === option ? styles.sideButtonSelected : ""
            }`}
            key={option}
            type="button"
            aria-pressed={side === option}
            disabled={formBusy}
            onClick={() => {
              setSide(option);
              setAmount("");
              setError("");
              setAmountInvalid(false);
              setMessage("");
            }}
          >
            {option === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      <div
        className={`${styles.amountCard} ${
          amountInvalid ? styles.amountCardInvalid : ""
        }`}
      >
        <div className={styles.amountHeader}>
          <label htmlFor={amountInputId}>
            {side === "buy" ? "You pay" : "You sell"}
          </label>
          <span className={styles.balanceRow}>
            <span className={styles.balance}>{displayBalance}</span>
            <button
              className={styles.maxButton}
              type="button"
              disabled={formBusy || !owner}
              aria-label={`Use maximum ${
                side === "buy" ? "ETH" : symbol
              } balance`}
              onClick={() => void applyMaximumBalance()}
            >
              {maxPending ? "Loading" : "Max"}
            </button>
          </span>
        </div>
        <div className={styles.amountInputRow}>
          <input
            ref={amountInputRef}
            className={styles.amountInput}
            id={amountInputId}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={amountInvalid || undefined}
            aria-describedby={amountInvalid ? amountErrorId : undefined}
            value={amount}
            disabled={formBusy}
            onChange={(event) => {
              setAmount(event.target.value);
              if (error) setError("");
              if (amountInvalid) setAmountInvalid(false);
            }}
            placeholder="0"
          />
          <span className={styles.asset}>
            {side === "buy" ? "ETH" : `$${symbol}`}
          </span>
        </div>
        <div className={styles.amountMeta}>
          <span aria-live="polite">{approximateUsd || "\u00A0"}</span>
          <span aria-live="polite">{estimatedOutput || "\u00A0"}</span>
        </div>
      </div>

      <dl className={`${styles.tradeFacts} ${styles.tradeSettings}`}>
        <div>
          <dt>
            {feePresentation === "classic-v4-hook"
              ? "Hook swap fee"
              : "Pool fee"}
          </dt>
          <dd>{formatBasisPoints(activeSwapFeeBps)}</dd>
        </div>
        <div>
          <dt>
            <label htmlFor={slippageInputId}>Max slippage</label>
          </dt>
          <dd>
            <span
              className={`${styles.slippageControl} ${
                slippageInvalid ? styles.slippageControlInvalid : ""
              }`}
            >
              <input
                ref={slippageInputRef}
                id={slippageInputId}
                aria-invalid={slippageInvalid || undefined}
                aria-describedby={slippageInvalid ? amountErrorId : undefined}
                autoComplete="off"
                inputMode="decimal"
                list={slippagePresetsId}
                maxLength={5}
                value={slippagePercent}
                disabled={formBusy}
                onChange={(event) => {
                  setSlippagePercent(event.target.value);
                  if (error) setError("");
                  if (slippageInvalid) setSlippageInvalid(false);
                }}
              />
              <datalist id={slippagePresetsId}>
                {TRADE_SLIPPAGE_PRESET_BPS.map((basisPoints) => (
                  <option
                    key={basisPoints}
                    value={String(basisPoints / 100)}
                  />
                ))}
              </datalist>
              <span aria-hidden="true">%</span>
            </span>
          </dd>
        </div>
      </dl>

      {error ? (
        <p className={styles.error} id={amountErrorId} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.tradeFooter}>
        <div className={styles.statusMessage} role="status">
          {message}
        </div>
        <button
          className={styles.primaryAction}
          type={owner ? "submit" : "button"}
          disabled={formBusy}
          onClick={owner ? undefined : onConnect}
        >
          {pending
            ? "Preparing trade"
            : owner
              ? `Review ${side}`
              : "Connect wallet"}
        </button>
      </div>
    </form>
  );
}

export function PreparedTradeReview({
  prepared,
  symbol,
  tokenDecimals,
  tokenPriceEth,
  launchModel,
  totalSwapFeeBps,
  feePresentation = "legacy-pool",
  pending,
  error,
  onBack,
  onConfirm,
}: {
  prepared: PreparedTokenTrade;
  symbol: string;
  tokenDecimals: number;
  tokenPriceEth?: string;
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  totalSwapFeeBps: number;
  feePresentation?: TradeFeePresentation;
  pending: boolean;
  error?: string;
  onBack(): void;
  onConfirm(): void | Promise<void>;
}) {
  const outputDecimals = prepared.side === "buy" ? tokenDecimals : 18;
  const outputUnit = prepared.side === "buy" ? symbol : "ETH";
  const expectedOutput = formatTradeAmount(
    prepared.quote.amountOut,
    outputDecimals,
    outputUnit,
  );
  const minimumOutput = formatTradeAmount(
    prepared.quote.amountOutMinimum,
    outputDecimals,
    outputUnit,
  );
  const approvalAmount = formatTradeAmount(
    prepared.quote.amountIn,
    tokenDecimals,
    symbol,
  );
  const costs = calculateNativeHookTradeCosts({
    side: prepared.side,
    amountIn: prepared.quote.amountIn,
    amountOut: prepared.quote.amountOut,
    tokenDecimals,
    tokenPriceEth,
    hookSwapFeeBps:
      feePresentation === "classic-v4-hook" ? totalSwapFeeBps : 0,
  });
  const approval =
    prepared.transaction.kind === "token-to-permit2"
      ? "Approve the exact token amount for Permit2"
      : prepared.transaction.kind === "permit2-to-router"
        ? "Approve the exact token amount for the Uniswap router"
        : null;

  return (
    <div
      className={styles.review}
      aria-label={`Review ${prepared.side}`}
      aria-busy={pending}
    >
      <h2>{approval ? "Approve token" : `Review ${prepared.side}`}</h2>
      {approval ? (
        <p className={styles.reviewLead}>
          One approval is required before this trade. The approval is limited to
          this amount.
        </p>
      ) : null}
      <div className={styles.reviewOutput}>
        <span>{approval ? "Approval amount" : "Expected output"}</span>
        <strong>{approval ? approvalAmount : expectedOutput}</strong>
      </div>
      <dl className={styles.reviewDetails}>
        {!approval ? (
          <div>
            <dt>Minimum received</dt>
            <dd>{minimumOutput}</dd>
          </div>
        ) : null}
        <div>
          <dt>
            {feePresentation === "classic-v4-hook"
              ? "Hook swap fee"
              : launchModel === "deep"
                ? "Deep fee"
                : "Pool fee"}
          </dt>
          <dd>{formatBasisPoints(totalSwapFeeBps)}</dd>
        </div>
        {!approval ? (
          <div>
            <dt>
              {feePresentation === "classic-v4-hook"
                ? "Curve price impact"
                : "Estimated price impact"}
            </dt>
            <dd>
              {costs === null
                ? "Unavailable"
                : formatFixedBasisPoints(costs.curvePriceImpactBps)}
            </dd>
          </div>
        ) : null}
        {!approval &&
        feePresentation === "classic-v4-hook" &&
        costs !== null ? (
          <div>
            <dt>Total execution cost</dt>
            <dd>{formatFixedBasisPoints(costs.totalExecutionCostBps)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Quote valid until</dt>
          <dd>
            {new Date(
              Number(prepared.quote.deadline) * 1_000,
            ).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.reviewActions}>
        <button
          className={styles.secondaryAction}
          type="button"
          disabled={pending}
          onClick={onBack}
        >
          Back
        </button>
        <button
          className={styles.primaryAction}
          type="button"
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          {pending
            ? "Opening wallet"
            : approval
              ? "Confirm approval"
              : `Confirm ${prepared.side}`}
        </button>
      </div>
    </div>
  );
}
