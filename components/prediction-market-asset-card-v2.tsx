"use client";

import Link from "next/link";
import { isGitHubUrl } from "@/lib/public-link-visibility";

import { XBrandIcon } from "@/components/brand-icons";
import { WebsiteLinkIcon } from "@/components/website-link-icon";
import { applyTokenImageFallback } from "@/lib/token-image";
import {
  predictionAssetCardImageV2,
  type PredictionAssetLogoProxyV2,
} from "@/lib/prediction-v2/asset-logo-v2";
import type {
  PredictionV2CreateReview,
  PredictionV2CreateSourceNetwork,
} from "@/lib/prediction-v2/create-flow-v2";
import type { PredictionV2EnrichedMarketView } from
  "@/lib/prediction-v2/enriched-market-view-v2";
import type { PredictionMarketCapCreationIntentV2 } from
  "@/lib/prediction-v2/market-presentation-v2";
import type {
  PredictionTokenProfileLinkV2,
  PredictionTokenProfileV2,
} from "@/lib/prediction-v2/token-profile-v2";

import styles from "./prediction-market-asset-card-v2.module.css";

const SOCIAL_ORDER = Object.freeze({
  website: 0,
  x: 1,
  telegram: 2,
} as const satisfies Readonly<Record<PredictionTokenProfileLinkV2["kind"], number>>);

const CHAIN_BINDINGS = Object.freeze({
  ethereum: Object.freeze({ reference: "1", label: "Ethereum" }),
  base: Object.freeze({ reference: "8453", label: "Base" }),
  bnb: Object.freeze({ reference: "56", label: "BNB Chain" }),
  robinhood: Object.freeze({ reference: "4663", label: "Robinhood Chain" }),
  solana: Object.freeze({ reference: "mainnet-beta", label: "Solana" }),
} as const satisfies Readonly<Record<
  PredictionV2CreateSourceNetwork,
  Readonly<{ reference: string; label: string }>
>>);

const EXPLORER_ORIGINS = Object.freeze({
  ethereum: "https://etherscan.io",
  base: "https://basescan.org",
  bnb: "https://bscscan.com",
  robinhood: "https://robinhoodchain.blockscout.com",
  solana: "https://solscan.io",
} as const);

const PRESET_ASSET_BINDINGS = Object.freeze({
  btc: Object.freeze({ name: "Bitcoin", symbol: "BTC" }),
  eth: Object.freeze({ name: "Ethereum", symbol: "ETH" }),
  sol: Object.freeze({ name: "Solana", symbol: "SOL" }),
  bnb: Object.freeze({ name: "BNB", symbol: "BNB" }),
} as const);

const LIFECYCLE_LABELS = Object.freeze({
  open: "Open",
  paused: "Trading paused",
  closed: "Closed",
  "resolved-yes": "Resolved YES",
  "resolved-no": "Resolved NO",
  "resolved-invalid": "Invalid",
  unavailable: "Unavailable",
} as const);

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const TELEGRAM_HOSTS = new Set([
  "t.me",
  "www.t.me",
  "telegram.me",
  "www.telegram.me",
]);
const PRIVATE_HOST_SUFFIXES = Object.freeze([
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
]);
const PUBLIC_MARKET_ID_PATTERN = /^0x[0-9a-f]{64}$/u;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/u;
const ZERO_MARKET_ID = `0x${"0".repeat(64)}`;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const OWNED_ARTWORK_PATTERN = /^\/media\/prediction\/sha256-([0-9a-f]{64})\.webp$/u;
const BUNDLED_ARTWORK_PATTERN =
  /^\/brand\/programmable-token-fallback-0[1-6]-(?:dawn|moon|sun|mint|lavender|dusk)\.webp$/u;
const BUNDLED_UNAVAILABLE_ARTWORK =
  "/brand/programmable-token-fallback-02-moon.webp";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_POSITIVE_UINT_PATTERN = /^[1-9][0-9]*$/u;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,16}$/u;
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const PREDICTION_V2_SETTLEMENT_CHAIN_ID = 4_663 as const;
const PREDICTION_V2_MIN_SQRT_PRICE_X96 = 4_295_128_739n;
const PREDICTION_V2_MAX_SQRT_PRICE_X96 =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const PREDICTION_V2_Q192 = 1n << 192n;
const PREDICTION_V2_BPS_DENOMINATOR = 10_000n;
const MAX_UINT24 = (1 << 24) - 1;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_INT192 = (1n << 191n) - 1n;

type PredictionMarketAssetCardLifecycleV2 = keyof typeof LIFECYCLE_LABELS;
type PredictionMarketAssetCardProbabilityV2 =
  | Readonly<{ status: "available"; yesProbabilityBps: number }>
  | Readonly<{ status: "unavailable" }>;

export type PredictionMarketAssetCardHeadingLevelV2 = "h2" | "h3";

/**
 * The public card receives one release-bound settlement-RPC view.
 * Lifecycle, probability, identity and condition cannot be supplied again.
 * Integration boundary: `market` must be the in-process server output of
 * base-view construction followed by enrichment. Never deserialize it from
 * client input or JSON. This display component grants no transaction authority.
 */
