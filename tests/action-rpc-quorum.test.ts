import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import {
  ActionRpcProviderError,
  ActionRpcQuorumError,
  classicV3ActionRpcProviders,
  createCommittedActionRpcProvider,
  createActionRpcQuorum,
  creatorClaimRpcProvider,
  creatorClaimRpcProviders,
  protocolRevenueRpcProviders,
  stockPairedActionRpcProviders,
  tradeActionRpcProvider,
  tradeActionRpcProviders,
} from "../lib/server/action-rpc-quorum.server";
import { mainTokenMigrationRpcProviders } from
  "../lib/server/main-token-migration-rpc-quorum.server";

const ALCHEMY_MAINNET_A =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-key-one";
const ALCHEMY_MAINNET_B =
  "https://eth-mainnet.g.alchemy.com/v2/alchemy-key-two";
const ALCHEMY_SEPOLIA =
  "https://eth-sepolia.g.alchemy.com/v2/alchemy-sepolia-key";
const QUICKNODE_MAINNET =
  "https://quiet-mainnet.ethereum-mainnet.quiknode.pro/quicknode-key-one/";
const QUICKNODE_SEPOLIA_ALIAS =
  "https://quiet-sepolia.ethereum-mainnet.quiknode.pro/quicknode-key-two/";
const INFURA_MAINNET_A =
  "https://mainnet.infura.io/v3/infura-key-one";
const INFURA_MAINNET_B =
  "https://mainnet.infura.io/v3/infura-key-two";
const DRPC_PAID_MAINNET =
  "https://lb.drpc.live/ethereum/drpc-key-one";

function productionPairEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
) {
  return {
    PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER: "drpc",
    PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL: DRPC_PAID_MAINNET,
    PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT:
      rpcProviderCommitment("endpoint", DRPC_PAID_MAINNET),
    PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER: "quicknode",
    PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL: QUICKNODE_MAINNET,
    PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT:
      rpcProviderCommitment("endpoint", QUICKNODE_MAINNET),
    ...overrides,
  };
}

