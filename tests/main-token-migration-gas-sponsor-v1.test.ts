import { PGlite } from "@electric-sql/pglite";
import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MainTokenMigrationGasSponsorErrorV1,
  assertMainTokenMigrationPrivySponsorPolicyV2,
  assertMainTokenMigrationSponsorEligibilityAnchorV1,
  assertMainTokenMigrationPrivySponsorWalletV1,
  calculateMainTokenMigrationTopUpWeiV1,
  createMainTokenMigrationGasSponsorV1,
  deriveMainTokenMigrationSponsorBindingsV1,
  deriveMainTokenMigrationSponsorPrincipalBindingV1,
  parsePrivySponsorTransactionLookupV1,
  parseMainTokenMigrationSponsorRequestV1,
  readMainTokenMigrationGasSponsorConfigurationV1,
  resolveMainTokenMigrationSponsorEligibilityV1,
  type MainTokenMigrationGasSponsorChainV1,
  type MainTokenMigrationGasSponsorConfigurationV1,
  type MainTokenMigrationGasSponsorSenderV1,
} from "../lib/server/main-token-migration-gas-sponsor-v1";
import {
  MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1,
  MainTokenMigrationGasSponsorStoreErrorV1,
  createMainTokenMigrationGasSponsorPostgresStoreV1,
  type MainTokenMigrationGasSponsorIntentV1,
  type MainTokenMigrationGasSponsorEligibilityV1,
  type MainTokenMigrationGasSponsorRecordV1,
  type MainTokenMigrationGasSponsorStoreV1,
} from "../lib/server/main-token-migration-gas-sponsor-store-v1";
import sponsorPolicyContract from
  "../config/main-token-migration-gas-sponsor-privy-policy.v2.json";
import {
  MAIN_TOKEN_ADDRESS,
  MAIN_TOKEN_MIGRATION_CHAIN_ID,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
  MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
  MAIN_TOKEN_RUNTIME_CODE_KECCAK256,
} from "../lib/main-token-migration";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const SECOND_WALLET = "0x3333333333333333333333333333333333333333" as const;
const SPONSOR = "0x2222222222222222222222222222222222222222" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const NOW = new Date("2026-08-30T12:00:00.000Z");
const IDEMPOTENCY_KEY = "migration-request-00000001";
const TEST_ERC20_ABI = parseAbi([
  "function transfer(address to,uint256 amount) returns (bool)",
  "function transferFrom(address from,address to,uint256 amount) returns (bool)",
]);
const CONFIGURATION: MainTokenMigrationGasSponsorConfigurationV1 = {
  releaseId: "v4-ethereum-to-robinhood-72h-2026-v2",
  windowStartTimestamp: 1_899_654_400,
  startBlockNumber: 100n,
  startBlockHash: `0x${"12".repeat(32)}`,
  deadlineTimestampExclusive: 1_900_000_000,
  sponsorWalletId: "sponsor-wallet-id",
  sponsorPolicyId: "sponsor-policy-id",
  sponsorAddress: SPONSOR,
  maximumTopUpWei: 2_000_000_000_000_000n,
  totalBudgetWei: 172_000_000_000_000n,
};

const PRODUCTION_POLICY_CONFIGURATION: MainTokenMigrationGasSponsorConfigurationV1 = {
  ...CONFIGURATION,
  deadlineTimestampExclusive: 1_788_418_500,
  sponsorAddress: "0x0060f9E57FCcc0611ef44809B257919e78Aa99Ac",
};

function key(releaseId: string, walletAddress: string) {
  return `${releaseId}:${walletAddress.toLowerCase()}`;
}

class MemoryStore implements MainTokenMigrationGasSponsorStoreV1 {
  readonly records = new Map<string, MainTokenMigrationGasSponsorRecordV1>();
  readonly aliases = new Map<string, string>();
  readonly eligibilityAliases = new Map<string, string>();
  readonly admissions:
    Parameters<MainTokenMigrationGasSponsorStoreV1["admit"]>[0][] = [];
  rateLimited = false;
  private gate: Promise<void> = Promise.resolve();

  async admit(input: Parameters<MainTokenMigrationGasSponsorStoreV1["admit"]>[0]) {
    this.admissions.push(input);
    if (this.rateLimited) {
      throw new MainTokenMigrationGasSponsorStoreErrorV1("rate_limited", 17);
    }
  }

  async get(input: { releaseId: string; walletAddress: `0x${string}` }) {
    return this.records.get(key(input.releaseId, input.walletAddress)) ?? null;
  }

