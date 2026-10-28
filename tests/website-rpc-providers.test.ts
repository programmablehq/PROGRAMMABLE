import { describe, expect, it } from "vitest";

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import {
  WEBSITE_MAINNET_RPC_ENV,
  WEBSITE_MAINNET_READ_RPC_ENV,
  productionMainnetRpcPrimary,
  productionMainnetRpcPair,
  productionMainnetReadRpcPair,
  productionRecoveryMainnetRpcPair,
  websiteMainnetRpcPair,
} from "../lib/onchain/website-rpc-providers.server";

const ALCHEMY_URL =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-test-key";
const DRPC_URL = "https://lb.drpc.live/ethereum/drpc-test-key";
const QUICKNODE_URL =
  "https://programmable-mainnet.ethereum-mainnet.quiknode.pro/quicknode-test-key/";
const TENDERLY_RECOVERY_URL = "https://mainnet.gateway.tenderly.co/";

function environment(input?: Readonly<{
  primaryProvider?: string;
  primaryUrl?: string;
  primaryCommitment?: string;
  secondaryProvider?: string;
  secondaryUrl?: string;
  secondaryCommitment?: string;
}>) {
  return {
    [WEBSITE_MAINNET_RPC_ENV.primaryProvider]:
      input?.primaryProvider ?? "drpc",
    [WEBSITE_MAINNET_RPC_ENV.primaryUrl]:
      input?.primaryUrl ?? DRPC_URL,
    [WEBSITE_MAINNET_RPC_ENV.primaryCommitment]:
      input?.primaryCommitment ??
      rpcProviderCommitment("endpoint", input?.primaryUrl ?? DRPC_URL),
    [WEBSITE_MAINNET_RPC_ENV.secondaryProvider]:
      input?.secondaryProvider ?? "quicknode",
    [WEBSITE_MAINNET_RPC_ENV.secondaryUrl]:
      input?.secondaryUrl ?? QUICKNODE_URL,
    [WEBSITE_MAINNET_RPC_ENV.secondaryCommitment]:
      input?.secondaryCommitment ??
      rpcProviderCommitment(
        "endpoint",
        input?.secondaryUrl ?? QUICKNODE_URL,
      ),
  };
}

