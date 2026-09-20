import { getAddress, hexToString, type Address } from "viem";
import { sanitizeSocialUrl, sanitizeWebsiteUrl, type SocialMetadataKind } from "@/lib/onchain/metadata";
import type { FoundationPoolDetails } from "./readback";
import { FOUNDATION_INFRASTRUCTURE } from "./constants";
import type { FoundationPoolIdentity, FoundationPositionIdentity } from "./ui-types";
import type { prepareFoundationLaunch } from "./client";
import { assertFoundationV2Result, foundationFactoryVersion } from "./protocol";

export function foundationPoolPresentation(details: FoundationPoolDetails): FoundationPoolIdentity {
  return { ...details.key, poolId: details.pool.poolId, poolManager: FOUNDATION_INFRASTRUCTURE.poolManager.address };
}
export function foundationPositionPresentation(details: FoundationPoolDetails): FoundationPositionIdentity[] {
  const result: FoundationPositionIdentity[] = [];
  for (const [kind, position] of Object.entries(details.positions)) {
    if (!position || position.status !== "active" || !position.owner || position.tickLower === null || position.tickUpper === null) continue;
    const dead = position.custody === "dead-v1";
    result.push({ label: kind === "base" ? "Permanent launch liquidity" : dead ? "Additional liquidity at DEAD" : "Additional creator liquidity",
      positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address, tokenId: position.positionId.toString(),
      owner: position.owner, tickLower: position.tickLower, tickUpper: position.tickUpper,
      custody: dead ? "dead-v1" : kind === "base" ? "permanent-vault-v1" : "wallet-owned-v1",
      ownershipDescription: dead ? "This NFT was minted directly to DEAD. Principal and any accrued LP-position proceeds are irretrievable. Separate hook fee claims remain available."
        : kind === "base" ? "The immutable base vault holds this NFT. Principal cannot be withdrawn."
          : "This separate NFT can be withdrawn or transferred by its current owner." });
  }
  return result;
}
/** Predicted identities from the source-bound simulation; mined IDs are established by the receipt reader. */
export function foundationLaunchPositionPresentation(sequence: Awaited<ReturnType<typeof prepareFoundationLaunch>>, account: Address): FoundationPositionIdentity[] {
  if (getAddress(account) !== getAddress(sequence.account) || sequence.result.factoryVersion !== foundationFactoryVersion(sequence.binding)) throw new Error("The launch position presentation belongs to another wallet or source version.");
  const result = sequence.result, dead = result.factoryVersion !== "v1";
  if (dead) assertFoundationV2Result(result, sequence.parameters);
  const items: FoundationPositionIdentity[] = [{
    label: "Permanent launch liquidity", positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address,
    tokenId: result.basePositionId.toString(), owner: result.factoryVersion !== "v1" ? result.basePositionOwner : result.baseVault,
    tickLower: sequence.price.base.tickLower, tickUpper: sequence.price.base.tickUpper,
    custody: dead ? "dead-v1" : "permanent-vault-v1",
    ownershipDescription: dead ? "Minted directly to DEAD. The principal and any LP-position proceeds are irretrievable."
      : "The immutable base vault holds this NFT. Principal cannot be withdrawn.",
  }];
  if (result.creatorPositionId > 0n && sequence.price.creator) items.push({
    label: dead ? "Additional liquidity at DEAD" : "Additional creator liquidity",
    positionManager: FOUNDATION_INFRASTRUCTURE.positionManager.address, tokenId: result.creatorPositionId.toString(),
    owner: result.factoryVersion !== "v1" ? result.creatorPositionOwner : getAddress(account),
    tickLower: sequence.price.creator.tickLower, tickUpper: sequence.price.creator.tickUpper,
    custody: dead ? "dead-v1" : "wallet-owned-v1",
    ownershipDescription: dead ? "Minted directly to DEAD. Additional quote invested as principal and any LP-position proceeds are irretrievable. Separate hook creator fees remain claimable."
      : "This separate NFT is minted to the creator and can be transferred or withdrawn by its owner.",
  });
  return items;
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
    for (const [key, label] of [["x", "X"], ["telegram", "Telegram"], ["discord", "Discord"], ["github", "GitHub"], ["gitbook", "Docs"]]) {
      const value = data[key]; if (typeof value !== "string") continue;
      const url = sanitizeSocialUrl(key as SocialMetadataKind, value);
      if (url) links.push({ label, url });
    }
  } catch { /* Invalid social bytes are untrusted display content; pool identity stays separate. */ }
  return links;
}