  async reserve(input: Parameters<MainTokenMigrationGasSponsorStoreV1["reserve"]>[0]) {
    let unlock: () => void = () => {};
    const previous = this.gate;
    this.gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      const recordKey = key(input.lookup.releaseId, input.lookup.walletAddress);
      const alias = this.aliases.get(input.idempotencyBindingHash);
      const eligibilityKey = key(
        input.lookup.releaseId,
        input.eligibility.rootWalletAddress,
      );
      const eligibilityHolder = this.eligibilityAliases.get(eligibilityKey);
      if (alias !== undefined && alias !== input.requestBindingHash) {
        throw new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
      }
      if (eligibilityHolder !== undefined && eligibilityHolder !== recordKey) {
        throw new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
      }
      const existing = this.records.get(recordKey);
      if (existing) {
        if (existing.intent.requestBindingHash !== input.requestBindingHash) {
          throw new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
        }
        return { kind: "existing" as const, record: existing };
      }
      const reservedWei = [...this.records.values()]
        .filter((record) => record.intent.releaseId === input.lookup.releaseId)
        .reduce(
          (total, record) => total + BigInt(record.intent.reservedTotalWei),
          0n,
        );
      if (reservedWei + BigInt(input.intent.reservedTotalWei)
        > BigInt(input.intent.totalBudgetWei)) {
        throw new MainTokenMigrationGasSponsorStoreErrorV1("budget_exhausted");
      }
      this.aliases.set(
        input.idempotencyBindingHash,
        input.requestBindingHash,
      );
      this.eligibilityAliases.set(eligibilityKey, recordKey);
      const record = Object.freeze({
        intent: input.intent,
        transactionHash: null,
      });
      this.records.set(recordKey, record);
      return { kind: "created" as const, record };
    } finally {
      unlock();
    }
  }

  async complete(input: Parameters<MainTokenMigrationGasSponsorStoreV1["complete"]>[0]) {
    const recordKey = key(input.lookup.releaseId, input.lookup.walletAddress);
    const current = this.records.get(recordKey);
    if (!current || current.intent.providerReferenceId !== input.providerReferenceId) {
      throw new MainTokenMigrationGasSponsorStoreErrorV1("unavailable");
    }
    if (current.transactionHash !== null &&
      current.transactionHash !== input.transactionHash) {
      throw new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
    }
    const completed = Object.freeze({
      intent: current.intent,
      transactionHash: input.transactionHash,
    });
    this.records.set(recordKey, completed);
    return completed;
  }
}

class IdempotentSender implements MainTokenMigrationGasSponsorSenderV1 {
  readonly calls: MainTokenMigrationGasSponsorIntentV1[] = [];
  readonly hashes = new Map<string, typeof TX_HASH>();
  actualTransfers = 0;
  throwAfterFirstBroadcast = false;
  throwBeforeFirstBroadcast = false;
  private threwAmbiguous = false;
  private threwBeforeBroadcast = false;

  async assertReady() {}

  async lookup(intent: MainTokenMigrationGasSponsorIntentV1) {
    const hash = this.hashes.get(intent.providerIdempotencyKey);
    return hash
      ? { status: "broadcasted" as const, transactionHash: hash }
      : null;
  }

  async send(intent: MainTokenMigrationGasSponsorIntentV1) {
    this.calls.push(intent);
    if (this.throwBeforeFirstBroadcast && !this.threwBeforeBroadcast) {
      this.threwBeforeBroadcast = true;
      throw new Error("provider request failed before broadcast");
    }
    let hash = this.hashes.get(intent.providerIdempotencyKey);
    if (!hash) {
      hash = TX_HASH;
      this.hashes.set(intent.providerIdempotencyKey, hash);
      this.actualTransfers += 1;
    }
    await Promise.resolve();
    if (this.throwAfterFirstBroadcast && !this.threwAmbiguous) {
      this.threwAmbiguous = true;
      throw new Error("provider response lost after broadcast");
    }
    return hash;
  }
}

function chain(): MainTokenMigrationGasSponsorChainV1 {
  return {
    async observe({ request }) {
      return {
        walletAddress: request.walletAddress,
        amountRaw: request.amountRaw,
        estimatedTransferGas: 52_000n,
        feePerGasWei: 2_000_000_000n,
        maxPriorityFeePerGasWei: 1_000_000_000n,
        nativeBalanceWei: 0n,
        sponsorBalanceWei: 1_000_000_000_000_000_000n,
        eligibility: directEligibility(request.walletAddress),
      };
    },
    async status() {
      return "confirmed";
    },
    async sponsorGasLimit() {
      return MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1;
    },
  };
}

function directEligibility(
  walletAddress: `0x${string}`,
): MainTokenMigrationGasSponsorEligibilityV1 {
  return Object.freeze({
    rootWalletAddress: walletAddress,
    walletAddress,
    transferHash: null,
    transferBlockNumber: null,
    transferLogIndex: null,
  });
}

function request(
  walletAddress: `0x${string}` = WALLET,
  idempotencyKey = IDEMPOTENCY_KEY,
) {
  return new Request(
    "https://programmable.market/api/main-token-migration/gas-sponsorship",
    {
      method: "POST",
      headers: {
        authorization: "Bearer privy-access-token",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        origin: "https://programmable.market",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ walletAddress, amountRaw: "100" }),
    },
  );
}

function sponsor(
  store: MemoryStore,
  sender: IdempotentSender,
  now: () => Date = () => NOW,
) {
  return createMainTokenMigrationGasSponsorV1({
    configuration: CONFIGURATION,
    authenticator: {
      async authenticate() {
        return {
          privyUserId: "did:privy:test-user",
          privySessionId: "session-1",
          wallets: [WALLET, SECOND_WALLET],
        };
      },
    },
    store,
    chain: chain(),
    sender,
    now,
  });
}

