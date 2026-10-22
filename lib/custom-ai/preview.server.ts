import "server-only";
import { createHash } from "node:crypto";
import { readAnyQuoteUsdPriceV1, type AnyQuoteUsdReferenceV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { compileLaunchDraft } from "./lifecycle.server";
import { initialBuyRaw, parseCoinSettings, type CoinSettings, type LaunchPreview } from "./preview";
import { CustomAIError } from "./types";
import { inspectCustomAIQuote } from "./quote.server";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { requireMinimumInitialBuy } from "./initial-buy";

type Dependencies = { compile: typeof compileLaunchDraft; price: typeof readAnyQuoteUsdPriceV1; now: () => number;
  quote?: typeof inspectCustomAIQuote };
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function checkedPrice(reference: AnyQuoteUsdReferenceV1, settings: Pick<CoinSettings, "chainId" | "quote">, now: number) {
  if (reference.chainId !== settings.chainId || reference.quoteAsset.toLowerCase() !== settings.quote.toLowerCase()) {
    throw new CustomAIError("quote", "The price reference belongs to a different token or network.");
  }
  const uint = (value: string) => {
    if (!/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new CustomAIError("quote", "The quote price could not be verified.");
    return BigInt(value);
  };
  const n = uint(reference.price.usd.numerator), d = uint(reference.price.usd.denominator);
  const observed = uint(reference.price.observedAt), until = uint(reference.price.validUntil), checkpoint = uint(reference.checkpoint.timestamp);
  const time = BigInt(now);
  const heartbeat = reference.price.heartbeatSeconds;
  // Feed freshness and the future factory signature's 120-second lifetime are
  // distinct. Keep the canonical feed-specific policy; never relabel its round
  // timestamp as a fresh observation or produce an attestation here.
  if (!d || !n || !Number.isInteger(heartbeat) || heartbeat < 1 || heartbeat > 604_800
    || observed > time || checkpoint > time || time - observed > BigInt(heartbeat) || time - checkpoint > 60n || until <= time) {
    throw new CustomAIError("price", "A fresh USD price for this quote token is unavailable. Try again shortly.");
  }
  const usd = n * 10n ** 18n / d;
  if (usd === 0n || usd > 10n ** 36n) throw new CustomAIError("price", "The quote price is outside the contract's range.");
  return { usd, usdCeiling: (n * 10n ** 18n + d - 1n) / d,
    expiresAt: Number([until, observed + BigInt(heartbeat), checkpoint + 60n, time + 60n].reduce((a, b) => a < b ? a : b)) };
}

export function checkedQuote(reference: AnyQuoteUsdReferenceV1, ethReference: AnyQuoteUsdReferenceV1, settings: CoinSettings, now: number) {
  const quotePrice = checkedPrice(reference, settings, now);
  const wrappedEth = foundationChainProfile(settings.chainId).wrappedEth.address;
  const ethPrice = checkedPrice(ethReference, { chainId: settings.chainId, quote: wrappedEth }, now);
  if (ethReference.decimals !== 18) throw new CustomAIError("price", "The ETH price reference could not be verified.");
  // Use one identical reference for WETH. For other pairs, round ETH up and
  // the quote down so price quantization cannot understate the minimum.
  const ethUsd = settings.quote.toLowerCase() === wrappedEth.toLowerCase() ? quotePrice.usd : ethPrice.usdCeiling;
  const amount = initialBuyRaw(settings.initialBuy, reference.decimals);
  const minimum = requireMinimumInitialBuy(BigInt(amount), reference.decimals, quotePrice.usd, ethUsd);
  return { quote: { status: "price-checked" as const, decimals: reference.decimals, usdE18: quotePrice.usd.toString(),
    ethUsdE18: ethUsd.toString(), initialBuyRaw: amount, minimumInitialBuyRaw: minimum.toString(),
    evidenceHash: reference.price.evidenceHash, ethEvidenceHash: ethReference.price.evidenceHash },
    expiresAt: Math.min(quotePrice.expiresAt, ethPrice.expiresAt) };
}

export async function prepareLaunchPreview(value: unknown, signal?: AbortSignal,
  deps: Dependencies = { compile: compileLaunchDraft, price: readAnyQuoteUsdPriceV1, quote: inspectCustomAIQuote, now: () => Math.floor(Date.now() / 1000) }): Promise<LaunchPreview> {
  const input = value as { source?: unknown; settings?: unknown } | null;
  if (!input || typeof input.source !== "string" || !input.source || input.source.length > 32_000) throw new CustomAIError("source", "Choose a checked module first.");
  const source = input.source, settings = parseCoinSettings(input.settings);
  signal?.throwIfAborted();
  const readPrice = (quoteAsset: string) => deps.price({ quoteAsset }, { chainId: settings.chainId, pricePurpose: "module-launch" })
    .catch(() => null);
  const quotePrice = readPrice(settings.quote);
  const wrappedEth = foundationChainProfile(settings.chainId).wrappedEth.address;
  const ethPrice = settings.quote.toLowerCase() === wrappedEth.toLowerCase() ? quotePrice : readPrice(wrappedEth);
  // Compile on the server. Browser-provided statuses, bytecode and prices have
  // no authority. Price reads reuse the existing two-provider infrastructure.
  const [draft, reference, ethReference, inspectedQuote] = await Promise.all([
    deps.compile(source, signal),
    quotePrice, ethPrice,
    deps.quote?.(settings.chainId, settings.quote).catch(() => undefined),
  ]);
  signal?.throwIfAborted();
  if (!draft.compiled || draft.validation?.status !== "passed" || draft.lifecycle?.status !== "passed" || !draft.artifact) {
    throw new CustomAIError("module", "The current module must pass its checks before you can review a launch.", 422);
  }
  const createdAt = deps.now();
  let quote: LaunchPreview["quote"] = { status: "unavailable", message: "A fresh USD price for this quote token is unavailable. Try again shortly." };
  let expiresAt = createdAt + 60;
  if (reference && ethReference) {
    try { ({ quote, expiresAt } = checkedQuote(reference, ethReference, settings, createdAt)); }
    catch (error) {
      if (error instanceof CustomAIError && ["precision", "amount", "decimals", "initial-buy-minimum"].includes(error.code)) throw error;
      quote = { status: "unavailable", message: error instanceof CustomAIError ? error.message : "The quote price could not be verified." };
    }
  }
  // Bind quote checks to the selected chain/address and to the price decimals.
  // A stale or mismatched check must not disappear from the pending work.
  const quoteCheck = inspectedQuote && inspectedQuote.chainId === settings.chainId
    && inspectedQuote.address.toLowerCase() === settings.quote.toLowerCase()
    && inspectedQuote.checkedAt <= createdAt && createdAt - inspectedQuote.checkedAt < 60
    && (quote.status !== "price-checked" || inspectedQuote.decimals === quote.decimals)
    ? inspectedQuote : undefined;
  if (quoteCheck) expiresAt = Math.min(expiresAt, quoteCheck.checkedAt + 60);
  const result: Omit<LaunchPreview, "binding"> = { sourceHash: draft.sourceHash, artifactHash: draft.validation.artifactHash, settings,
    supply: "1000000000", startFdvUsd: "15000", maximumStartFdvUsd: "15091.50", platformFeeBps: 50, maximumTotalFeeBps: 1500,
    liquidity: "locked", moduleCases: draft.validation.cases,
    lifecycle: { status: "passed", scope: draft.lifecycle.scope, cases: draft.lifecycle.cases, bundleHash: draft.lifecycle.bundleHash },
    createdAt, expiresAt, quote, ...(quoteCheck ? { quoteCheck } : {}), canLaunch: false,
    pending: ["core-deployment", "live-launch-trading-checks",
      ...(quote.status === "unavailable" ? ["quote-price" as const] : []),
      ...(quoteCheck?.status !== "compatible" ? ["quote-transfer-and-control-checks" as const] : [])] };
  return { ...result, binding: sha(result) };
}

// Local-only CPU/RPC budget, separate from the paid chat allowance. Coalesce
// identical checks; no long-lived cache and no retries on provider failures.
export function createLaunchPreviewGate() {
  let active = 0, used = 0, windowAt = Date.now();
  const pending = new Map<string, Promise<LaunchPreview>>();
  return async (input: unknown, run: () => Promise<LaunchPreview>) => {
    const key = sha(input), existing = pending.get(key);
    if (existing) return existing;
    if (Date.now() - windowAt >= 60_000) { used = 0; windowAt = Date.now(); }
    if (active >= 2 || used >= 12) throw new CustomAIError("busy", "A launch check is already running. Try again shortly.", 429);
    active++; used++;
    const result = Promise.resolve().then(run).finally(() => { active--; pending.delete(key); });
    pending.set(key, result);
    return result;
  };
}
