import { hexToString } from "viem";
import { sanitizeSocialUrl, sanitizeWebsiteUrl, type SocialMetadataKind } from "@/lib/onchain/metadata";
import type { FoundationPoolDetails } from "./readback";
import { FOUNDATION_INFRASTRUCTURE } from "./constants";
import type { FoundationPoolIdentity, FoundationPositionIdentity } from "./ui-types";

export function foundationPoolPresentation(details: FoundationPoolDetails): FoundationPoolIdentity {
  return { ...details.key, poolId: details.pool.poolId, poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address };
}
export function foundationPositionPresentation(details: FoundationPoolDetails): FoundationPositionIdentity[] {
  const result: FoundationPositionIdentity[] = [];
  for (const [kind, position] of Object.entries(details.positions)) {
    if (!position || position.status !== "active" || !position.owner || position.tickLower === null || position.tickUpper === null) continue;
    result.push({ label: kind === "base" ? "Permanent launch liquidity" : "Additional creator liquidity",
      positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address, tokenId: position.positionId.toString(),
      owner: position.owner, tickLower: position.tickLower, tickUpper: position.tickUpper,
      ownershipDescription: kind === "base" ? "The immutable base vault holds this NFT. Principal cannot be withdrawn."
        : "This separate NFT can be withdrawn or transferred by its current owner." });
  }
  return result;
}
export function foundationMetadataLinks(details: FoundationPoolDetails) {
  const links: { label: string; url: string }[] = [];
  const website = sanitizeWebsiteUrl(details.token.website);
  if (website) links.push({ label: "Website", url: website });
  try {
    const extra: unknown = JSON.parse(hexToString(details.token.socialData));
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) return links;
    const data = extra as Record<string, unknown>;
    if (data.v !== 1) return links;
    for (const [key, label] of [["x", "X"], ["telegram", "Telegram"], ["discord", "Discord"], ["github", "GitHub"], ["gitbook", "GitBook"]]) {
      const value = data[key]; if (typeof value !== "string") continue;
      const url = sanitizeSocialUrl(key as SocialMetadataKind, value);
      if (url) links.push({ label, url });
    }
  } catch { /* Invalid social bytes are untrusted display content; pool identity stays separate. */ }
  return links;
}