describe("main token migration gas sponsor", () => {
  it("requires the exact provider policy and rejects a broader allow rule", () => {
    const policy = {
      chain_type: sponsorPolicyContract.chainType,
      name: sponsorPolicyContract.name,
      owner_id: null,
      version: sponsorPolicyContract.version,
      rules: sponsorPolicyContract.rules.map((rule, index) => ({
        ...rule,
        id: `rule-${index}`,
      })),
    };
    expect(() => assertMainTokenMigrationPrivySponsorPolicyV2(
      policy,
      PRODUCTION_POLICY_CONFIGURATION,
    )).not.toThrow();
    expect(() => assertMainTokenMigrationPrivySponsorPolicyV2({
      ...policy,
      rules: [...policy.rules, {
        id: "broad-rule",
        name: "Broad allow",
        action: "ALLOW",
        method: "eth_sendTransaction",
        conditions: [],
      }],
    }, PRODUCTION_POLICY_CONFIGURATION)).toThrow(
      MainTokenMigrationGasSponsorErrorV1,
    );
  });

  it("accepts one confirmed direct transfer from the eligible root wallet", async () => {
    const blockHash = `0x${"45".repeat(32)}` as const;
    const transferHash = `0x${"67".repeat(32)}` as const;
    const transferData = encodeFunctionData({
      abi: TEST_ERC20_ABI,
      functionName: "transfer",
      args: [SECOND_WALLET, 100n],
    });
    const client = () => ({
      async getLogs() {
        return [{
          args: { from: WALLET, to: SECOND_WALLET, value: 100n },
          blockHash,
          blockNumber: 103n,
          logIndex: 0,
          removed: false,
          transactionHash: transferHash,
        }];
      },
      async getCode() {
        return "0x";
      },
      async getTransaction() {
        return {
          blockHash,
          blockNumber: 103n,
          from: WALLET,
          hash: transferHash,
          input: transferData,
          to: MAIN_TOKEN_ADDRESS,
          value: 0n,
        };
      },
      async readContract() {
        return 100n;
      },
    });

    await expect(resolveMainTokenMigrationSponsorEligibilityV1({
      clients: [client(), client()] as never,
      configuration: CONFIGURATION,
      request: { walletAddress: SECOND_WALLET, amountRaw: 100n },
      blockNumber: 105n,
      provenanceBlockNumber: 105n,
      directOpeningBalances: [0n, 0n],
    })).resolves.toEqual({
      rootWalletAddress: WALLET,
      walletAddress: SECOND_WALLET,
      transferHash,
      transferBlockNumber: "103",
      transferLogIndex: "0",
    });
  });

  it("rejects transferFrom provenance even when its Transfer log matches", async () => {
    const blockHash = `0x${"45".repeat(32)}` as const;
    const transferHash = `0x${"67".repeat(32)}` as const;
    const transferData = encodeFunctionData({
      abi: TEST_ERC20_ABI,
      functionName: "transferFrom",
      args: [WALLET, SECOND_WALLET, 100n],
    });
    const client = () => ({
      async getLogs() {
        return [{
          args: { from: WALLET, to: SECOND_WALLET, value: 100n },
          blockHash,
          blockNumber: 103n,
          logIndex: 0,
          removed: false,
          transactionHash: transferHash,
        }];
      },
      async getCode() {
        return "0x";
      },
      async getTransaction() {
        return {
          blockHash,
          blockNumber: 103n,
          from: WALLET,
          hash: transferHash,
          input: transferData,
          to: MAIN_TOKEN_ADDRESS,
          value: 0n,
        };
      },
      async readContract() {
        return 100n;
      },
    });

    await expect(resolveMainTokenMigrationSponsorEligibilityV1({
      clients: [client(), client()] as never,
      configuration: CONFIGURATION,
      request: { walletAddress: SECOND_WALLET, amountRaw: 100n },
      blockNumber: 105n,
      provenanceBlockNumber: 105n,
      directOpeningBalances: [0n, 0n],
    })).resolves.toBeNull();
  });

  it("keeps checking a valid direct transfer after transferFrom noise", async () => {
    const blockHash = `0x${"46".repeat(32)}` as const;
    const directHash = `0x${"68".repeat(32)}` as const;
    const transferFromHash = `0x${"69".repeat(32)}` as const;
    const directData = encodeFunctionData({
      abi: TEST_ERC20_ABI,
      functionName: "transfer",
      args: [SECOND_WALLET, 100n],
    });
    const transferFromData = encodeFunctionData({
      abi: TEST_ERC20_ABI,
      functionName: "transferFrom",
      args: [WALLET, SECOND_WALLET, 101n],
    });
    const client = () => ({
      async getLogs() {
        return [
          {
            args: { from: WALLET, to: SECOND_WALLET, value: 100n },
            blockHash,
            blockNumber: 103n,
            logIndex: 0,
            removed: false,
            transactionHash: directHash,
          },
          {
            args: { from: WALLET, to: SECOND_WALLET, value: 101n },
            blockHash,
            blockNumber: 104n,
            logIndex: 0,
            removed: false,
            transactionHash: transferFromHash,
          },
        ];
      },
      async getCode() {
        return "0x";
      },
      async getTransaction({ hash }: { hash: string }) {
        return {
          blockHash,
          blockNumber: hash === directHash ? 103n : 104n,
          from: WALLET,
          hash,
          input: hash === directHash ? directData : transferFromData,
          to: MAIN_TOKEN_ADDRESS,
          value: 0n,
        };
      },
      async readContract() {
        return 101n;
      },
    });

    await expect(resolveMainTokenMigrationSponsorEligibilityV1({
      clients: [client(), client()] as never,
      configuration: CONFIGURATION,
      request: { walletAddress: SECOND_WALLET, amountRaw: 100n },
      blockNumber: 105n,
      provenanceBlockNumber: 105n,
      directOpeningBalances: [0n, 0n],
    })).resolves.toEqual({
      rootWalletAddress: WALLET,
      walletAddress: SECOND_WALLET,
      transferHash: directHash,
      transferBlockNumber: "103",
      transferLogIndex: "0",
    });
  });

  it("fails closed when independent providers disagree on transfer provenance", async () => {
    const client = (transactionHash: `0x${string}`) => ({
      async getLogs() {
        return [{
          args: { from: WALLET, to: SECOND_WALLET, value: 100n },
          blockHash: `0x${"45".repeat(32)}`,
          blockNumber: 103n,
          logIndex: 0,
          removed: false,
          transactionHash,
        }];
      },
      async getCode() {
        return "0x";
      },
      async readContract() {
        return 100n;
      },
    });

    await expect(resolveMainTokenMigrationSponsorEligibilityV1({
      clients: [
        client(`0x${"67".repeat(32)}`),
        client(`0x${"68".repeat(32)}`),
      ] as never,
      configuration: CONFIGURATION,
      request: { walletAddress: SECOND_WALLET, amountRaw: 100n },
      blockNumber: 105n,
      provenanceBlockNumber: 105n,
      directOpeningBalances: [0n, 0n],
    })).rejects.toMatchObject({
      status: 503,
      code: "rpc_quorum_unavailable",
    });
  });

  it("accepts only the exact finalized eligibility block before the window", () => {
    const exact = {
      number: CONFIGURATION.startBlockNumber,
      hash: CONFIGURATION.startBlockHash,
      timestamp: BigInt(CONFIGURATION.windowStartTimestamp - 1),
      finalizedBlockNumber: CONFIGURATION.startBlockNumber,
    } as const;
    expect(() =>
      assertMainTokenMigrationSponsorEligibilityAnchorV1(
        CONFIGURATION,
        [exact, exact],
      ),
    ).not.toThrow();

    for (const changed of [
      { ...exact, number: CONFIGURATION.startBlockNumber + 1n },
      { ...exact, hash: `0x${"34".repeat(32)}` as const },
      {
        ...exact,
        timestamp: BigInt(CONFIGURATION.windowStartTimestamp),
      },
      {
        ...exact,
        finalizedBlockNumber: CONFIGURATION.startBlockNumber - 1n,
      },
    ]) {
      expect(() =>
        assertMainTokenMigrationSponsorEligibilityAnchorV1(
          CONFIGURATION,
          [exact, changed],
        ),
      ).toThrowError(
        expect.objectContaining({
          status: 503,
          code: "rpc_quorum_unavailable",
        }),
      );
    }
  });

  it("accepts only the exact 72-hour release identity and window", () => {
    const start = Math.floor(NOW.getTime() / 1_000) - 60;
    const manifest = {
      schema: "programmable-main-token-migration-activation/v1",
      releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
      enabled: true,
      sourceChainId: String(MAIN_TOKEN_MIGRATION_CHAIN_ID),
      sourceTokenAddress: MAIN_TOKEN_ADDRESS,
      sourceTokenRuntimeCodeKeccak256: MAIN_TOKEN_RUNTIME_CODE_KECCAK256,
      migrationWallet: MAIN_TOKEN_MIGRATION_WALLET,
      windowDurationSeconds: String(MAIN_TOKEN_MIGRATION_WINDOW_SECONDS),
      windowStartTimestamp: String(start),
      deadlineTimestampExclusive: String(
        start + MAIN_TOKEN_MIGRATION_WINDOW_SECONDS,
      ),
      startBlockNumber: "100",
      startBlockHash: `0x${"12".repeat(32)}`,
    };
    const environment = {
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED: "true",
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_WALLET_ID:
        CONFIGURATION.sponsorWalletId,
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_PRIVY_POLICY_ID:
        CONFIGURATION.sponsorPolicyId,
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ADDRESS:
        CONFIGURATION.sponsorAddress,
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_TOP_UP_WEI:
        CONFIGURATION.maximumTopUpWei.toString(),
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_TOTAL_BUDGET_WEI:
        "20000000000000000",
    };

    expect(readMainTokenMigrationGasSponsorConfigurationV1({
      environment,
      manifest,
      nowMs: NOW.getTime(),
    })).toMatchObject({
      releaseId: "v4-ethereum-to-robinhood-72h-2026-v2",
      deadlineTimestampExclusive: start + 72 * 60 * 60,
    });
    const afterDeadline = (start + MAIN_TOKEN_MIGRATION_WINDOW_SECONDS) * 1_000;
    expect(readMainTokenMigrationGasSponsorConfigurationV1({
      environment, manifest, nowMs: afterDeadline,
    })).toBeNull();
    expect(readMainTokenMigrationGasSponsorConfigurationV1({
      environment, manifest, nowMs: afterDeadline,
      allowClosedWindowReadback: true,
    })).toMatchObject({ deadlineTimestampExclusive: afterDeadline / 1_000 });
    for (const nowMs of [(start - 1) * 1_000, NaN, Infinity]) {
      expect(readMainTokenMigrationGasSponsorConfigurationV1({
        environment, manifest, nowMs, allowClosedWindowReadback: true,
      })).toBeNull();
    }
    expect(readMainTokenMigrationGasSponsorConfigurationV1({
      environment: { ...environment, MAIN_TOKEN_MIGRATION_GAS_SPONSOR_ENABLED: "false" },
      manifest, nowMs: afterDeadline, allowClosedWindowReadback: true,
    })).toBeNull();
    expect(readMainTokenMigrationGasSponsorConfigurationV1({
      environment,
      manifest: {
        ...manifest,
        releaseId: "v4-ethereum-to-robinhood-48h-2026-v1",
        windowDurationSeconds: String(48 * 60 * 60),
        deadlineTimestampExclusive: String(start + 48 * 60 * 60),
      },
      nowMs: NOW.getTime(),
    })).toBeNull();
  });

  it("strictly binds the request, deficit quote, and provider idempotency", () => {
    expect(parseMainTokenMigrationSponsorRequestV1({
      walletAddress: WALLET,
      amountRaw: "100",
    })).toEqual({ walletAddress: WALLET, amountRaw: 100n });
    expect(() => parseMainTokenMigrationSponsorRequestV1({
      walletAddress: WALLET,
      amountRaw: "100",
      extra: true,
    })).toThrow(MainTokenMigrationGasSponsorErrorV1);

    expect(calculateMainTokenMigrationTopUpWeiV1({
      estimatedGas: 52_000n,
      feePerGas: 2_000_000_000n,
      hardCapWei: CONFIGURATION.maximumTopUpWei,
      nativeBalanceWei: 30_000_000_000_000n,
    })).toEqual({
      requiredWei: 130_000_000_000_000n,
      topUpWei: 100_000_000_000_000n,
    });

    const first = deriveMainTokenMigrationSponsorBindingsV1({
      releaseId: CONFIGURATION.releaseId,
      walletAddress: WALLET,
      amountRaw: 100n,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const replayWithDifferentClientKey =
      deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000002",
      });
    expect(first.requestBindingHash).not.toBe(
      replayWithDifferentClientKey.requestBindingHash,
    );
    expect(first.providerIdempotencyKey).toBe(
      replayWithDifferentClientKey.providerIdempotencyKey,
    );
    expect(first.providerReferenceId).toBe(
      replayWithDifferentClientKey.providerReferenceId,
    );
    expect(first.providerReferenceId).toHaveLength(64);
    expect(first.providerIdempotencyKey).toHaveLength(70);
    expect(deriveMainTokenMigrationSponsorPrincipalBindingV1(
      "did:privy:test-user",
    )).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("attests the exact Privy wallet, chain, address, and sole policy", () => {
    const wallet = {
      id: CONFIGURATION.sponsorWalletId,
      chain_type: "ethereum",
      address: CONFIGURATION.sponsorAddress,
      policy_ids: [CONFIGURATION.sponsorPolicyId],
    };
    expect(() => assertMainTokenMigrationPrivySponsorWalletV1(
      wallet,
      CONFIGURATION,
    )).not.toThrow();
    for (const policy_ids of [
      [],
      [CONFIGURATION.sponsorPolicyId, "unexpected-policy-id"],
      ["unexpected-policy-id"],
      undefined,
    ]) {
      expect(() => assertMainTokenMigrationPrivySponsorWalletV1(
        { ...wallet, policy_ids },
        CONFIGURATION,
      )).toThrowError(MainTokenMigrationGasSponsorErrorV1);
    }
    for (const mismatch of [
      { id: "unexpected-wallet-id" },
      { chain_type: "solana" },
      { address: SECOND_WALLET },
    ]) {
      expect(() => assertMainTokenMigrationPrivySponsorWalletV1(
        { ...wallet, ...mismatch },
        CONFIGURATION,
      )).toThrowError(MainTokenMigrationGasSponsorErrorV1);
    }
  });

  it("accepts only one exact Privy reconciliation record", () => {
    const referenceId = "mtmgs-test-provider-reference";
    const record = {
      caip2: "eip155:1",
      reference_id: referenceId,
      status: "broadcasted",
      transaction_hash: TX_HASH,
      wallet_id: CONFIGURATION.sponsorWalletId,
    };
    expect(parsePrivySponsorTransactionLookupV1({
      transactions: [record],
    }, {
      referenceId,
      sponsorWalletId: CONFIGURATION.sponsorWalletId,
    })).toEqual({
      status: "broadcasted",
      transactionHash: TX_HASH,
    });
    expect(parsePrivySponsorTransactionLookupV1({
      transactions: [],
    }, {
      referenceId,
      sponsorWalletId: CONFIGURATION.sponsorWalletId,
    })).toBeNull();
    for (const transactions of [
      [record, record],
      [{ ...record, caip2: "eip155:10" }],
      [{ ...record, reference_id: "another-reference" }],
      [{ ...record, wallet_id: "another-wallet" }],
    ]) {
      expect(() => parsePrivySponsorTransactionLookupV1({ transactions }, {
        referenceId,
        sponsorWalletId: CONFIGURATION.sponsorWalletId,
      })).toThrowError(MainTokenMigrationGasSponsorErrorV1);
    }
  });

  it("durably admits the authenticated principal before sender or RPC work", async () => {
    const store = new MemoryStore();
    store.rateLimited = true;
    const sender = new IdempotentSender();
    sender.assertReady = vi.fn();
    const observed = vi.fn();
    const handler = createMainTokenMigrationGasSponsorV1({
      configuration: CONFIGURATION,
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:test-user",
            privySessionId: "session-1",
            wallets: [WALLET],
          };
        },
      },
      store,
      chain: {
        async observe(input) {
          observed(input);
          return chain().observe(input);
        },
        async status() {
          return "confirmed";
        },
        async sponsorGasLimit() {
          return MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1;
        },
      },
      sender,
      now: () => NOW,
    });

    const blocked = await handler.post(request());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("17");
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect(store.admissions).toHaveLength(1);
    expect(store.admissions[0]).toMatchObject({
      operation: "submit",
      releaseId: CONFIGURATION.releaseId,
      walletAddress: WALLET,
    });
    expect(sender.assertReady).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
  });

  it("persists bounded principal and holder admission slots in PostgreSQL", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE SCHEMA programmable_website_projection_v1;
        CREATE TABLE programmable_website_projection_v1.credential_uses (
          credential_id text PRIMARY KEY,
          request_binding_hash text NOT NULL,
          canonical_use text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp()
        );
      `);
      let epochSeconds = 1_800_000_005;
      const store = createMainTokenMigrationGasSponsorPostgresStoreV1(
        new SponsorTestPool(database, () => epochSeconds),
      );
      const principalBindingHash =
        deriveMainTokenMigrationSponsorPrincipalBindingV1(
          "did:privy:persistent-rate-test",
        );
      for (let index = 0; index < 8; index += 1) {
        await store.admit({
          releaseId: CONFIGURATION.releaseId,
          principalBindingHash,
          walletAddress: WALLET,
          operation: "read",
        });
      }
      await expect(store.admit({
        releaseId: CONFIGURATION.releaseId,
        principalBindingHash,
        walletAddress: WALLET,
        operation: "read",
      })).rejects.toMatchObject({
        code: "rate_limited",
      });

      // Polling cannot consume or bypass the stricter new-transfer budget.
      for (const [operation, limit] of [["submit", 2], ["progress", 24]] as const) {
        for (let index = 0; index < limit; index += 1) {
          await store.admit({
            releaseId: CONFIGURATION.releaseId,
            principalBindingHash,
            walletAddress: WALLET,
            operation,
          });
        }
        await expect(store.admit({
          releaseId: CONFIGURATION.releaseId,
          principalBindingHash,
          walletAddress: WALLET,
          operation,
        })).rejects.toMatchObject({ code: "rate_limited" });
      }

      const rows = await database.query<{ count: string }>(`
        SELECT count(*)::text AS count
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id LIKE '%:admission:%'
      `);
      expect(rows.rows[0]?.count).toBe("68");

      // Crossing the minute boundary must admit a new request. Keep the SQL
      // clock controlled so slow CI cannot cross that boundary accidentally.
      epochSeconds += 60;
      await expect(store.admit({
        releaseId: CONFIGURATION.releaseId,
        principalBindingHash,
        walletAddress: WALLET,
        operation: "read",
      })).resolves.toBeUndefined();

      const firstBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000011",
      });
      const firstIntent = testIntent(firstBindings.requestBindingHash);
      expect((await store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: WALLET,
        },
        idempotencyBindingHash: firstBindings.idempotencyBindingHash,
        requestBindingHash: firstBindings.requestBindingHash,
        eligibility: directEligibility(WALLET),
        intent: firstIntent,
      })).kind).toBe("created");

      const replayBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000012",
      });
      await expect(store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: WALLET,
        },
        idempotencyBindingHash: replayBindings.idempotencyBindingHash,
        requestBindingHash: replayBindings.requestBindingHash,
        eligibility: directEligibility(WALLET),
        intent: testIntent(replayBindings.requestBindingHash),
      })).rejects.toMatchObject({ code: "conflict" });
      const aliases = await database.query<{ count: string }>(`
        SELECT count(*)::text AS count
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id LIKE '%:idempotency:%'
      `);
      expect(aliases.rows[0]?.count).toBe("1");

      const relocatedBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: SECOND_WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000013",
      });
      await expect(store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: SECOND_WALLET,
        },
        idempotencyBindingHash: relocatedBindings.idempotencyBindingHash,
        requestBindingHash: relocatedBindings.requestBindingHash,
        eligibility: {
          rootWalletAddress: WALLET,
          walletAddress: SECOND_WALLET,
          transferHash: TX_HASH,
          transferBlockNumber: "101",
          transferLogIndex: "0",
        },
        intent: testIntent(relocatedBindings.requestBindingHash, SECOND_WALLET),
      })).rejects.toMatchObject({ code: "conflict" });
      const eligibilityAliases = await database.query<{ count: string }>(`
        SELECT count(*)::text AS count
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id LIKE '%:eligibility:%'
      `);
      expect(eligibilityAliases.rows[0]?.count).toBe("1");
    } finally {
      await database.close();
    }
  }, 10_000);

  it("blocks legacy root-wallet writers with a durable holder guard", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE SCHEMA programmable_website_projection_v1;
        CREATE TABLE programmable_website_projection_v1.credential_uses (
          credential_id text PRIMARY KEY,
          request_binding_hash text NOT NULL,
          canonical_use text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp()
        );
      `);
      const store = createMainTokenMigrationGasSponsorPostgresStoreV1(
        new SponsorTestPool(database),
      );
      const totalBudgetWei = "1000000000000000";
      const relocatedBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: SECOND_WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000014",
      });
      expect((await store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: SECOND_WALLET,
        },
        idempotencyBindingHash: relocatedBindings.idempotencyBindingHash,
        requestBindingHash: relocatedBindings.requestBindingHash,
        eligibility: {
          rootWalletAddress: WALLET,
          walletAddress: SECOND_WALLET,
          transferHash: TX_HASH,
          transferBlockNumber: "103",
          transferLogIndex: "0",
        },
        intent: testIntent(
          relocatedBindings.requestBindingHash,
          SECOND_WALLET,
          totalBudgetWei,
        ),
      })).kind).toBe("created");

      const rootGuard = await store.get({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
      });
      expect(rootGuard).toMatchObject({
        transactionHash: null,
        intent: {
          walletAddress: WALLET,
          topUpWei: "1",
          reservedTotalWei: "21001",
        },
      });
      const sender = new IdempotentSender();
      const handler = createMainTokenMigrationGasSponsorV1({
        configuration: CONFIGURATION,
        authenticator: {
          async authenticate() {
            return {
              privyUserId: "did:privy:test-user",
              privySessionId: "session-1",
              wallets: [WALLET],
            };
          },
        },
        store,
        chain: chain(),
        sender,
        now: () => NOW,
      });
      const blockedGuard = await handler.post(request(
        WALLET,
        "migration-request-00000016",
      ));
      expect(blockedGuard.status).toBe(409);
      expect(sender.calls).toHaveLength(0);
      const rootBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000015",
      });
      await expect(store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: WALLET,
        },
        idempotencyBindingHash: rootBindings.idempotencyBindingHash,
        requestBindingHash: rootBindings.requestBindingHash,
        eligibility: directEligibility(WALLET),
        intent: testIntent(
          rootBindings.requestBindingHash,
          WALLET,
          totalBudgetWei,
        ),
      })).rejects.toMatchObject({ code: "conflict" });
      const holders = await database.query<{ count: string }>(`
        SELECT count(*)::text AS count
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id LIKE
           'main-token-migration-gas-sponsor:v1:holder:%'
      `);
      expect(holders.rows[0]?.count).toBe("2");
    } finally {
      await database.close();
    }
  }, 10_000);

  it("reserves concurrent duplicates once and never broadcasts twice", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const handler = sponsor(store, sender);

    const [left, right] = await Promise.all([
      handler.post(request()),
      handler.post(request()),
    ]);

    expect([left.status, right.status].sort()).toEqual([200, 200]);
    const bodies = await Promise.all([left.json(), right.json()]);
    expect(bodies.every((body) => body.transactionHash === TX_HASH)).toBe(true);
    expect(sender.actualTransfers).toBe(1);
    expect(sender.calls.length).toBeGreaterThanOrEqual(1);
    expect([...store.records.values()][0]?.transactionHash).toBe(TX_HASH);
  });

  it("rejects a fresh client key after the holder request is bound", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const handler = sponsor(store, sender);

    expect((await handler.post(request())).status).toBe(200);
    const conflict = await handler.post(request(
      WALLET,
      "migration-request-00000002",
    ));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("idempotency_conflict");

    expect(store.aliases.size).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect(sender.actualTransfers).toBe(1);
  });

  it("reserves the exact bounded gas estimate for a delegated recipient", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const delegatedSponsorGas = 30_000n;
    const handler = createMainTokenMigrationGasSponsorV1({
      configuration: {
        ...CONFIGURATION,
        totalBudgetWei: 250_000_000_000_000n,
      },
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:test-user",
            privySessionId: "session-1",
            wallets: [WALLET],
          };
        },
      },
      store,
      chain: {
        ...chain(),
        async sponsorGasLimit() {
          return delegatedSponsorGas;
        },
      },
      sender,
      now: () => NOW,
    });

    const submitted = await handler.post(request());
    expect(submitted.status).toBe(200);
    expect(sender.calls[0]).toMatchObject({
      sponsorGasLimit: "30000",
      reservedTotalWei: "190000000000000",
    });
  });

  it("atomically refuses a second holder once the release budget is reserved", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const handler = sponsor(store, sender);

    const responses = await Promise.all([
      handler.post(request(WALLET, "migration-request-00000001")),
      handler.post(request(SECOND_WALLET, "migration-request-00000002")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200,
      503,
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies.some(
      (body) => body.error?.code === "sponsor_budget_exhausted",
    )).toBe(true);
    expect(sender.calls).toHaveLength(1);
    expect(sender.actualTransfers).toBe(1);
    expect(store.records.size).toBe(1);
    expect(sender.calls[0]).toMatchObject({
      topUpWei: "130000000000000",
      sponsorGasLimit:
        MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1.toString(),
      sponsorMaxFeePerGasWei: "2000000000",
      sponsorMaxPriorityFeePerGasWei: "1000000000",
      reservedTotalWei: "172000000000000",
      totalBudgetWei: "172000000000000",
    });
  });

  it("reconciles an ambiguous provider outcome without a second transfer", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    sender.throwAfterFirstBroadcast = true;
    const handler = sponsor(store, sender);

    const recovered = await handler.post(request());
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).transactionHash).toBe(TX_HASH);
    expect(sender.actualTransfers).toBe(1);
    expect([...store.records.values()][0]?.transactionHash).toBe(TX_HASH);

    const duplicate = await handler.post(request());
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).transactionHash).toBe(TX_HASH);
    expect(sender.actualTransfers).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect([...store.records.values()][0]?.transactionHash).toBe(TX_HASH);
  });

  it("retries the identical provider request after a pre-broadcast failure", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    sender.throwBeforeFirstBroadcast = true;
    const handler = sponsor(store, sender);

    const recovered = await handler.post(request());
    expect(recovered.status).toBe(200);
    expect((await recovered.json()).transactionHash).toBe(TX_HASH);
    expect(sender.calls).toHaveLength(2);
    expect(sender.calls[0]).toBe(sender.calls[1]);
    expect(sender.actualTransfers).toBe(1);
    expect([...store.records.values()][0]?.transactionHash).toBe(TX_HASH);
  });

  it("never resends an unresolved reservation outside the provider window", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const bindings = deriveMainTokenMigrationSponsorBindingsV1({
      releaseId: CONFIGURATION.releaseId,
      walletAddress: WALLET,
      amountRaw: 100n,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const intent = Object.freeze({
      ...testIntent(bindings.requestBindingHash),
      providerIdempotencyKey: bindings.providerIdempotencyKey,
      providerReferenceId: bindings.providerReferenceId,
      reservedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    });
    store.records.set(key(CONFIGURATION.releaseId, WALLET), {
      intent,
      transactionHash: null,
    });
    const handler = sponsor(store, sender);

    const blocked = await handler.post(request());
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error.code).toBe("submission_unknown");
    expect(sender.calls).toHaveLength(0);
    expect(sender.actualTransfers).toBe(0);
  });

  it("rechecks the deadline on every request from a cached handler", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    let current = NOW;
    const handler = sponsor(store, sender, () => current);

    current = new Date(CONFIGURATION.deadlineTimestampExclusive * 1_000);
    const expired = await handler.post(request());

    expect(expired.status).toBe(503);
    expect(sender.calls).toHaveLength(0);
    expect(store.records.size).toBe(0);
  });
});