export type PredictionMarketAssetCardV2Props = Readonly<{
  market: PredictionV2EnrichedMarketView;
  headingLevel?: PredictionMarketAssetCardHeadingLevelV2;
  imageLoading?: "eager" | "lazy";
  className?: string;
}>;

export type PredictionMarketAssetPreviewCardV2Props = Readonly<{
  profile: PredictionTokenProfileV2;
  review: PredictionV2CreateReview;
  /** Server-issued, create-preview-only provider image transport. */
  logoProxy?: PredictionAssetLogoProxyV2 | null;
  headingLevel?: PredictionMarketAssetCardHeadingLevelV2;
  imageLoading?: "eager" | "lazy";
  className?: string;
}>;

type PredictionMarketAssetCardArtworkV2 = Readonly<{
  source: string;
  fallback: string;
  sourceKind: "bundled-fallback" | "owned-provider-snapshot" | "preview-proxy";
}>;

type PredictionMarketCapDisplayIntentV2 = Pick<
  PredictionMarketCapCreationIntentV2,
  | "kind"
  | "settlementRole"
  | "comparator"
  | "targetUsd"
  | "template"
  | "percentChange"
  | "equivalentPriceStrikeUsd"
>;

type PredictionMarketAssetCardRenderModelV2 = Readonly<{
  name: string;
  symbol: string;
  chainLabel: string;
  condition: string;
  secondaryIntent: string | null;
  resultTime: string;
  artwork: PredictionMarketAssetCardArtworkV2;
  links: readonly PredictionTokenProfileLinkV2[];
  href: `/markets/v2/0x${string}` | null;
  status: string;
  probability: string;
  profileBound?: boolean;
  runtimeBinding: "bound" | "unavailable" | "preview";
  snapshotBlock?: string;
}>;

type NormalizedLifecycleV2 = Readonly<{
  label: Exclude<PredictionMarketAssetCardLifecycleV2, "unavailable">;
  probabilitySource: "pool" | "yes" | "no" | "unavailable";
}>;

type NormalizedPublicBaseV2 = Readonly<{
  market: PredictionV2EnrichedMarketView;
  strikeUsd: string;
  lifecycle: NormalizedLifecycleV2;
}>;

type SafeEnrichmentV2 = Readonly<{
  name: string | null;
  artwork: PredictionMarketAssetCardArtworkV2;
  links: readonly PredictionTokenProfileLinkV2[];
  creationIntent: PredictionMarketCapDisplayIntentV2 | null;
}>;

export function predictionAssetConditionLabelV2(
  market: PredictionV2EnrichedMarketView,
) {
  const normalized = normalizePublicBaseV2(market);
  return normalized
    ? priceConditionLabel(normalized.strikeUsd)
    : "Market data unavailable";
}

export function predictionAssetResultTimeLabelV2(
  market: PredictionV2EnrichedMarketView,
) {
  const normalized = normalizePublicBaseV2(market);
  return normalized
    ? formatResultTime(normalized.market.condition.observationUtc)
    : "Not available";
}

export function predictionMarketAssetCardHrefV2(
  market: PredictionV2EnrichedMarketView,
): `/markets/v2/0x${string}` | null {
  const normalized = normalizePublicBaseV2(market);
  return normalized ? marketHrefFromId(normalized.market.marketId) : null;
}

function exactRecordKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isBytes32(value: unknown) {
  return typeof value === "string" &&
    BYTES32_PATTERN.test(value) &&
    value !== ZERO_MARKET_ID;
}

function isCanonicalAddress(value: unknown) {
  return typeof value === "string" &&
    ADDRESS_PATTERN.test(value) &&
    value !== ZERO_ADDRESS;
}

function isCanonicalUint(
  value: unknown,
  maximum: bigint,
  positive = false,
) {
  const pattern = positive
    ? CANONICAL_POSITIVE_UINT_PATTERN
    : CANONICAL_UINT_PATTERN;
  return typeof value === "string" &&
    pattern.test(value) &&
    BigInt(value) <= maximum;
}

function exactUtcMatchesUnix(value: unknown, unixSeconds: string) {
  if (typeof value !== "string") return false;
  const seconds = BigInt(unixSeconds);
  if (seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000))) {
    return false;
  }
  const date = new Date(Number(seconds) * 1_000);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function decimalFromAtoms(value: string, decimals: number) {
  if (!CANONICAL_POSITIVE_UINT_PATTERN.test(value) || decimals !== 8) {
    return null;
  }
  const digits = value.padStart(decimals + 1, "0");
  const split = digits.length - decimals;
  const fraction = digits.slice(split).replace(/0+$/u, "");
  return `${digits.slice(0, split)}${fraction ? `.${fraction}` : ""}`;
}

