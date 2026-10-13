import type { ExploreEntry } from "./tokens";
import { SHARD_PUBLIC_PRESENTATION_V1 } from
  "./custom-launch/router-trade-adapters-v1";

/**
 * Finalized Router identities that remain addressable by their direct token
 * routes but are intentionally not part of the public Explore catalog.
 *
 * The boundary is exact EIP-155 identity, never mutable presentation metadata
 * such as a token name or symbol.
 */
export const PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1 = Object.freeze([
  {
    chainId: 1,
    tokenAddress: "0xD0f3E1e5C985D2b37a66Cf07feCB0d8191c0445F",
    launchId:
      "0x786d3d5cdd0c6ba81621eb01fbcc6b5912556a2d7dbe886431346460afeee197",
  },
  {
    chainId: 1,
    tokenAddress: "0x69D278968AbF120F878F2E1E016Ab615D3686c19",
    launchId:
      "0x6d6ed0e1e69a7cd6afa177e3454c9e32eed61cbd3f855ee56aff1915a6776fc2",
  },
  {
    chainId: 1,
    tokenAddress: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
    launchId:
      "0x5a52180427785716bff0a36218dde89f0459db265d0c2bdfcfde81a8fe733c92",
  },
] as const);

const EXCLUDED_LAUNCH_IDENTITIES = new Set(
  PUBLIC_EXPLORE_CATALOG_EXCLUSIONS_V1.map(
    ({ chainId, tokenAddress, launchId }) =>
      `${chainId}:${tokenAddress.toLowerCase()}:${launchId.toLowerCase()}`,
  ),
);

export function publicExplorePresentationEntryV1<T extends ExploreEntry>(
  entry: T,
): T {
  if (entry.exploreKind !== "token") return entry;
  const provenance = entry.launchStampProvenance;
  // Owner-supplied artwork and social link for this verified, finalized launch.
  // This display correction never creates or changes launch provenance.
  if (provenance?.chainId === 1 &&
    entry.tokenAddress.toLowerCase() === "0x0f8b5b82a8a62137e4ea563a3709fe4ca1ff1a2d" &&
    provenance.launchId.toLowerCase() === "0xe9be322b6fa0eb33eb6978f837e32a9241286d92ea8fb99dc351a1677926e28d" &&
    provenance.stampHash.toLowerCase() === "0x4b6a9c84746647079d7489ca817c8be9145a87329f6293a89b526e17bb5dc21b") {
    return Object.freeze({
      ...entry,
      imageUrl: "/token-images/temo.png",
      links: [
        ...(entry.links ?? []).filter(link => link.kind !== "website" && link.kind !== "x"),
        { kind: "website", url: "https://temo.family/" },
        { kind: "x", url: "https://x.com/temoonchain" },
      ],
    }) as T;
  }
  if (provenance?.chainId === 1 &&
    entry.tokenAddress.toLowerCase() === "0xab40efbaff5a67ec3e273b746ae7bac7d1bc4ae3" &&
    provenance.launchId.toLowerCase() === "0xa0525234d1e19bc5aaaa389652233bd56cc76fabdbb37f4d986966f239861718" &&
    provenance.stampHash.toLowerCase() === "0xeda4426986cb163bf32e262504d3f56deb1c492760ba50be0b03760fcad7ca02") {
    return Object.freeze({
      ...entry,
      imageUrl: "/token-images/hive.png",
      links: [
        ...(entry.links ?? []).filter(link => link.kind !== "website" && link.kind !== "x"),
        { kind: "website", url: "https://www.hiveeth.si/" },
        { kind: "x", url: "https://x.com/Hive_v4" },
      ],
    }) as T;
  }
  if (provenance?.chainId === 1 &&
    entry.tokenAddress.toLowerCase() === "0xf9f7944aa311535fd86b7daa17e6d3e753915bd7" &&
    provenance.launchId.toLowerCase() === "0x41f47f07e4afeba4495130c065d6cf60e4263c2628e03092ccc328a9d29d02b1" &&
    provenance.stampHash.toLowerCase() === "0x25bb83d3b2ec32e8f7af86ff76134dfd3416ed50f216f6ee83bd4144cb84bf0b") {
    return Object.freeze({
      ...entry,
      imageUrl: "/token-images/ethperiment.png",
      links: [
        ...(entry.links ?? []).filter(link => link.kind !== "x"),
        { kind: "x", url: "https://x.com/Ethperiment" },
      ],
    }) as T;
  }
  if (
    provenance === undefined ||
    provenance.chainId !== SHARD_PUBLIC_PRESENTATION_V1.chainId ||
    entry.tokenAddress.toLowerCase() !==
      SHARD_PUBLIC_PRESENTATION_V1.tokenAddress.toLowerCase() ||
    provenance.launchId.toLowerCase() !==
      SHARD_PUBLIC_PRESENTATION_V1.launchId.toLowerCase() ||
    provenance.stampHash.toLowerCase() !==
      SHARD_PUBLIC_PRESENTATION_V1.stampHash.toLowerCase()
  ) return entry;
  return Object.freeze({
    ...entry,
    description: SHARD_PUBLIC_PRESENTATION_V1.description,
    imageUrl: SHARD_PUBLIC_PRESENTATION_V1.imageUrl,
    links: [...SHARD_PUBLIC_PRESENTATION_V1.links],
  }) as T;
}

export function publicExploreCatalogEntriesV1(
  entries: readonly ExploreEntry[],
): readonly ExploreEntry[] {
  return Object.freeze(entries.filter((entry) => {
    if (entry.exploreKind !== "token") return true;
    const provenance = entry.launchStampProvenance;
    if (provenance === undefined) return true;
    const identity = [
      provenance.chainId,
      entry.tokenAddress.toLowerCase(),
      provenance.launchId.toLowerCase(),
    ].join(":");
    return !EXCLUDED_LAUNCH_IDENTITIES.has(identity);
  }));
}
