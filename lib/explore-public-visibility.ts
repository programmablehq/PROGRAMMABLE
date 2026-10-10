type EvidenceBoundExploreExclusionV1 = Readonly<{
  identity: string;
  evidence: string;
  kind: "release-canary-token";
}>;

/**
 * Discovery exclusions are limited to identities that the repository's
 * canonical release evidence explicitly classifies as canaries. Display
 * names, symbols, creators, liquidity and market activity are deliberately
 * excluded from this policy because none of them proves launch intent.
 */
export const NON_PUBLIC_EXPLORE_IDENTITIES_V1 = Object.freeze({
  tokens: Object.freeze([
    Object.freeze({
      identity: "0xB382f738a99820276FD66EfB94b75Eca104c2B4D",
      evidence:
        "contracts/deployments/mainnet-classic-v4.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0xFA5D9694D9f8fa47b8A6c15Df4510b76cb844e2c",
      evidence:
        "contracts/deployments/mainnet-classic-v3.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x3a778578b3a21dd842c29be3d1816b1af37d54f3",
      evidence:
        "contracts/deployments/mainnet-deep-full-range-v1.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x3C82787014931BD11b9edb789E42F92d792Dd07f",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v1.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x369f5fa21942560c42Ba9FDb8a156F5C962BD2eC",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v2.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x2C348590Cb56Fcc5984F035D57bdb01e32c945D5",
      evidence:
        "contracts/deployments/mainnet-stock-paired-v3.json#lifecycleEvidence.canaryToken",
      kind: "release-canary-token" as const,
    }),
    Object.freeze({
      identity: "0x9DEeB39D2590b0cAD5fc473F755C5F97Dcc8f7cE",
      evidence:
        "components/launch-stamp-docs-contract.ts#PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter.canaryEvidence.components.token",
      kind: "release-canary-token" as const,
    }),
  ] satisfies readonly EvidenceBoundExploreExclusionV1[]),
});

const NON_PUBLIC_TOKEN_ADDRESSES = new Set(
  NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.map(({ identity }) =>
    identity.toLowerCase()),
);

// Owner-requested discovery exclusions are separate from release canaries.
// A matching address on another chain and future verified launches stay visible.
export const OWNER_HIDDEN_EXPLORE_IDENTITIES_V1 = Object.freeze([
  Object.freeze({ chainId: 4663, identity: "0x734b0dc83c29b9da80d5c733815f705a8b6f9d5e" }), // Manual-review checkpoint release check
  Object.freeze({ chainId: 4663, identity: "0x8b69fd6e401039e45444eea5d99e59a4122d859a" }), // Source-verification release check
  Object.freeze({ chainId: 4663, identity: "0xf9261d85c503927bf70916a6594a33979e614ec3" }), // Replacement admission API release check
  Object.freeze({ chainId: 4663, identity: "0x2a0836901fd30be8de47b9c199c6acf2ba372305" }), // Economic module API release check
  Object.freeze({ chainId: 4663, identity: "0x7a73888170d3de8e10ebd78d4e6a685eaa92c9f4" }),
  Object.freeze({ chainId: 4663, identity: "0x76f71862c7646c3f6a54312a0889097a7334a8c0" }), // Compiler and atomic-stamp release canary
  Object.freeze({ chainId: 1, identity: "0x1a6a3948b0c54670b634dd2a54598793ee192895" }),
  Object.freeze({ chainId: 1, identity: "0xe2f175af5edf2ba4793ecdad94888fcdc5e1ab5f" }),
  Object.freeze({ chainId: 1, identity: "0xface73b63787960282f2d4682d3752beb25271ad" }),
  Object.freeze({ chainId: 1, identity: "0x705f60fadb9728ca976e727ae9d746cc4d303be2" }), // ETH 3.6 release canary
  Object.freeze({ chainId: 1, identity: "0xbb73f3bb5cfae5629f0a6a58bb10ab1e35e4c11a" }), // Atomic module-stamp release canary
  Object.freeze({ chainId: 1, identity: "0x2bbc1677a495746a7fad51851dcba8bc37c5a213" }), // WECWDCWDE
]);
/**
 * Controls only public discovery. Direct token lookup remains available so
 * historical evidence and exact-address access are preserved.
 */
export function isPublicExploreIdentityV1(
  identity: Readonly<{ tokenAddress?: string }>,
  chainId: number = 1,
): boolean {
  if (
    typeof identity.tokenAddress === "string" &&
    NON_PUBLIC_TOKEN_ADDRESSES.has(identity.tokenAddress.toLowerCase())
  ) {
    return false;
  }
  if (OWNER_HIDDEN_EXPLORE_IDENTITIES_V1.some(hidden => hidden.chainId === chainId
    && hidden.identity === identity.tokenAddress?.toLowerCase())) return false;
  return true;
}
