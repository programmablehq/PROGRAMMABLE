import { getAddress, isAddress, parseUnits, type Address } from "viem";
import { CustomAIError } from "./types";
import type { QuoteCheck } from "./quote.server";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { MIN_INITIAL_BUY_ETH_WEI } from "./initial-buy";

export type CoinSettings = { name: string; symbol: string; imageURI: string; chainId: 1 | 4663; quote: Address; initialBuy: string };
export type LaunchPreview = {
  binding: string;
  sourceHash: string;
  artifactHash: string;
  settings: CoinSettings;
  supply: "1000000000";
  startFdvUsd: "15000";
  maximumStartFdvUsd: "15091.50";
  platformFeeBps: 50;
  maximumTotalFeeBps: 1500;
  liquidity: "locked";
  moduleCases: number;
  lifecycle: { status: "passed"; scope: "isolated-core-with-synthetic-quotes"; cases: number; bundleHash: string };
  createdAt: number;
  expiresAt: number;
  quoteCheck?: QuoteCheck;
  quote: { status: "price-checked"; decimals: number; usdE18: string; ethUsdE18: string; initialBuyRaw: string;
    minimumInitialBuyRaw: string; evidenceHash: string; ethEvidenceHash: string }
    | { status: "unavailable"; message: string };
  // No live deployment or full quote-token execution evidence exists for this
  // feature yet. A module test or price read must never create a wallet request.
  canLaunch: false;
  pending: readonly ("core-deployment" | "quote-transfer-and-control-checks" | "quote-price" | "live-launch-trading-checks")[];
};

export function parseCoinSettings(value: unknown): CoinSettings {
  if (!value || typeof value !== "object") throw new CustomAIError("settings", "Add your coin settings.");
  const input = value as Partial<CoinSettings>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const symbol = typeof input.symbol === "string" ? input.symbol.trim() : "";
  if (!name || new TextEncoder().encode(name).length > 48 || /[\u0000-\u001f\u007f]/u.test(name)) throw new CustomAIError("name", "Use a shorter coin name (up to 48 bytes).");
  if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) throw new CustomAIError("symbol", "Use 1–12 letters or numbers for the symbol.");
  const imageURI = typeof input.imageURI === "string" ? input.imageURI.trim() : "";
  try {
    const uri = new URL(imageURI);
    if (!["https:", "ipfs:", "ipns:"].includes(uri.protocol) || !uri.hostname || uri.username || uri.password
      || /[\u0000-\u0020\u007f]/u.test(imageURI) || new TextEncoder().encode(imageURI).length > 2048) throw Error();
  } catch { throw new CustomAIError("image", "Add an HTTPS or IPFS link to your coin image."); }
  if (input.chainId !== 1 && input.chainId !== 4663) throw new CustomAIError("chain", "Choose Ethereum or Robinhood Chain.");
  if (typeof input.quote !== "string" || !isAddress(input.quote) || BigInt(input.quote) < 3n) throw new CustomAIError("quote", "Enter the quote token's ERC20 contract address.");
  if (typeof input.initialBuy !== "string" || !/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,36})?$/.test(input.initialBuy)) {
    throw new CustomAIError("amount", "Enter the initial buy amount in quote tokens.");
  }
  if (!/[1-9]/.test(input.initialBuy)) throw new CustomAIError("initial-buy-minimum", "Minimum 0.01 ETH equivalent");
  if (input.quote.toLowerCase() === foundationChainProfile(input.chainId).wrappedEth.address.toLowerCase()
    && BigInt(initialBuyRaw(input.initialBuy, 18)) < MIN_INITIAL_BUY_ETH_WEI) {
    throw new CustomAIError("initial-buy-minimum", "Minimum 0.01 ETH");
  }
  return { name, symbol, imageURI, chainId: input.chainId, quote: getAddress(input.quote), initialBuy: input.initialBuy };
}

export function initialBuyRaw(amount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new CustomAIError("decimals", "This quote token has unsupported decimals.");
  // viem rounds excess precision; financial input must be rejected instead.
  if ((amount.split(".")[1]?.length ?? 0) > decimals) throw new CustomAIError("precision", `This quote token supports ${decimals} decimal places.`);
  const value = parseUnits(amount, decimals);
  if (value > (1n << 127n) - 1n) throw new CustomAIError("amount", "This amount exceeds the contract's transaction limit.");
  return value.toString();
}

export function previewMatches(preview: LaunchPreview, sourceHash: string, settings: CoinSettings, now = Date.now()): boolean {
  return preview.sourceHash === sourceHash && preview.expiresAt * 1000 > now
    && JSON.stringify(preview.settings) === JSON.stringify(settings);
}
