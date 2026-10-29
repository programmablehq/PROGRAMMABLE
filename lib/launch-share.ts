import { isAddress } from "viem";

export type LaunchShareIdentity = { address: string; chainId: 1 | 4663 | 8453 | 999 };
export type LaunchShareData = LaunchShareIdentity & {
  name: string; symbol: string; href: string; imageDataUrl: string | null;
};

export function launchShareIdentity(address: string, chain: string | null): LaunchShareIdentity | null {
  return isAddress(address) && !/^0x0{40}$/i.test(address) && (chain === "1" || chain === "4663" || chain === "8453" || chain === "999")
    ? { address: address.toLowerCase(), chainId: chain === "999" ? 999 : chain === "8453" ? 8453 : chain === "1" ? 1 : 4663 } : null;
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
  return `${launchShareText(data.name, 80)} is now live on @ProgrammableHQ.\n\n${data.address}`;
}

export function launchShareIntent(data: LaunchShareData) {
  const url = new URL("https://twitter.com/intent/tweet");
  url.searchParams.set("text", launchSharePost(data));
  url.searchParams.set("url", launchShareCoinHref(data));
  return url.href;
}

export function launchShareMetadata(identity: LaunchShareIdentity, name: string | null, _symbol: string | null) {
  const title = launchShareText(name, 100) || "Programmable coin";
  const url = launchShareCoinHref(identity);
  const image = `https://programmable.market/api/launch-share/image?address=${identity.address.toLowerCase()}&chain=${identity.chainId}&v=2`;
  const description = `${title} is now live on @ProgrammableHQ. ${identity.address.toLowerCase()}`;
  return { title: `${launchShareText(name, 100) || identity.address} · Programmable`, description,
    alternates: { canonical: `/token/${identity.address}${identity.chainId === 4663 ? "" : `?chain=${identity.chainId}`}` },
    openGraph: { type: "website" as const, title, description, url,
      images: [{ url: image, width: 1200, height: 630, type: "image/png", alt: `${title} · ${identity.address}` }] },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] } };
}