function normalizeBaseAsset(value: unknown) {
  if (!exactRecordKeys(value, [
    "kind",
    "presetId",
    "sourceNetwork",
    "chainLabel",
    "address",
    "explorerUrl",
    "name",
    "symbol",
  ]) || typeof value.symbol !== "string" ||
    !SYMBOL_PATTERN.test(value.symbol)) return false;

  if (value.kind === "preset") {
    if (
      typeof value.presetId !== "string" ||
      !Object.hasOwn(PRESET_ASSET_BINDINGS, value.presetId)
    ) return false;
    const preset = PRESET_ASSET_BINDINGS[
      value.presetId as keyof typeof PRESET_ASSET_BINDINGS
    ];
    return value.sourceNetwork === "global" &&
      value.chainLabel === "Global crypto asset" &&
      value.address === null &&
      value.explorerUrl === null &&
      value.name === preset.name &&
      value.symbol === preset.symbol;
  }

  if (
    value.kind !== "token" ||
    value.presetId !== null ||
    value.name !== null ||
    typeof value.sourceNetwork !== "string" ||
    !Object.hasOwn(CHAIN_BINDINGS, value.sourceNetwork) ||
    typeof value.address !== "string" ||
    typeof value.explorerUrl !== "string"
  ) return false;
  const network = value.sourceNetwork as PredictionV2CreateSourceNetwork;
  const addressValid = network === "solana"
    ? SOLANA_ADDRESS_PATTERN.test(value.address)
    : isCanonicalAddress(value.address);
  return addressValid &&
    value.chainLabel === CHAIN_BINDINGS[network].label &&
    value.explorerUrl ===
      `${EXPLORER_ORIGINS[network]}/token/${value.address}`;
}

function normalizeCondition(value: unknown) {
  if (!exactRecordKeys(value, [
    "kind",
    "metric",
    "comparator",
    "quoteCurrency",
    "strikeAtoms",
    "priceDecimals",
    "observationUnixSeconds",
    "observationUtc",
    "oracleSnapshotRule",
  ]) ||
    value.kind !== "usd-price-at-utc" ||
    value.metric !== "usd-price" ||
    value.comparator !== "greater-than-or-equal" ||
    value.quoteCurrency !== "USD" ||
    value.priceDecimals !== 8 ||
    typeof value.strikeAtoms !== "string" ||
    !isCanonicalUint(value.strikeAtoms, MAX_INT192, true) ||
    typeof value.observationUnixSeconds !== "string" ||
    !isCanonicalUint(value.observationUnixSeconds, MAX_UINT64, true) ||
    !exactUtcMatchesUnix(value.observationUtc, value.observationUnixSeconds) ||
    !exactRecordKeys(value.oracleSnapshotRule, [
      "source",
      "winningPrice",
      "requiredAfterRound",
      "maximumBeforeAgeSeconds",
      "maximumAfterDelaySeconds",
    ]) ||
    value.oracleSnapshotRule.source !== "chainlink-data-feed" ||
    value.oracleSnapshotRule.winningPrice !==
      "latest-completed-round-at-or-before-observation" ||
    value.oracleSnapshotRule.requiredAfterRound !==
      "first-completed-round-after-observation" ||
    !isCanonicalUint(
      value.oracleSnapshotRule.maximumBeforeAgeSeconds,
      MAX_UINT64,
      true,
    ) ||
    !isCanonicalUint(
      value.oracleSnapshotRule.maximumAfterDelaySeconds,
      MAX_UINT64,
      true,
    )
  ) return null;
  return decimalFromAtoms(value.strikeAtoms, value.priceDecimals);
}

function normalizeLifecycle(
  value: unknown,
  strikeAtoms: bigint,
): NormalizedLifecycleV2 | null {
  if (!exactRecordKeys(value, [
    "protocolState",
    "checkpointStatus",
    "tradingPhase",
    "tradable",
    "tradabilityReason",
    "checkpointTradingHealthy",
    "resolvedPrice",
  ]) ||
    typeof value.tradable !== "boolean" ||
    typeof value.checkpointTradingHealthy !== "boolean" ||
    typeof value.resolvedPrice !== "bigint" ||
    value.resolvedPrice < 0n
  ) return null;

  if (value.protocolState === "FINAL_YES") {
    return value.checkpointStatus === "FINAL" &&
        value.tradingPhase === "FINAL" &&
        value.tradable === false &&
        value.tradabilityReason === "market-final" &&
        value.checkpointTradingHealthy === false &&
        value.resolvedPrice >= strikeAtoms
      ? { label: "resolved-yes", probabilitySource: "yes" }
      : null;
  }
  if (value.protocolState === "FINAL_NO") {
    return value.checkpointStatus === "FINAL" &&
        value.tradingPhase === "FINAL" &&
        value.tradable === false &&
        value.tradabilityReason === "market-final" &&
        value.checkpointTradingHealthy === false &&
        value.resolvedPrice > 0n &&
        value.resolvedPrice < strikeAtoms
      ? { label: "resolved-no", probabilitySource: "no" }
      : null;
  }
  if (value.protocolState === "FINAL_INVALID") {
    const checkpointInvalid = value.checkpointStatus === "INVALID";
    const nonpositiveFinal = value.checkpointStatus === "FINAL" &&
      value.resolvedPrice === 0n;
    return (checkpointInvalid || nonpositiveFinal) &&
        value.tradingPhase === "FINAL" &&
        value.tradable === false &&
        value.tradabilityReason === "market-final" &&
        value.checkpointTradingHealthy === false
      ? { label: "resolved-invalid", probabilitySource: "unavailable" }
      : null;
  }
  if (value.protocolState !== "OPEN") return null;

  if (value.tradingPhase === "CLOSED") {
    const terminalHealthValid = value.checkpointStatus === "AWAITING" ||
      value.checkpointTradingHealthy === false;
    const priceValid = value.checkpointStatus === "FINAL"
      ? value.resolvedPrice > 0n
      : value.resolvedPrice === 0n;
    return value.tradable === false &&
        value.tradabilityReason === "cutoff-reached" &&
        terminalHealthValid &&
        priceValid
      ? { label: "closed", probabilitySource: "pool" }
      : null;
  }
  if (
    value.tradingPhase !== "OPEN" ||
    value.checkpointStatus !== "AWAITING" ||
    value.resolvedPrice !== 0n
  ) return null;
  if (value.tradable) {
    return value.tradabilityReason === "tradable" &&
        value.checkpointTradingHealthy
      ? { label: "open", probabilitySource: "pool" }
      : null;
  }
  return value.tradabilityReason === "checkpoint-unhealthy" &&
      value.checkpointTradingHealthy === false
    ? { label: "paused", probabilitySource: "pool" }
    : null;
}