describe("Website Mainnet RPC provider bindings", () => {
  it("binds a dRPC primary and QuickNode secondary by explicit roles", () => {
    expect(websiteMainnetRpcPair(environment())).toEqual({
      source: "role-bound-v1",
      primary: {
        provider: "drpc",
        url: DRPC_URL,
        endpointCommitment: rpcProviderCommitment("endpoint", DRPC_URL),
      },
      secondary: {
        provider: "quicknode",
        url: QUICKNODE_URL,
        endpointCommitment:
          rpcProviderCommitment("endpoint", QUICKNODE_URL),
      },
    });
  });

  it("binds the authoritative production pair to fixed provider roles", () => {
    expect(productionMainnetRpcPair(environment())).toMatchObject({
      primary: { provider: "drpc" },
      secondary: { provider: "quicknode" },
    });
    expect(() => productionMainnetRpcPair(environment({
      primaryProvider: "quicknode",
      primaryUrl: QUICKNODE_URL,
      secondaryProvider: "alchemy",
      secondaryUrl: ALCHEMY_URL,
    }))).toThrow("Production RPC provider roles are invalid");
  });

  it("isolates the committed Alchemy index primary from production action providers", () => {
    const committed = { ...environment(),
      [WEBSITE_MAINNET_READ_RPC_ENV.primaryProvider]: "alchemy",
      [WEBSITE_MAINNET_READ_RPC_ENV.primaryUrl]: ALCHEMY_URL,
      [WEBSITE_MAINNET_READ_RPC_ENV.primaryCommitment]: rpcProviderCommitment("endpoint", ALCHEMY_URL),
    };
    expect(productionMainnetReadRpcPair(committed)).toMatchObject({
      primary: { provider: "alchemy", url: ALCHEMY_URL },
      secondary: { provider: "quicknode", url: QUICKNODE_URL },
    });
    expect(productionMainnetRpcPair(committed)).toEqual(productionMainnetRpcPair(environment()));
    expect(productionMainnetRpcPrimary(committed)).toEqual({
      provider: "alchemy", url: ALCHEMY_URL,
      endpointCommitment: rpcProviderCommitment("endpoint", ALCHEMY_URL),
    });
    expect(() => productionMainnetReadRpcPair({ ...committed,
      [WEBSITE_MAINNET_READ_RPC_ENV.primaryCommitment]: rpcProviderCommitment("endpoint", DRPC_URL),
    })).toThrow("Website primary RPC endpoint commitment mismatch");
    expect(() => productionMainnetRpcPair(environment({ primaryProvider: "alchemy", primaryUrl: ALCHEMY_URL })))
      .toThrow("Production RPC provider roles are invalid");
  });

  it("rejects partial dedicated read configuration instead of silently falling back", () => {
    expect(() => productionMainnetRpcPrimary({ ...environment(),
      [WEBSITE_MAINNET_READ_RPC_ENV.primaryProvider]: "alchemy",
    })).toThrow();
    expect(productionMainnetReadRpcPair(environment())).toEqual(productionMainnetRpcPair(environment()));
  });

  it("binds recovery reads to the fixed Tenderly and committed QuickNode pair", () => {
    const recovery = productionRecoveryMainnetRpcPair({
      ...environment({ primaryUrl: "https://eth.drpc.org" }),
      ETHEREUM_RPC_URL: DRPC_URL,
      ETHEREUM_RPC_URL_B: DRPC_URL,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", ALCHEMY_URL),
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", QUICKNODE_URL),
    });

    expect(recovery).toEqual({
      source: "fixed-tenderly-quicknode-v1",
      primary: {
        provider: "tenderly",
        url: TENDERLY_RECOVERY_URL,
        endpointCommitment:
          rpcProviderCommitment("endpoint", TENDERLY_RECOVERY_URL),
      },
      secondary: {
        provider: "quicknode",
        url: QUICKNODE_URL,
        endpointCommitment: rpcProviderCommitment("endpoint", QUICKNODE_URL),
      },
    });
  });

  it("ignores recovery aliases and fails closed on QuickNode drift", () => {
    const committed = {
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", QUICKNODE_URL),
    };
    expect(productionRecoveryMainnetRpcPair({
      ...committed,
      ETHEREUM_RPC_URL: ALCHEMY_URL,
      ETHEREUM_RPC_URL_B: DRPC_URL,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: DRPC_URL,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", DRPC_URL),
      PROGRAMMABLE_TENDERLY_MAINNET_RPC_URL: "https://attacker.invalid/",
    })).toMatchObject({
      primary: { provider: "tenderly", url: TENDERLY_RECOVERY_URL },
      secondary: { provider: "quicknode", url: QUICKNODE_URL },
    });
    expect(() => productionRecoveryMainnetRpcPair({
      ...committed,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: DRPC_URL,
    })).toThrow("Website secondary RPC binding is invalid");
    expect(() => productionRecoveryMainnetRpcPair({
      ...committed,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        `0x${"ab".repeat(32)}`,
    })).toThrow("Website secondary RPC endpoint commitment mismatch");
    expect(() => productionRecoveryMainnetRpcPair({})).toThrow(
      "Website secondary RPC binding is unavailable",
    );
  });

  it("binds only the committed dRPC primary without secondary configuration", () => {
    const primaryOnly = {
      [WEBSITE_MAINNET_RPC_ENV.primaryProvider]: "drpc",
      [WEBSITE_MAINNET_RPC_ENV.primaryUrl]: DRPC_URL,
      [WEBSITE_MAINNET_RPC_ENV.primaryCommitment]:
        rpcProviderCommitment("endpoint", DRPC_URL),
    };

    expect(productionMainnetRpcPrimary(primaryOnly)).toEqual({
      provider: "drpc",
      url: DRPC_URL,
      endpointCommitment: rpcProviderCommitment("endpoint", DRPC_URL),
    });
    expect(() => productionMainnetRpcPair(primaryOnly)).toThrow(
      "Website secondary RPC provider binding is invalid",
    );
  });

  it("rejects an unsupported or drifted production primary", () => {
    expect(() => productionMainnetRpcPrimary({
      [WEBSITE_MAINNET_RPC_ENV.primaryProvider]: "quicknode",
      [WEBSITE_MAINNET_RPC_ENV.primaryUrl]: QUICKNODE_URL,
      [WEBSITE_MAINNET_RPC_ENV.primaryCommitment]:
        rpcProviderCommitment("endpoint", QUICKNODE_URL),
    })).toThrow("Production primary RPC provider role is invalid");
    expect(() => productionMainnetRpcPrimary({
      [WEBSITE_MAINNET_RPC_ENV.primaryProvider]: "drpc",
      [WEBSITE_MAINNET_RPC_ENV.primaryUrl]: DRPC_URL,
      [WEBSITE_MAINNET_RPC_ENV.primaryCommitment]: `0x${"ab".repeat(32)}`,
    })).toThrow("Website primary RPC endpoint commitment mismatch");
  });

  it("keeps provider roles interchangeable across the reviewed vendors", () => {
    const selected = websiteMainnetRpcPair(environment({
      primaryProvider: "quicknode",
      primaryUrl: QUICKNODE_URL,
      secondaryProvider: "alchemy",
      secondaryUrl: ALCHEMY_URL,
    }));

    expect(selected).toMatchObject({
      source: "role-bound-v1",
      primary: { provider: "quicknode", url: QUICKNODE_URL },
      secondary: { provider: "alchemy", url: ALCHEMY_URL },
    });
  });

  it("ignores legacy bindings only after a complete role-bound pair is valid", () => {
    const selected = websiteMainnetRpcPair({
      ...environment(),
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", ALCHEMY_URL),
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", QUICKNODE_URL),
    });

    expect(selected.source).toBe("role-bound-v1");
    expect(selected.primary.provider).toBe("drpc");
  });

  it("fails closed on partial role configuration", () => {
    expect(() => websiteMainnetRpcPair({
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER: "drpc",
      PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_URL,
      PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL: QUICKNODE_URL,
    })).toThrow("Website secondary RPC provider binding is invalid");
  });

  it("rejects unknown providers, provider-host drift and public fallbacks", () => {
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "generic",
    }))).toThrow("Website primary RPC provider binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "tenderly",
      primaryUrl: TENDERLY_RECOVERY_URL,
    }))).toThrow("Website primary RPC provider binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "drpc",
      primaryUrl: ALCHEMY_URL,
    }))).toThrow("Website primary RPC binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      primaryProvider: "drpc",
      primaryUrl: "https://eth.drpc.org/",
    }))).toThrow("Website primary RPC binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      secondaryProvider: "quicknode",
      secondaryUrl:
        "https://programmable.base-mainnet.ethereum-mainnet.quiknode.pro/quicknode-test-key/",
    }))).toThrow("Website secondary RPC binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      secondaryProvider: "quicknode",
      secondaryUrl:
        "https://programmable.base-mainnet.quiknode.pro/quicknode-test-key/",
    }))).toThrow("Website secondary RPC binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      secondaryProvider: "quicknode",
      secondaryUrl:
        "https://programmable.ethereum.quiknode.pro/quicknode-test-key/",
    }))).toThrow("Website secondary RPC binding is invalid");
    expect(() => websiteMainnetRpcPair(environment({
      secondaryProvider: "quicknode",
      secondaryUrl:
        "https://programmable.quiknode.pro/quicknode-test-key/",
    }))).toThrow("Website secondary RPC binding is invalid");
  });

  it("requires independent vendor identities, not only distinct URLs", () => {
    const secondary =
      "https://lb.drpc.live/ethereum/second-drpc-test-key";
    expect(() => websiteMainnetRpcPair(environment({
      secondaryProvider: "drpc",
      secondaryUrl: secondary,
    }))).toThrow("Website RPC providers are not independent");
  });

  it("rejects endpoint drift without retaining credentials in errors", () => {
    const candidate = environment({
      primaryCommitment: `0x${"ab".repeat(32)}`,
    });
    const error = (() => {
      try {
        websiteMainnetRpcPair(candidate);
      } catch (value) {
        return value;
      }
      return null;
    })();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Website primary RPC endpoint commitment mismatch",
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("drpc-test-key");
    expect(serialized).not.toContain("quicknode-test-key");
  });
});
