import { parseEther } from "viem";
import { parseCoinSetupPatch, type CoinSetup } from "./coin-setup";
import type { GeneralDetailField } from "./general-details";

export const COIN_DETAIL_ACTION: Record<GeneralDetailField, string> = {
  name: "Add coin name", symbol: "Add ticker", image: "Add coin image", initialBuy: "Check initial buy",
  description: "Add description", website: "Add project link", x: "Add X profile", socialPost: "Check X post link",
};

export function coinDetailReply(field: GeneralDetailField, locale: "en" | "de") {
  const names: Record<GeneralDetailField, readonly [string, string]> = {
    name: ["a coin name", "den Coin-Namen"], symbol: ["a ticker", "das Ticker-Symbol"], image: ["a coin image", "das Coin-Bild"],
    initialBuy: ["the initial buy", "den Erstkauf"], description: ["a description", "die Beschreibung"],
    website: ["a project link", "den Projekt-Link"], x: ["an X profile", "das X-Profil"], socialPost: ["the X post link", "den X-Post-Link"],
  };
  return locale === "de" ? `Ergänze noch ${names[field][1]}. Das passende Feld ist offen.`
    : `${field === "initialBuy" || field === "socialPost" ? "Check" : "Add"} ${names[field][0]} to continue.`;
}

/** Presentation guidance only. The existing launch service remains authoritative. */
export function feeLaunchDetailIssue(settings: CoinSetup, hasImage: boolean): { field: GeneralDetailField; message: string } | null {
  if (!settings.name.trim()) return { field: "name", message: "Add a name for your coin." };
  if (!settings.symbol.trim()) return { field: "symbol", message: "Add your coin’s ticker." };
  if (!hasImage) return { field: "image", message: "Choose an image for your coin." };
  for (const field of ["name", "symbol", "initialBuy"] as const) {
    try { parseCoinSetupPatch({ [field]: settings[field] }); }
    catch (error) { return { field, message: error instanceof Error ? error.message : "Check this coin detail." }; }
  }
  if (!settings.initialBuy || !/[1-9]/u.test(settings.initialBuy)) return { field: "initialBuy", message: "Enter your initial buy." };
  if (settings.pairToken === "ETH") {
    if ((settings.initialBuy.split(".")[1]?.length ?? 0) > 18) return { field: "initialBuy", message: "Use up to 18 decimal places." };
    if (parseEther(settings.initialBuy) < 10n ** 16n) return { field: "initialBuy", message: "The initial buy starts at 0.01 ETH." };
  }
  return null;
}