function probabilityBpsFromSqrtPrice(
  sqrtPriceX96: bigint,
  yesIsCurrency0: boolean,
) {
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const denominator = PREDICTION_V2_Q192 + squared;
  const numerator = yesIsCurrency0 ? squared : PREDICTION_V2_Q192;
  return Number(
    (numerator * PREDICTION_V2_BPS_DENOMINATOR + denominator / 2n) /
      denominator,
  );
}

function validPoolState(value: unknown) {
  if (!exactRecordKeys(value, [
    "sqrtPriceX96",
    "tick",
    "poolManagerProtocolFee",
    "lpFee",
    "yesProbabilityBps",
  ]) ||
    typeof value.sqrtPriceX96 !== "bigint" ||
    value.sqrtPriceX96 < PREDICTION_V2_MIN_SQRT_PRICE_X96 ||
    value.sqrtPriceX96 > PREDICTION_V2_MAX_SQRT_PRICE_X96 ||
    typeof value.tick !== "number" ||
    !Number.isInteger(value.tick) ||
    value.tick < -887_272 ||
    value.tick > 887_272 ||
    typeof value.poolManagerProtocolFee !== "number" ||
    !Number.isInteger(value.poolManagerProtocolFee) ||
    value.poolManagerProtocolFee < 0 ||
    value.poolManagerProtocolFee > MAX_UINT24 ||
    typeof value.lpFee !== "number" ||
    !Number.isInteger(value.lpFee) ||
    value.lpFee < 0 ||
    value.lpFee > MAX_UINT24 ||
    typeof value.yesProbabilityBps !== "number" ||
    !Number.isInteger(value.yesProbabilityBps) ||
    value.yesProbabilityBps < 0 ||
    value.yesProbabilityBps > 10_000
  ) return false;
  return value.yesProbabilityBps === probabilityBpsFromSqrtPrice(
    value.sqrtPriceX96,
    true,
  ) || value.yesProbabilityBps === probabilityBpsFromSqrtPrice(
    value.sqrtPriceX96,
    false,
  );
}

function validBaseArtwork(value: unknown) {
  return exactRecordKeys(value, ["kind", "url"]) &&
    value.kind === "bundled-fallback" &&
    typeof value.url === "string" &&
    BUNDLED_ARTWORK_PATTERN.test(value.url);
}

function validOnchainBinding(value: unknown) {
  return exactRecordKeys(value, [
    "releaseId",
    "settlementChainId",
    "factoryAddress",
    "factoryRuntimeCodeHash",
    "assetKey",
    "registryRevision",
    "registrySnapshotHash",
    "resolutionPolicyHash",
    "vaultAddress",
    "checkpointAddress",
    "poolId",
    "confirmedBlockNumber",
    "confirmedBlockHash",
  ]) &&
    typeof value.releaseId === "string" &&
    RELEASE_ID_PATTERN.test(value.releaseId) &&
    value.settlementChainId === PREDICTION_V2_SETTLEMENT_CHAIN_ID &&
    isCanonicalAddress(value.factoryAddress) &&
    isBytes32(value.factoryRuntimeCodeHash) &&
    isBytes32(value.assetKey) &&
    isCanonicalUint(value.registryRevision, MAX_UINT64) &&
    isBytes32(value.registrySnapshotHash) &&
    isBytes32(value.resolutionPolicyHash) &&
    isCanonicalAddress(value.vaultAddress) &&
    isCanonicalAddress(value.checkpointAddress) &&
    isBytes32(value.poolId) &&
    isCanonicalUint(value.confirmedBlockNumber, MAX_UINT64, true) &&
    isBytes32(value.confirmedBlockHash);
}

