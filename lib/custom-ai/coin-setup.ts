import { getAddress, isAddress } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";

export type CoinSetup = {
  name: string;
  symbol: string;
  chainId: 1 | 4663;
  pairToken: string;
  initialBuy: string;
};
export type CoinSetupPatch = Partial<CoinSetup>;
export const EMPTY_COIN_SETUP: CoinSetup = { name: "", symbol: "", chainId: 1, pairToken: "ETH", initialBuy: "0.01" };

export function parseCoinSetupPatch(value: unknown): CoinSetupPatch {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid coin details");
  const input = value as Record<string, unknown>;
  const patch: CoinSetupPatch = {};
  if (input.chainId != null) {
    if (input.chainId !== 1 && input.chainId !== 4663) throw new Error("Choose Ethereum or Robinhood");
    patch.chainId = input.chainId;
  }
  for (const field of ["name", "symbol", "pairToken", "initialBuy"] as const) {
    const raw = input[field];
    if (raw == null) continue;
    if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/u.test(raw)) throw new Error("Invalid coin details");
    const text = raw.trim();
    if (field === "name" && new TextEncoder().encode(text).length > 48) throw new Error("Use a shorter coin name");
    if (field === "symbol" && text && !/^[a-z0-9]{1,12}$/i.test(text)) throw new Error("Use up to 12 letters or numbers for the ticker");
    if (field === "initialBuy" && text && !/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,36})?$/.test(text)) throw new Error("Enter a valid initial buy");
    if (field === "pairToken") {
      if (/^(eth|weth)$/i.test(text)) patch.pairToken = "ETH";
      else if (isAddress(text) && BigInt(text) > 2n) patch.pairToken = getAddress(text);
      else throw new Error("Enter the pair token's contract address");
    } else patch[field] = field === "symbol" ? text.toUpperCase() : text;
  }
  return patch;
}

// Never carry a custom token address or its amount onto another network.
export function applyCoinSetupPatch(current: CoinSetup, patch: CoinSetupPatch): CoinSetup {
  const chainChanged = patch.chainId !== undefined && patch.chainId !== current.chainId;
  const pairToken = patch.pairToken ?? (chainChanged ? "ETH" : current.pairToken);
  const pairChanged = pairToken.toLowerCase() !== current.pairToken.toLowerCase();
  return { ...current, ...patch, pairToken,
    initialBuy: patch.initialBuy ?? (pairChanged || chainChanged && current.pairToken !== "ETH"
      ? pairToken === "ETH" ? "0.01" : "" : current.initialBuy) };
}

export function setupQuoteAddress(setup: CoinSetup) {
  return setup.pairToken === "ETH" ? foundationChainProfile(setup.chainId).wrappedEth.address : getAddress(setup.pairToken);
}

export function coinBio(name: string, hookSummary?: string) {
  return hookSummary ? `${name.trim() || "Your coin"} is a coin with a hook that ${hookSummary.replace(/[.!?]+$/, "")}.`
    : "Describe what your hook should do in the chat";
}