function testIntent(
  requestBindingHash: `sha256:${string}`,
  walletAddress: typeof WALLET | typeof SECOND_WALLET = WALLET,
  totalBudgetWei = CONFIGURATION.totalBudgetWei.toString(),
): MainTokenMigrationGasSponsorIntentV1 {
  return Object.freeze({
    schema: "programmable-main-token-migration-gas-sponsorship-intent/v1",
    releaseId: CONFIGURATION.releaseId,
    walletAddress,
    sponsorAddress: SPONSOR,
    amountRaw: "100",
    topUpWei: "130000000000000",
    totalBudgetWei,
    sponsorGasLimit:
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1.toString(),
    sponsorMaxFeePerGasWei: "2000000000",
    sponsorMaxPriorityFeePerGasWei: "1000000000",
    reservedTotalWei: "172000000000000",
    estimatedTransferGas: "52000",
    feePerGasWei: "2000000000",
    requestBindingHash,
    providerIdempotencyKey: "mtmgs-test-provider-idempotency",
    providerReferenceId: "mtmgs-test-provider-reference",
    reservedAt: NOW.toISOString(),
  });
}

class SponsorTestPool {
  constructor(private readonly database: PGlite, private readonly epochSeconds?: () => number) {}

  async assertProductionReadiness() {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return Object.freeze({
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    });
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const clockExpression = "extract(epoch FROM clock_timestamp())";
    const controlledClock = this.epochSeconds && text.includes(clockExpression);
    const result = await this.database.query<Row>(
      controlledClock ? text.replace(clockExpression, `$${values.length + 1}::numeric`) : text,
      controlledClock ? [...values, this.epochSeconds!()] : [...values],
    );
    return Object.freeze({
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    });
  }
}