function normalizePublicBaseV2(value: unknown): NormalizedPublicBaseV2 | null {
  try {
    if (!exactRecordKeys(value, [
      "schemaVersion",
      "source",
      "marketKey",
      "marketId",
      "economicKey",
      "asset",
      "condition",
      "lifecycle",
      "poolState",
      "artwork",
      "links",
      "onchain",
      "enrichment",
    ]) ||
      value.schemaVersion !== 2 ||
      value.source !== "onchain-rpc" ||
      !isBytes32(value.marketId) ||
      !isBytes32(value.economicKey) ||
      !normalizeBaseAsset(value.asset) ||
      !validPoolState(value.poolState) ||
      !validBaseArtwork(value.artwork) ||
      !Array.isArray(value.links) ||
      value.links.length !== 0 ||
      !validOnchainBinding(value.onchain)
    ) return null;
    const condition = value.condition as Record<string, unknown>;
    const strikeUsd = normalizeCondition(condition);
    if (!strikeUsd || typeof condition.strikeAtoms !== "string") return null;
    const lifecycle = normalizeLifecycle(
      value.lifecycle,
      BigInt(condition.strikeAtoms),
    );
    if (!lifecycle) return null;
    const onchain = value.onchain as Record<string, unknown>;
    if (
      typeof value.marketKey !== "string" ||
      value.marketKey !==
        `eip155:4663:${onchain.factoryAddress}:${value.economicKey}`
    ) return null;
    return Object.freeze({
      market: value as unknown as PredictionV2EnrichedMarketView,
      strikeUsd,
      lifecycle: Object.freeze(lifecycle),
    });
  } catch {
    return null;
  }
}

function marketHrefFromId(value: string): `/markets/v2/0x${string}` | null {
  return PUBLIC_MARKET_ID_PATTERN.test(value) && value !== ZERO_MARKET_ID
    ? `/markets/v2/${value as `0x${string}`}`
    : null;
}

function priceConditionLabel(strikeUsd: string) {
  return `Price ≥ ${formatCanonicalUsd(strikeUsd)}`;
}

function formatCanonicalUsd(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return `$${value}`;
  const integer = match[1].replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `$${integer}${match[2] ? `.${match[2]}` : ""}`;
}

function formatPercentChange(value: string) {
  if (value.startsWith("-")) return `−${value.slice(1)}%`;
  if (value === "0") return "0%";
  return `+${value}%`;
}

function formatResultTime(value: string) {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) return value;
  const canonical = new Date(milliseconds).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z")) {
    return value;
  }
  const date = new Date(milliseconds);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
  return `${day} · ${time} UTC`;
}

function secondaryIntentLabel(
  intent: PredictionMarketCapDisplayIntentV2 | null,
) {
  if (!intent) return null;
  const change = intent.template === "percent-change" && intent.percentChange
    ? ` · ${formatPercentChange(intent.percentChange)} from start`
    : "";
  return `Market-cap intent · ≥ ${formatCanonicalUsd(intent.targetUsd)}${change} · Price settles`;
}

function normalizeIdentityAddress(
  chain: PredictionV2CreateSourceNetwork,
  address: string,
) {
  return chain === "solana" ? address : address.toLowerCase();
}

function isProfileBoundToReview(
  profile: PredictionTokenProfileV2,
  review: PredictionV2CreateReview,
) {
  const chain = CHAIN_BINDINGS[review.asset.sourceNetwork];
  return profile.chain.id === review.asset.sourceNetwork &&
    profile.chain.reference === chain.reference &&
    profile.chain.label === chain.label &&
    profile.name === review.assetName &&
    profile.symbol === review.assetSymbol &&
    normalizeIdentityAddress(profile.chain.id, profile.address) ===
      normalizeIdentityAddress(review.asset.sourceNetwork, review.asset.address);
}

function safeSocialLink(link: PredictionTokenProfileLinkV2) {
  try {
    const parsed = new URL(link.url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    ) return null;
    const hostname = parsed.hostname.toLowerCase();
    if (
      !hostname.includes(".") ||
      hostname.endsWith(".") ||
      hostname.includes(":") ||
      /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(hostname) ||
      PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) return null;
    if (link.kind === "x" && !X_HOSTS.has(hostname)) return null;
    if (link.kind === "telegram" && !TELEGRAM_HOSTS.has(hostname)) return null;
    return Object.freeze({ kind: link.kind, url: parsed.toString() });
  } catch {
    return null;
  }
}

function safeProfileLinks(
  links: readonly PredictionTokenProfileLinkV2[],
  identityBound = true,
) {
  if (!identityBound) return [];
  const byKind = new Map<
    PredictionTokenProfileLinkV2["kind"],
    PredictionTokenProfileLinkV2
  >();
  for (const link of links) {
    const safe = safeSocialLink(link);
    if (safe && !byKind.has(safe.kind)) byKind.set(safe.kind, safe);
  }
  return [...byKind.values()].sort(
    (left, right) => SOCIAL_ORDER[left.kind] - SOCIAL_ORDER[right.kind],
  );
}

