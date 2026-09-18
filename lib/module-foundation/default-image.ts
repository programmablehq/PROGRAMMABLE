import type { FoundationImage } from "./ui-types";

/** Versioned first-party artwork for coins whose creator leaves the image empty. */
export const FOUNDATION_DEFAULT_IMAGE: Readonly<FoundationImage> = Object.freeze({
  url: "https://programmable.market/brand/loop/programmable-module-token-default-v1.png",
  sha256: "0xa47c2a4f7d9177fb618b8f67ab38ec29ff1158e44d1f49bf90593fd8a8ee562a",
});

export function isFoundationDefaultImage(image: FoundationImage): boolean {
  return image.url === FOUNDATION_DEFAULT_IMAGE.url && image.sha256 === FOUNDATION_DEFAULT_IMAGE.sha256;
}
