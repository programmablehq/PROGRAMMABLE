import { describe, expect, it } from "vitest";

import ethereumModuleRelease from "../contracts/deployments/ethereum-module-foundation-v1.json";
import classicV3Release from
  "../contracts/deployments/mainnet-classic-v3.json";
import classicV4Release from
  "../contracts/deployments/mainnet-classic-v4.json";
import deepV1Release from
  "../contracts/deployments/mainnet-deep-full-range-v1.json";
import stockPairedV1Release from
  "../contracts/deployments/mainnet-stock-paired-v1.json";
import stockPairedV2Release from
  "../contracts/deployments/mainnet-stock-paired-v2.json";
import stockPairedV3Release from
  "../contracts/deployments/mainnet-stock-paired-v3.json";
import { PROGRAMMABLE_LAUNCH_STAMP_MANIFEST } from
  "../components/launch-stamp-docs-contract";
import {
  isPublicExploreIdentityV1,
  isVisibleExploreQueryIdentityV1,
  NON_PUBLIC_EXPLORE_IDENTITIES_V1,
  OWNER_HIDDEN_EXPLORE_IDENTITIES_V1,
} from "../lib/explore-public-visibility";

function sorted(values: readonly string[]) {
  return [...values].map((value) => value.toLowerCase()).sort();
}

describe("public Explore visibility", () => {
  it("keeps release canaries out of discovery while preserving exact-address evidence lookup", () => {
    const tokenAddress = "0xbf4c2886705a3a88b63bf633512703c346e980cb";
    for (const query of ["", "PMHYPE31", tokenAddress.slice(0, -1)]) {
      expect(isVisibleExploreQueryIdentityV1({ tokenAddress }, 999, query)).toBe(false);
    }
    expect(isVisibleExploreQueryIdentityV1({ tokenAddress }, 999, tokenAddress.toUpperCase())).toBe(true);
    expect(isVisibleExploreQueryIdentityV1({ tokenAddress }, 999, "0x1111111111111111111111111111111111111111")).toBe(false);
    expect(isPublicExploreIdentityV1({ tokenAddress }, 8453)).toBe(true);
  });
  it("binds every excluded token to canonical repository canary evidence", () => {
    const evidencedCanaryTokens = [
      classicV3Release.lifecycleEvidence.canaryToken,
      classicV4Release.lifecycleEvidence.canaryToken,
      deepV1Release.lifecycleEvidence.canaryToken,
      stockPairedV1Release.lifecycleEvidence.canaryToken,
      stockPairedV2Release.lifecycleEvidence.canaryToken,
      stockPairedV3Release.lifecycleEvidence.canaryToken,
      PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter.canaryEvidence
        .components.token,
    ];

    expect(sorted(NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.map(
      ({ identity }) => identity,
    ))).toEqual(sorted(evidencedCanaryTokens));
    expect(NON_PUBLIC_EXPLORE_IDENTITIES_V1.tokens.every(
      ({ kind, evidence }) => kind === "release-canary-token" && evidence.length > 0,
    )).toBe(true);
  });

  it("excludes only exact identities and ignores names, creators, and metadata", () => {
    const canary = classicV3Release.lifecycleEvidence.canaryToken;
    expect(isPublicExploreIdentityV1({ tokenAddress: canary })).toBe(false);
    expect(isPublicExploreIdentityV1({ tokenAddress: canary.toLowerCase() })).toBe(
      false,
    );
    expect(isPublicExploreIdentityV1({
      tokenAddress: "0x1111111111111111111111111111111111111111",
    })).toBe(true);
    expect(isPublicExploreIdentityV1({})).toBe(true);
  });

  it("hides owner-selected launches only from discovery on their chain", () => {
    expect(sorted(OWNER_HIDDEN_EXPLORE_IDENTITIES_V1.map(({ identity }) => identity))).toEqual(expect.arrayContaining(sorted([
      ethereumModuleRelease.lifecycleEvidence.canaryToken,
      ethereumModuleRelease.sdkLifecycleEvidence.canaryToken,
    ])));
    for (const hidden of OWNER_HIDDEN_EXPLORE_IDENTITIES_V1) {
      expect(isPublicExploreIdentityV1({ tokenAddress: hidden.identity })).toBe(hidden.chainId !== 1);
      expect(isPublicExploreIdentityV1({ tokenAddress: hidden.identity.toUpperCase() }, hidden.chainId)).toBe(false);
      expect(isPublicExploreIdentityV1({ tokenAddress: hidden.identity }, hidden.chainId === 1 ? 4663 : 1)).toBe(true);
    }
    expect(isPublicExploreIdentityV1({ tokenAddress: "0x1111111111111111111111111111111111111111" }, 1)).toBe(true);
  });

  it("removes the current internal test points while retaining real DNA and RING launches", () => {
    const dnaToken = [
      "0x39772d019ed525f667a7cbbf8e64b0712",
      "0378402",
    ].join("");
    const ringToken = [
      "0x44ca84cf59183f389aa20848ee8ef5c076bb3",
      "cb7",
    ].join("");
    const hiddenTokens = [
      ["0xd3e63c1a6e9e5946d52e488b90fac394af", "af208b"].join(""), // GUARD2
      ["0x67624555c2bb3627b54ae677b35ba73bf3", "7908c8"].join(""), // Protected Launch Canary
      ["0x72035572d84975cf74d90bcc4b46ceda", "cd4335a2"].join(""), // API Guard Check
      ["0x49885ab6a28b63e21c9c68ddd2946a", "5d034881e0"].join(""), // Custom AI Test on Robinhood
      ["0x9a5c5a7c582d7d7729c7e10b6e65b3", "27e50a77e1"].join(""), // Custom AI Test on Ethereum
    ];
    for (const [index, tokenAddress] of hiddenTokens.entries()) {
      const chainId = index === hiddenTokens.length - 1 ? 1 : 4663;
      expect(isPublicExploreIdentityV1({ tokenAddress }, chainId)).toBe(false);
    }
    expect(isPublicExploreIdentityV1({
      tokenAddress: dnaToken, // DNA
    }, 1)).toBe(true);
    expect(isPublicExploreIdentityV1({
      tokenAddress: ringToken, // RING
    }, 1)).toBe(true);
  });

});