function expectSafeFailure(run: () => unknown, secret: string) {
  try {
    run();
    throw new Error("expected RPC quorum failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ActionRpcQuorumError);
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  }
}

function expectIndependent(
  providers: ReturnType<typeof createActionRpcQuorum>,
) {
  expect(providers.length).toBeGreaterThanOrEqual(2);
  expect(new Set(providers.map((provider) => provider.vendorGroup)).size).toBe(
    providers.length,
  );
  expect(
    new Set(
      providers.map((provider) => provider.endpointOriginCommitment),
    ).size,
  ).toBe(providers.length);
}

describe("action RPC provider identity", () => {
  it("keeps trading and claim providers independent of the public index primary", () => {
    const current = productionPairEnvironment();
    const readsMoved = { ...current,
      PROGRAMMABLE_WEBSITE_MAINNET_READ_RPC_PRIMARY_PROVIDER: "alchemy",
      PROGRAMMABLE_WEBSITE_MAINNET_READ_RPC_PRIMARY_URL: ALCHEMY_MAINNET_A,
      PROGRAMMABLE_WEBSITE_MAINNET_READ_RPC_PRIMARY_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", ALCHEMY_MAINNET_A),
    };
    expect(tradeActionRpcProvider(1, readsMoved)).toEqual(tradeActionRpcProvider(1, current));
    expect(tradeActionRpcProviders(1, readsMoved)).toEqual(tradeActionRpcProviders(1, current));
    expect(creatorClaimRpcProvider({ chainId: 1 }, readsMoved)).toEqual(creatorClaimRpcProvider({ chainId: 1 }, current));
    expect(protocolRevenueRpcProviders(readsMoved)).toEqual(protocolRevenueRpcProviders(current));
  });

  it("keeps transport credentials non-enumerable and error output redacted", () => {
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: ALCHEMY_MAINNET_A,
      secondary: QUICKNODE_MAINNET,
    });

    expectIndependent(providers);
    expect(providers[0]?.endpoint).toBe(ALCHEMY_MAINNET_A);
    expect(Object.keys(providers[0] ?? {})).not.toContain("endpoint");
    expect(JSON.stringify(providers)).not.toContain("alchemy-key-one");
    expect(JSON.stringify(providers)).not.toContain("quicknode-key-one");

    expectSafeFailure(
      () =>
        createActionRpcQuorum({
          chainId: 1,
          primary: `https://user:super-secret@eth.drpc.org`,
          secondary: "https://ethereum-rpc.publicnode.com",
        }),
      "super-secret",
    );
  });

  it("rejects API-key aliases from the same provider origin", () => {
    expectSafeFailure(
      () =>
        createActionRpcQuorum({
          chainId: 1,
          primary: ALCHEMY_MAINNET_A,
          secondary: ALCHEMY_MAINNET_B,
        }),
      "alchemy-key-two",
    );
  });

  it("rejects different origins that still belong to the same vendor", () => {
    expect(() =>
      createActionRpcQuorum({
        chainId: 11_155_111,
        primary: QUICKNODE_MAINNET,
        secondary: QUICKNODE_SEPOLIA_ALIAS,
      }),
    ).toThrow(ActionRpcQuorumError);
  });

  it("fails closed for unknown providers and wrong-network endpoints", () => {
    expect(() =>
      createActionRpcQuorum({
        chainId: 1,
        primary: "https://rpc-one.example/api-key-one",
        secondary: "https://rpc-two.example/api-key-two",
      }),
    ).toThrow(ActionRpcQuorumError);
    expect(() =>
      createActionRpcQuorum({
        chainId: 11_155_111,
        primary: "https://ethereum-rpc.publicnode.com",
        secondary: "https://rpc.sepolia.org",
      }),
    ).toThrow(ActionRpcQuorumError);
  });

  it("does not give an alias fallback another quorum vote", () => {
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: DRPC_PAID_MAINNET,
      secondary: QUICKNODE_MAINNET,
      fallbacks: [
        "https://eth.drpc.org",
        "https://ethereum-rpc.publicnode.com",
      ],
    });

    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "quicknode",
      "publicnode",
    ]);
  });

  it("accepts the fixed independent Mainnet archive witnesses", () => {
    const providers = createActionRpcQuorum({
      chainId: 1,
      primary: "https://rpc.mevblocker.io",
      secondary: "https://mainnet.gateway.tenderly.co",
    });

    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "mevblocker",
      "tenderly",
    ]);
  });
});

describe("single committed action RPC", () => {
  it("binds one private provider without exposing its endpoint", () => {
    const provider = createCommittedActionRpcProvider({
      chainId: 1,
      endpoint: DRPC_PAID_MAINNET,
      endpointCommitment: rpcProviderCommitment(
        "endpoint",
        DRPC_PAID_MAINNET,
      ),
    });

    expect(provider.vendorGroup).toBe("drpc");
    expect(provider.endpoint).toBe(DRPC_PAID_MAINNET);
    expect(Object.keys(provider)).not.toContain("endpoint");
    expect(JSON.stringify(provider)).not.toContain("drpc-key-one");
  });

  it("rejects public providers and commitment drift", () => {
    expect(() =>
      createCommittedActionRpcProvider({
        chainId: 1,
        endpoint: "https://ethereum-rpc.publicnode.com",
        endpointCommitment: rpcProviderCommitment(
          "endpoint",
          "https://ethereum-rpc.publicnode.com",
        ),
      }),
    ).toThrow(ActionRpcProviderError);
    expect(() =>
      createCommittedActionRpcProvider({
        chainId: 1,
        endpoint: DRPC_PAID_MAINNET,
        endpointCommitment: `0x${"00".repeat(32)}`,
      }),
    ).toThrow(ActionRpcProviderError);
  });

  it("uses only the role-bound Mainnet primary for trades and claims", () => {
    const env = productionPairEnvironment({
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL:
        "not-a-valid-secondary",
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT:
        "not-a-commitment",
    });

    const tradeProvider = tradeActionRpcProvider(1, env);
    const claimProvider = creatorClaimRpcProvider({ chainId: 1 }, env);
    expect(tradeProvider.endpointCommitment).toBe(
      rpcProviderCommitment("endpoint", DRPC_PAID_MAINNET),
    );
    expect(claimProvider.endpointCommitment).toBe(
      tradeProvider.endpointCommitment,
    );
  });
});

