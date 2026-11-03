import { getAddress, isAddress } from "viem";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { builderChain, builderChains, feeCoreChainId, type BuilderChainId } from "./execution-routing";

export type CoinSetup = {
  name: string;
  symbol: string;
  chainId: BuilderChainId;
  pairToken: string;
  initialBuy: string;
  description?: string;
  website?: string;
  x?: string;
  socialPost?: string;
};
export type CoinSetupPatch = Partial<CoinSetup>;
export const EMPTY_COIN_SETUP: CoinSetup = { name: "", symbol: "", chainId: 1, pairToken: "ETH", initialBuy: "0.01" };

export function parseCoinSetupPatch(value: unknown): CoinSetupPatch {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid coin details");
  const input = value as Record<string, unknown>;
  const patch: CoinSetupPatch = {};
  if (input.chainId != null) {
    if (typeof input.chainId!=="number"||!builderChains.some(chain=>chain.id===input.chainId)) throw new Error("Choose Ethereum, Robinhood, Base or HyperEVM");
    patch.chainId = builderChain(input.chainId).id;
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
      else if (/^(hype|whype)$/i.test(text)) patch.pairToken = "HYPE";
      else if (isAddress(text) && BigInt(text) > 2n) patch.pairToken = getAddress(text);
      else throw new Error("Enter the pair token's contract address");
    } else patch[field] = field === "symbol" ? text.toUpperCase() : text;
  }
  // Empty and partially typed links remain valid private form state. The
  // canonical launch packer validates complete public metadata at preparation.
  for (const field of ["description", "website", "x", "socialPost"] as const) {
    const raw = input[field];
    if (raw == null) continue;
    if (typeof raw !== "string") throw new Error("Invalid coin details");
    const text = raw.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
    const unsafe = field === "description" ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u
      : /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
    if (unsafe.test(text) || new TextEncoder().encode(text).length > (field === "description" ? 4096 : 2048))
      throw new Error(field === "description" ? "Use a shorter public description" : "Use a shorter project link");
    patch[field] = text;
  }
  return patch;
}

/** Early form guidance only; the SDK remains the public metadata authority. */
export function coinPresentationIssue(setup: CoinSetup, field: "description" | "website" | "x" | "socialPost") {
  const value = setup[field]?.normalize("NFC").trim() ?? "";
  if (field === "socialPost" && !value) return "";
  if (field === "description") {
    if (new TextEncoder().encode(value).length < 20 || [...value.matchAll(/[\p{L}\p{N}]/gu)].length < 8)
      return "Add a short public description of your coin";
    if (new TextEncoder().encode(value).length > 4096) return "Use a shorter public description";
    return "";
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !url.hostname.includes(".")
      || /(?:^|\.)(?:localhost|local)\.?$/iu.test(url.hostname) || /^[\d.]+$/u.test(url.hostname)
      || url.hostname.includes(":") || new TextEncoder().encode(value).length > 2048) throw Error();
    if (field === "x" && (url.hostname !== "x.com" || url.search || !/^\/[A-Za-z0-9_]{1,64}$/u.test(url.pathname)))
      return "Use your X profile link, such as https://x.com/your_coin";
    if (field === "socialPost" && (url.hostname !== "x.com" || url.search || !/^\/[A-Za-z0-9_]{1,64}\/status\/[0-9]{1,24}$/u.test(url.pathname)))
      return "Use the direct X post link, such as https://x.com/your_coin/status/123";
    return "";
  } catch { return field === "socialPost" ? "Use a public HTTPS X post link" : field === "website" ? "Add your project's public HTTPS website" : "Add your project's X profile link"; }
}

// Never carry a custom token address or its amount onto another network.
export function applyCoinSetupPatch(current: CoinSetup, patch: CoinSetupPatch): CoinSetup {
  const chainChanged = patch.chainId !== undefined && patch.chainId !== current.chainId;
  const chainId=patch.chainId??current.chainId,native=builderChain(chainId).currency;
  const currencyChanged=builderChain(current.chainId).currency!==native;
  const pairToken = patch.pairToken ?? (chainChanged ? native : current.pairToken);
  if(["ETH","HYPE"].includes(pairToken)&&pairToken!==native)throw new Error(`Use ${native} or a token address on ${builderChain(chainId).name}`);
  const pairChanged = pairToken.toLowerCase() !== current.pairToken.toLowerCase();
  return { ...current, ...patch, pairToken,
    initialBuy: patch.initialBuy ?? (currencyChanged ? "" : pairChanged || chainChanged && current.pairToken !== native
      ? pairToken === "ETH" ? "0.01" : "" : current.initialBuy) };
}

/** Fixed-core quote binding only. General routes resolve native/erc20 currency
 * through their own live profile during submission and preparation. */
export function setupQuoteAddress(setup: CoinSetup) {
  const chainId=feeCoreChainId(setup.chainId);
  return setup.pairToken === "ETH" ? foundationChainProfile(chainId).wrappedEth.address : getAddress(setup.pairToken);
}

export function coinBio(name: string, hookSummary?: string) {
  return hookSummary ? `${name.trim() || "Your coin"} is a coin with a hook that ${hookSummary.replace(/[.!?]+$/, "")}.`
    : "Describe what your hook should do in the chat";
}