function safeEnrichedArtwork(
  value: unknown,
  fallback: string,
): PredictionMarketAssetCardArtworkV2 {
  if (exactRecordKeys(value, [
    "kind",
    "url",
    "digest",
    "contentType",
    "sourceAssetId",
  ]) && value.contentType === "image/webp" &&
    typeof value.url === "string" &&
    typeof value.digest === "string" &&
    SHA256_PATTERN.test(value.digest)) {
    if (value.kind === "owned-provider-snapshot") {
      const match = OWNED_ARTWORK_PATTERN.exec(value.url);
      if (match && value.digest === `sha256:${match[1]}` &&
        typeof value.sourceAssetId === "string" &&
        /^[0-9a-f]{64}$/u.test(value.sourceAssetId)) {
        return Object.freeze({
          source: value.url,
          fallback,
          sourceKind: "owned-provider-snapshot",
        });
      }
    } else if (
      value.kind === "bundled-fallback" &&
      BUNDLED_ARTWORK_PATTERN.test(value.url) &&
      value.sourceAssetId === null
    ) {
      return Object.freeze({
        source: value.url,
        fallback,
        sourceKind: "bundled-fallback",
      });
    }
  }
  return Object.freeze({
    source: fallback,
    fallback,
    sourceKind: "bundled-fallback",
  });
}

function safeDisplayIntent(
  value: unknown,
  strikeUsd: string,
): PredictionMarketCapDisplayIntentV2 | null {
  if (!exactRecordKeys(value, [
    "kind",
    "settlementRole",
    "comparator",
    "targetUsd",
    "template",
    "percentChange",
    "equivalentPriceStrikeUsd",
    "evidence",
  ]) ||
    value.kind !== "market-cap-equivalent" ||
    value.settlementRole !== "secondary-non-settlement" ||
    value.comparator !== "greater-than-or-equal" ||
    typeof value.targetUsd !== "string" ||
    !/^[1-9]\d*(?:\.\d+)?$/u.test(value.targetUsd) ||
    value.equivalentPriceStrikeUsd !== strikeUsd ||
    (value.template !== "target" && value.template !== "percent-change") ||
    typeof value.evidence !== "object" ||
    value.evidence === null ||
    Array.isArray(value.evidence)
  ) return null;
  if (
    (value.template === "target" && value.percentChange !== null) ||
    (value.template === "percent-change" &&
      (typeof value.percentChange !== "string" ||
        !/^[1-9]\d*(?:\.\d+)?$/u.test(value.percentChange)))
  ) return null;
  return Object.freeze({
    kind: "market-cap-equivalent",
    settlementRole: "secondary-non-settlement",
    comparator: "greater-than-or-equal",
    targetUsd: value.targetUsd,
    template: value.template,
    percentChange: value.percentChange as string | null,
    equivalentPriceStrikeUsd: strikeUsd,
  });
}

function safeEnrichment(
  value: unknown,
  fallback: string,
  strikeUsd: string,
): SafeEnrichmentV2 | null {
  if (value === null) return null;
  if (!exactRecordKeys(value, [
    "source",
    "name",
    "artwork",
    "links",
    "creationIntent",
    "presentationRevision",
    "presentationRevisionHash",
    "observedAt",
    "attestorAddress",
  ]) ||
    value.source !== "release-pinned-attestation" ||
    !isCanonicalUint(value.presentationRevision, MAX_UINT64, true) ||
    typeof value.presentationRevisionHash !== "string" ||
    !SHA256_PATTERN.test(value.presentationRevisionHash) ||
    typeof value.observedAt !== "string" ||
    !Number.isSafeInteger(Date.parse(value.observedAt)) ||
    new Date(Date.parse(value.observedAt)).toISOString() !== value.observedAt ||
    !isCanonicalAddress(value.attestorAddress) ||
    !Array.isArray(value.links)
  ) return null;
  const links = value.links.filter((link): link is PredictionTokenProfileLinkV2 =>
    exactRecordKeys(link, ["kind", "url"]) &&
    (link.kind === "website" || link.kind === "x" || link.kind === "telegram") &&
    typeof link.url === "string"
  );
  const name = typeof value.name === "string" &&
      value.name.trim() === value.name &&
      value.name.length > 0 &&
      value.name.length <= 160
    ? value.name
    : null;
  return Object.freeze({
    name,
    artwork: safeEnrichedArtwork(value.artwork, fallback),
    links: Object.freeze(safeProfileLinks(links)),
    creationIntent: value.creationIntent === null
      ? null
      : safeDisplayIntent(value.creationIntent, strikeUsd),
  });
}