describe("action-route RPC quorums", () => {
  it("isolates migration from the shared QuickNode witness", () => {
    const providers = mainTokenMigrationRpcProviders(
      productionPairEnvironment({
        PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL:
          "not-a-valid-secondary",
        PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT:
          "not-a-commitment",
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_MAINNET_A,
        PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
          rpcProviderCommitment("endpoint", ALCHEMY_MAINNET_A),
      }),
    );

    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "alchemy",
    ]);
    expect(Object.keys(providers[1] ?? {})).not.toContain("endpoint");
  });

  it("fails migration closed without the exact Alchemy commitment", () => {
    expectSafeFailure(
      () =>
        mainTokenMigrationRpcProviders(
          productionPairEnvironment({
            PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL: ALCHEMY_MAINNET_A,
            PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT:
              `0x${"00".repeat(32)}`,
          }),
        ),
      "alchemy-key-one",
    );
  });

  it("requires independent providers for trade preparation", () => {
    const providers = tradeActionRpcProviders(
      1,
      productionPairEnvironment(),
    );
    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "quicknode",
    ]);

    expectSafeFailure(
      () =>
        tradeActionRpcProviders(
          1,
          productionPairEnvironment({
            PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL:
              ALCHEMY_MAINNET_A,
          }),
        ),
      "alchemy-key-one",
    );
  });

  it("binds protocol revenue to the shared private production pair", () => {
    const providers = protocolRevenueRpcProviders(productionPairEnvironment({
      ETHEREUM_RPC_URL: ALCHEMY_MAINNET_A,
      ETHEREUM_RPC_URL_B: ALCHEMY_MAINNET_B,
    }));

    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "quicknode",
    ]);
  });

  it("rejects legacy protocol-revenue aliases", () => {
    expectSafeFailure(
      () =>
        protocolRevenueRpcProviders({
          PROTOCOL_REVENUE_RPC_URL_A: ALCHEMY_MAINNET_A,
          PROTOCOL_REVENUE_RPC_URL_B: QUICKNODE_MAINNET,
        }),
      "alchemy-key-one",
    );
  });

  it("requires independent providers for creator claims", () => {
    const providers = creatorClaimRpcProviders({
      chainId: 1,
      rpcUrl: DRPC_PAID_MAINNET,
      rpcUrlSecondary: QUICKNODE_MAINNET,
    });
    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "quicknode",
    ]);

    expectSafeFailure(
      () =>
        creatorClaimRpcProviders({
          chainId: 1,
          rpcUrl: ALCHEMY_MAINNET_A,
          rpcUrlSecondary: ALCHEMY_MAINNET_B,
        }),
      "alchemy-key-two",
    );
  });

  it("requires independent providers for Classic V3 actions", () => {
    const providers = classicV3ActionRpcProviders(
      "production",
      productionPairEnvironment(),
    );
    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "quicknode",
    ]);

    expectSafeFailure(
      () =>
        classicV3ActionRpcProviders("production", {
          ETHEREUM_RPC_URL: INFURA_MAINNET_A,
          ETHEREUM_RPC_URL_B: INFURA_MAINNET_B,
        }),
      "infura-key-one",
    );
  });

  it("cannot form a Stock-Paired majority from same-provider aliases", () => {
    const providers = stockPairedActionRpcProviders(
      productionPairEnvironment(),
    );
    expectIndependent(providers);
    expect(providers.map((provider) => provider.vendorGroup)).toEqual([
      "drpc",
      "quicknode",
    ]);

    expectSafeFailure(
      () =>
        stockPairedActionRpcProviders({
          ETHEREUM_RPC_URL: ALCHEMY_MAINNET_A,
          ETHEREUM_RPC_URL_B: ALCHEMY_MAINNET_B,
        }),
      "alchemy-key-one",
    );
  });

  it("supports an independent Sepolia pair without accepting mainnet aliases", () => {
    const providers = tradeActionRpcProviders(11_155_111, {
      SEPOLIA_RPC_URL: ALCHEMY_SEPOLIA,
      SEPOLIA_RPC_URL_B: "https://ethereum-sepolia-rpc.publicnode.com",
    });
    expectIndependent(providers);
    expect(providers).toHaveLength(2);
  });
});
