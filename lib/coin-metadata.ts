import { safePublicImageUrl } from "./safe-public-image-url";

export type CoinMetadata = {
  imageUrl: string | null;
  description: string | null;
  links: readonly { label: string; url: string }[];
};

export function coinImage(image: string | null | undefined): string | null {
  const safe = safePublicImageUrl(image);
  return safe && !safe.includes("/brand/loop/programmable-module-token-default-") ? safe : null;
}

/** A missing provider field is not a request to erase known coin details. */
export function mergeCoinMetadata(current: CoinMetadata, fallback?: CoinMetadata | null): CoinMetadata {
  const aliases: Record<string, string> = { twitter: "x", documentation: "docs", gitbook: "docs" };
  const key = (label: string) => aliases[label.toLowerCase()] ?? label.toLowerCase();
  const labels = new Set(current.links.map(link => key(link.label)));
  return {
    imageUrl: coinImage(current.imageUrl) ?? coinImage(fallback?.imageUrl) ?? safePublicImageUrl(current.imageUrl) ?? null,
    description: current.description?.trim() || fallback?.description || null,
    links: [...current.links, ...(fallback?.links ?? []).filter(link => !labels.has(key(link.label)))],
  };
}
