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
  return {
    imageUrl: coinImage(current.imageUrl) ?? coinImage(fallback?.imageUrl) ?? safePublicImageUrl(current.imageUrl) ?? null,
    description: current.description?.trim() || fallback?.description || null,
    links: current.links.length ? current.links : fallback?.links ?? [],
  };
}
