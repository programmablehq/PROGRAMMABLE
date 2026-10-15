import { isAddress } from "viem";

export type LaunchShareIdentity = { address: string; chainId: 1 | 4663 };
export type LaunchShareData = LaunchShareIdentity & {
  name: string; symbol: string; href: string; imageDataUrl: string | null;
};

export function launchShareIdentity(address: string, chain: string | null): LaunchShareIdentity | null {
  return isAddress(address) && !/^0x0{40}$/i.test(address) && (chain === "1" || chain === "4663")
    ? { address: address.toLowerCase(), chainId: chain === "1" ? 1 : 4663 } : null;
}

/** Accept only known internal coin routes. Wallet preferences never select the chain. */
export function launchShareHref(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const url = new URL(href, "https://programmable.market");
  const match = /^\/(token|modules)\/(0x[\da-f]{40})$/i.exec(url.pathname);
  if (!match) return null;
  const chains = [...url.searchParams.getAll("chain"), ...url.searchParams.getAll("chainId")];
  if (chains.length > 1) return null;
  const identity = launchShareIdentity(match[2], chains[0] ?? (match[1] === "modules" ? "4663" : null));
  return identity ? `/share/${identity.address}?chain=${identity.chainId}` : null;
}

export const launchShareCoinHref = ({ address, chainId }: LaunchShareIdentity) =>
  `https://programmable.market/token/${address.toLowerCase()}?chain=${chainId}`;

export function launchShareText(value: string | null | undefined, limit: number): string {
  const text = (value ?? "").replace(/<[^>]*>/g, "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > limit ? chars.slice(0, limit - 1).join("").trimEnd() + "…" : text;
}

export function launchSharePost(data: LaunchShareData): string {
  const symbol = launchShareText(data.symbol, 24).replace(/^\$+/, "");
  return `${launchShareText(data.name, 80)}${symbol ? ` ($${symbol})` : ""} is now live on Programmable.\n\nCA: ${data.address}`;
}

export function launchShareIntent(data: LaunchShareData) {
  const url = new URL("https://twitter.com/intent/tweet");
  url.searchParams.set("text", launchSharePost(data));
  url.searchParams.set("url", launchShareCoinHref(data));
  return url.href;
}

export function launchShareMetadata(identity: LaunchShareIdentity, name: string | null, symbol: string | null) {
  const title = `${launchShareText(name, 100) || "Programmable coin"}${symbol ? ` ($${launchShareText(symbol, 24).replace(/^\$+/, "")})` : ""}`;
  const url = launchShareCoinHref(identity);
  const image = `https://programmable.market/api/launch-share/image?address=${identity.address.toLowerCase()}&chain=${identity.chainId}`;
  const description = `${title} is live on Programmable. CA: ${identity.address.toLowerCase()}`;
  return { title, description, alternates: { canonical: url },
    openGraph: { type: "website" as const, title, description, url,
      images: [{ url: image, width: 1200, height: 630, type: "image/png", alt: `${title} · ${identity.address}` }] },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] } };
}