function probabilityFromView(
  normalized: NormalizedPublicBaseV2,
): PredictionMarketAssetCardProbabilityV2 {
  if (normalized.lifecycle.probabilitySource === "yes") {
    return { status: "available", yesProbabilityBps: 10_000 };
  }
  if (normalized.lifecycle.probabilitySource === "no") {
    return { status: "available", yesProbabilityBps: 0 };
  }
  if (normalized.lifecycle.probabilitySource === "unavailable") {
    return { status: "unavailable" };
  }
  return {
    status: "available",
    yesProbabilityBps: normalized.market.poolState.yesProbabilityBps,
  };
}

function probabilityLabel(state: PredictionMarketAssetCardProbabilityV2) {
  if (state.status !== "available") return "Not available";
  const percent = state.yesProbabilityBps / 100;
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(percent)}%`;
}

function unavailablePublicModel(): PredictionMarketAssetCardRenderModelV2 {
  return Object.freeze({
    name: "Market unavailable",
    symbol: "",
    chainLabel: "Unavailable",
    condition: "Market data unavailable",
    secondaryIntent: null,
    resultTime: "Not available",
    artwork: Object.freeze({
      source: BUNDLED_UNAVAILABLE_ARTWORK,
      fallback: BUNDLED_UNAVAILABLE_ARTWORK,
      sourceKind: "bundled-fallback" as const,
    }),
    links: Object.freeze([]),
    href: null,
    status: LIFECYCLE_LABELS.unavailable,
    probability: "Not available",
    runtimeBinding: "unavailable",
  });
}

function publicCardModel(
  market: PredictionV2EnrichedMarketView,
): PredictionMarketAssetCardRenderModelV2 {
  const normalized = normalizePublicBaseV2(market);
  if (!normalized) return unavailablePublicModel();
  const fallback = normalized.market.artwork.url;
  const enrichment = safeEnrichment(
    normalized.market.enrichment,
    fallback,
    normalized.strikeUsd,
  );
  const name = enrichment?.name ??
    normalized.market.asset.name ??
    normalized.market.asset.symbol;
  return Object.freeze({
    name,
    symbol: normalized.market.asset.symbol,
    chainLabel: normalized.market.asset.chainLabel,
    condition: priceConditionLabel(normalized.strikeUsd),
    secondaryIntent: secondaryIntentLabel(
      enrichment?.creationIntent ?? null,
    ),
    resultTime: formatResultTime(normalized.market.condition.observationUtc),
    artwork: enrichment?.artwork ?? Object.freeze({
      source: fallback,
      fallback,
      sourceKind: "bundled-fallback" as const,
    }),
    links: enrichment?.links ?? Object.freeze([]),
    href: marketHrefFromId(normalized.market.marketId),
    status: LIFECYCLE_LABELS[normalized.lifecycle.label],
    probability: probabilityLabel(probabilityFromView(normalized)),
    runtimeBinding: "bound",
    snapshotBlock: normalized.market.onchain.confirmedBlockNumber,
  });
}

function socialLabel(kind: PredictionTokenProfileLinkV2["kind"]) {
  if (kind === "website") return "Website";
  if (kind === "telegram") return "Telegram";
  return "X";
}

function TelegramBrandIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.8 3.2 19.5 20.1c-.25 1.2-.91 1.5-1.85.94l-5.03-3.71-2.43 2.34c-.27.27-.5.5-1.02.5l.36-5.13 9.34-8.44c.41-.36-.09-.56-.63-.2L6.7 13.67l-4.98-1.56c-1.08-.34-1.1-1.08.23-1.6L21.36 3c.9-.33 1.69.2 1.44 1.2Z"
      />
    </svg>
  );
}

function SocialIcon({ kind }: Readonly<{ kind: PredictionTokenProfileLinkV2["kind"] }>) {
  if (kind === "website") return <WebsiteLinkIcon />;
  if (kind === "telegram") return <TelegramBrandIcon />;
  return <XBrandIcon />;
}

function PredictionMarketAssetCardFrameV2({
  model,
  headingLevel,
  imageLoading,
  className,
  variant,
}: Readonly<{
  model: PredictionMarketAssetCardRenderModelV2;
  headingLevel: PredictionMarketAssetCardHeadingLevelV2;
  imageLoading: "eager" | "lazy";
  className?: string;
  variant: "public" | "preview";
}>) {
  const Heading = headingLevel === "h2" ? "h2" : "h3";
  const visibleLinks = model.links.filter((link) => !isGitHubUrl(link.url));
  const primaryContent = (
    <>
      <div className={styles.art}>
        {/* Artwork is either owned, bundled, or routed through the fixed preview proxy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          className={styles.image}
          decoding="async"
          draggable={false}
          height={300}
          loading={imageLoading}
          onError={(event) => {
            applyTokenImageFallback(event.currentTarget, model.artwork.fallback);
          }}
          referrerPolicy="no-referrer"
          src={model.artwork.source}
          width={726}
        />
      </div>

      <div className={styles.body}>
        <header className={styles.heading}>
          <Heading title={model.name}>{model.name}</Heading>
          {model.symbol ? <span>${model.symbol}</span> : null}
        </header>
        <p className={styles.condition} title={model.condition}>
          {model.condition}
        </p>
        {model.secondaryIntent ? (
          <p className={styles.secondaryIntent}>{model.secondaryIntent}</p>
        ) : null}
        <dl className={styles.facts}>
          <div>
            <dt>Result time</dt>
            <dd>{model.resultTime}</dd>
          </div>
          <div>
            <dt>Probability</dt>
            <dd>{model.probability}</dd>
          </div>
        </dl>
      </div>
    </>
  );

  return (
    <article
      className={`${styles.card}${className ? ` ${className}` : ""}`}
      data-artwork-source={model.artwork.sourceKind}
      data-prediction-asset-card-v2={variant === "public" ? "" : undefined}
      data-prediction-asset-preview-card-v2={variant === "preview" ? "" : undefined}
      data-profile-bound={model.profileBound === undefined
        ? undefined
        : model.profileBound ? "true" : "false"}
      data-runtime-binding={model.runtimeBinding}
      data-snapshot-block={model.snapshotBlock}
    >
      {model.href ? (
        <Link
          aria-label={`Open ${model.name} prediction: ${model.condition}; result at ${model.resultTime}`}
          className={styles.hitArea}
          href={model.href}
        >
          {primaryContent}
        </Link>
      ) : (
        <div className={styles.hitArea}>{primaryContent}</div>
      )}

      <footer className={styles.meta}>
        <dl aria-label="Market summary" className={styles.metaFacts}>
          <div>
            <dt>Status</dt>
            <dd>{model.status}</dd>
          </div>
          <div>
            <dt>Source chain</dt>
            <dd>{model.chainLabel}</dd>
          </div>
        </dl>
        {visibleLinks.length > 0 ? (
          <nav aria-label={`${model.name} links`} className={styles.socials}>
            {visibleLinks.map((link) => {
              const label = socialLabel(link.kind);
              return (
                <a
                  aria-label={`${model.name} ${label} (opens in a new tab)`}
                  className={styles.socialLink}
                  href={link.url}
                  key={link.kind}
                  rel="noopener noreferrer nofollow ugc"
                  target="_blank"
                  title={label}
                >
                  <SocialIcon kind={link.kind} />
                </a>
              );
            })}
          </nav>
        ) : null}
      </footer>
    </article>
  );
}

export function PredictionMarketAssetCardV2({
  market,
  headingLevel = "h3",
  imageLoading = "lazy",
  className,
}: PredictionMarketAssetCardV2Props) {
  return (
    <PredictionMarketAssetCardFrameV2
      className={className}
      headingLevel={headingLevel}
      imageLoading={imageLoading}
      model={publicCardModel(market)}
      variant="public"
    />
  );
}

/**
 * Create-only adapter. It may consume discovery metadata, but it produces no
 * public route and keeps the canonical price predicate visually primary.
 */
export function PredictionMarketAssetPreviewCardV2({
  profile,
  review,
  logoProxy,
  headingLevel = "h3",
  imageLoading = "lazy",
  className,
}: PredictionMarketAssetPreviewCardV2Props) {
  const profileBound = isProfileBoundToReview(profile, review);
  const fallback = predictionAssetCardImageV2({
    chainId: review.asset.sourceNetwork,
    address: review.asset.address,
  }).source;
  const cardImage = predictionAssetCardImageV2({
    chainId: review.asset.sourceNetwork,
    address: review.asset.address,
    logoUrl: profileBound ? profile.logoUrl : undefined,
    logoProxy: profileBound ? logoProxy : null,
  });
  const previewIntent = review.selectedMetric === "market-cap"
    ? Object.freeze({
      kind: "market-cap-equivalent" as const,
      settlementRole: "secondary-non-settlement" as const,
      comparator: "greater-than-or-equal" as const,
      targetUsd: review.metricTargetUsd,
      template: review.template,
      percentChange: review.percentChange,
      equivalentPriceStrikeUsd: review.protocolPredicate.strikeUsd,
    })
    : null;
  const model = Object.freeze({
    name: review.assetName,
    symbol: review.assetSymbol,
    chainLabel: CHAIN_BINDINGS[review.asset.sourceNetwork].label,
    condition: priceConditionLabel(review.protocolPredicate.strikeUsd),
    secondaryIntent: secondaryIntentLabel(previewIntent),
    resultTime: formatResultTime(review.protocolPredicate.observationUtc),
    artwork: Object.freeze({
      source: cardImage.source,
      fallback,
      sourceKind: cardImage.usesProviderLogo
        ? "preview-proxy" as const
        : "bundled-fallback" as const,
    }),
    links: Object.freeze(safeProfileLinks(profile.links ?? [], profileBound)),
    href: null,
    status: "Preview",
    probability: "Not available",
    profileBound,
    runtimeBinding: "preview",
  } satisfies PredictionMarketAssetCardRenderModelV2);
  return (
    <PredictionMarketAssetCardFrameV2
      className={className}
      headingLevel={headingLevel}
      imageLoading={imageLoading}
      model={model}
      variant="preview"
    />
  );
}
