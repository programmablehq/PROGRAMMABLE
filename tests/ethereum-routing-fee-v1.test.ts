import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, getContractAddress, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import recordingBytes from "./fixtures/ethereum-stamped-swap-rpc.json";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { ETHEREUM_ROUTING_FEE_BOUNDARY_V1, ETHEREUM_ROUTING_FEE_POLICY_HASH_V1, ETHEREUM_ROUTING_FEE_POLICY_V1, ETHEREUM_ROUTING_FEE_POLICY_V2, ETHEREUM_ROUTING_FEE_POLICY_V3, type EthereumRoutingFeePolicy,
  parseEthereumRoutingFeePolicyV1, type EthereumFeeClassificationV1 } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { ETHEREUM_NATIVE100_RECIPES_V1 } from "@/lib/custom-launch/ethereum-native100-recipes-v1";
import { ethereumPoolFeeMatchesPolicy } from "@/lib/custom-launch/ethereum-routing-fee-policy-v1";
import { ETHEREUM_NATIVE30_RECIPES_V2 } from "@/lib/custom-launch/ethereum-native30-recipes-v2";
import { ETHEREUM_NATIVE30_RECIPES_V1 } from "@/lib/custom-launch/ethereum-native30-recipes-v1";
import { materializeEthereumNative30RuntimeWordsV1, proveEthereumNative30RuntimeV1, rebuildEthereumNative30RuntimeProofV1,
  type EthereumNative30MarketV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";
import { readEthereumFeeClassificationV1, type EthereumFeeClassificationStoreV1 } from "@/lib/server/custom-launch/ethereum-routing-fee-policy-v1";
import { ethereumStampedSwapRoute, ethereumStampedSwapTransaction } from "@/lib/swap/ethereum-stamped";
import { customTradeRouterAbi } from "@/lib/custom-launch/trade-v1";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import type { FinalizedCustomLaunchMetadataFeedV1 } from "@/lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1";
import type { EthereumStampedSwapRequest } from "@/lib/swap/ethereum-stamped";
vi.mock("server-only", () => ({}));
const recording = JSON.parse(brotliDecompressSync(Buffer.from(recordingBytes.brotliBase64, "base64")).toString());
const oldEntry = recording.buy.snapshot.entries.find((entry: CanonicalTokenExploreEntry) => entry.tokenAddress.toLowerCase() === recording.buy.request.token.toLowerCase()) as CanonicalTokenExploreEntry;
const zero = "0x0000000000000000000000000000000000000000" as Address;
function fixture(selected: EthereumRoutingFeePolicy = ETHEREUM_ROUTING_FEE_POLICY_V1) {
  const entry = structuredClone(oldEntry);
  const stamp = entry.launchStampProvenance!;
  // Synthetic coordinates test only classification and encoding, never finality.
  entry.launchStampProvenance = { ...stamp, blockNumber: String(BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber) + 1n),
    finalizedAtBlockNumber: String(BigInt(ETHEREUM_ROUTING_FEE_BOUNDARY_V1.blockNumber) + 100n) };
  const body = { schemaVersion: "programmable.ethereum-launch-routing-fee-policy-binding.v1" as const,
    launchProfileVersion: "3.6.0" as const, launchProfileHash: `sha256:${"11".repeat(32)}` as const,
    policyHash: canonicalBrowserSha256V2(selected.schemaVersion, selected), policy: selected,
    enforcementBoundary: ETHEREUM_ROUTING_FEE_BOUNDARY_V1,
    stampBinding: { launchId: stamp.launchId, stampHash: stamp.stampHash, permitDigest: stamp.permitDigest, routePayloadHash: stamp.routePayloadHash } };
  const policy = { ...body, bindingHash: canonicalBrowserSha256V2(body.schemaVersion, body) };
  const classification: EthereumFeeClassificationV1 = { launchId: stamp.launchId, stampHash: stamp.stampHash, profileVersion: "3.6.0", routingFeePolicy: policy };
  const route = ethereumStampedSwapRoute(entry, classification)!;
  const request = { ...recording.buy.request, amountIn: "1000000000001", routeBindingHash: route.routeBindingHash } as EthereumStampedSwapRequest;
  return { entry, route, request, classification, policy };
}
function memoryStore(records = new Map<string, unknown>()): EthereumFeeClassificationStoreV1 {
  return { read: async key => structuredClone(records.get(key) ?? null), write: async (key, record) => { records.set(key, structuredClone(record)); } };
}
function metadataFeed(f: ReturnType<typeof fixture>): FinalizedCustomLaunchMetadataFeedV1 {
  const stamp = f.entry.launchStampProvenance!;
  return { launches: [{ launchProfileVersion: "3.6.0", routingFeePolicy: f.policy, projectMetadata: null, chainId: "1",
    routerLaunchId: stamp.launchId, router: stamp.routerAddress, token: f.entry.tokenAddress, hook: f.entry.hookAddress,
    poolManager: stamp.poolManagerAddress, poolId: f.entry.poolId,
    finality: { transactionHash: stamp.transactionHash, blockNumber: stamp.blockNumber, blockHash: stamp.blockHash, logIndex: stamp.launchLogIndex } }]
  } as unknown as FinalizedCustomLaunchMetadataFeedV1;
}
function commands(tx: ReturnType<typeof ethereumStampedSwapTransaction>) {
  const decoded = decodeFunctionData({ abi: customTradeRouterAbi, data: tx.data });
  return decoded.args!;
}

describe("Ethereum 3.6 routing fee", () => {
  it("encodes the signed 100bps policy on buys and sells without rewriting 30bps bindings", () => {
    const f = fixture(ETHEREUM_ROUTING_FEE_POLICY_V3), legacy = fixture(ETHEREUM_ROUTING_FEE_POLICY_V2);
    expect(parseEthereumRoutingFeePolicyV1(f.policy)).toEqual(f.policy);
    expect(f.policy.policyHash).not.toBe(legacy.policy.policyHash);
    const buy = commands(ethereumStampedSwapTransaction(f.route, f.request, 10000n));
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), buy[1][0]!)).toEqual([
      zero, ETHEREUM_ROUTING_FEE_POLICY_V3.defaultCollection.recipient, BigInt(f.request.amountIn) * 100n / 10000n,
    ]);
    const sell = commands(ethereumStampedSwapTransaction(f.route, { ...f.request, side: "sell" }, 99100n));
    const [, actions] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), sell[1][0]!);
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), actions[2]!)).toEqual([
      zero, ETHEREUM_ROUTING_FEE_POLICY_V3.defaultCollection.recipient, 100n,
    ]);
    expect(() => parseEthereumRoutingFeePolicyV1({ ...f.policy, policy: ETHEREUM_ROUTING_FEE_POLICY_V2 })).toThrow();
  });

  it("binds the new treasury independently while preserving exact legacy calldata", () => {
    const old = fixture(), current = fixture(ETHEREUM_ROUTING_FEE_POLICY_V2);
    expect(parseEthereumRoutingFeePolicyV1(current.policy)).toEqual(current.policy);
    expect(current.policy.policyHash).toBe("sha256:e2025776ad3b12e6277575259cccf11444810365975209083fea534d8e70b4b5");
    const oldBuy = commands(ethereumStampedSwapTransaction(old.route, old.request, 10000n));
    const newBuy = commands(ethereumStampedSwapTransaction(current.route, current.request, 10000n));
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), oldBuy[1][0]!)[1]).toBe(ETHEREUM_ROUTING_FEE_POLICY_V1.defaultCollection.recipient);
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), newBuy[1][0]!)[1]).toBe(ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection.recipient);
    const sell = commands(ethereumStampedSwapTransaction(current.route, { ...current.request, side: "sell" }, 9970n));
    const [, actions] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), sell[1][0]!);
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), actions[2]!)).toEqual([
      zero, ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection.recipient, 30n,
    ]);
    const changed = structuredClone(old.policy); changed.policy = ETHEREUM_ROUTING_FEE_POLICY_V2;
    expect(() => parseEthereumRoutingFeePolicyV1(changed)).toThrow();
  });

  it("pins the backend policy hash and rejects even a rehashed recipient substitution", () => {
    const f = fixture();
    expect(ETHEREUM_ROUTING_FEE_POLICY_HASH_V1).toBe("sha256:5956cdeee628ba84dfa5214efd532011e59c202e4e1c1830b1eca279d58d79d3");
    expect(parseEthereumRoutingFeePolicyV1(f.policy)).toEqual(f.policy);
    const altered = JSON.parse(JSON.stringify(f.policy));
    altered.policy.defaultCollection.recipient = f.request.owner;
    altered.policyHash = canonicalBrowserSha256V2(altered.policy.schemaVersion, altered.policy);
    const body = { ...altered }; delete body.bindingHash;
    altered.bindingHash = canonicalBrowserSha256V2(altered.schemaVersion, body);
    expect(() => parseEthereumRoutingFeePolicyV1(altered)).toThrow();
    const shifted = JSON.parse(JSON.stringify(f.policy));
    shifted.enforcementBoundary.blockNumber = "1";
    const shiftedBody = { ...shifted }; delete shiftedBody.bindingHash;
    shifted.bindingHash = canonicalBrowserSha256V2(shifted.schemaVersion, shiftedBody);
    expect(() => parseEthereumRoutingFeePolicyV1(shifted)).toThrow();
  });
  it("charges an exact native amount before the buy, using only the net swap budget", () => {
    const f = fixture(); const [encoded, inputs] = commands(ethereumStampedSwapTransaction(f.route, f.request, 10000n));
    expect(encoded).toBe("0x051004");
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), inputs[0]!)).toEqual([
      zero, ETHEREUM_ROUTING_FEE_POLICY_V1.defaultCollection.recipient, 3000000000n,
    ]);
    const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), inputs[1]!);
    expect(actions).toBe("0x060c0f");
    const [currency, maximum] = decodeAbiParameters(parseAbiParameters("address,uint256"), params[1]!);
    expect(currency).toBe(zero); expect(maximum).toBe(997000000001n);
    expect(ethereumStampedSwapTransaction(f.route, f.request, 10000n).value).toBe(f.request.amountIn);
  });
  it("takes the sell fee from native credit before delivering the net output", () => {
    const f = fixture(); const tx = ethereumStampedSwapTransaction(f.route, { ...f.request, side: "sell" }, 9970n);
    const [encoded, inputs] = commands(tx); expect(encoded).toBe("0x1004");
    const [actions, params] = decodeAbiParameters(parseAbiParameters("bytes,bytes[]"), inputs[0]!);
    expect(actions).toBe("0x060c100f");
    expect(decodeAbiParameters(parseAbiParameters("address,address,uint256"), params[2]!)).toEqual([
      zero, ETHEREUM_ROUTING_FEE_POLICY_V1.defaultCollection.recipient, 30n,
    ]);
    expect(tx.value).toBe("0");
  });
  it("keeps pre-boundary launches available without relying on the metadata feed", async () => {
    const feed = vi.fn(async () => { throw new Error("unavailable"); });
    expect(await readEthereumFeeClassificationV1(oldEntry, feed)).toBeUndefined();
    expect(feed).not.toHaveBeenCalled();
    expect(ethereumStampedSwapRoute(oldEntry)).not.toBeNull();
  });
  it("never turns an unavailable or absent post-boundary policy into a free route", async () => {
    const f = fixture();
    expect(ethereumStampedSwapRoute(f.entry)).toBeNull();
    await expect(readEthereumFeeClassificationV1(f.entry, async () => { throw Error("unavailable"); }, memoryStore())).rejects.toThrow();
    await expect(readEthereumFeeClassificationV1(f.entry, async () => ({ launches: [] } as unknown as FinalizedCustomLaunchMetadataFeedV1), memoryStore())).rejects.toThrow();
    expect(ethereumStampedSwapRoute(f.entry, { ...f.classification, stampHash: `0x${"33".repeat(32)}` })).toBeNull();
  });
  it("binds a canonical fee record even when presentation metadata is missing", async () => {
    const f = fixture(), stamp = f.entry.launchStampProvenance!;
    const metadata = { launchProfileVersion: "3.6.0", routingFeePolicy: f.policy, projectMetadata: null, chainId: "1",
      routerLaunchId: stamp.launchId, router: stamp.routerAddress, token: f.entry.tokenAddress, hook: f.entry.hookAddress,
      poolManager: stamp.poolManagerAddress, poolId: f.entry.poolId,
      finality: { transactionHash: stamp.transactionHash, blockNumber: stamp.blockNumber, blockHash: stamp.blockHash, logIndex: stamp.launchLogIndex } };
    expect(await readEthereumFeeClassificationV1(f.entry, async () => ({ launches: [metadata] } as unknown as FinalizedCustomLaunchMetadataFeedV1), memoryStore())).toEqual(f.classification);
    await expect(readEthereumFeeClassificationV1(f.entry, async () => ({ launches: [{ ...metadata, token: zero }] } as unknown as FinalizedCustomLaunchMetadataFeedV1), memoryStore())).rejects.toThrow();
  });
  it("keeps verified routes across cold starts and API outages while the finalized checkpoint advances", async () => {
    const f = fixture(), records = new Map<string, unknown>();
    await readEthereumFeeClassificationV1(f.entry, async () => metadataFeed(f), memoryStore(records));
    const restartedStore = memoryStore(records), unavailable = vi.fn(async () => { throw Error("API down"); });
    const advanced = structuredClone(f.entry);
    advanced.launchStampProvenance = { ...advanced.launchStampProvenance!, finalizedAtBlockNumber: "99999999", finalizedAtBlockHash: `0x${"99".repeat(32)}` };
    expect(await readEthereumFeeClassificationV1(advanced, unavailable, restartedStore)).toEqual(f.classification);
    expect(unavailable).not.toHaveBeenCalled();
    const different = structuredClone(f.entry);
    different.launchStampProvenance = { ...different.launchStampProvenance!, blockHash: `0x${"98".repeat(32)}` };
    await expect(readEthereumFeeClassificationV1(different, unavailable, restartedStore)).rejects.toThrow("API down");
  });
  it("rejects saved policy and identity substitutions instead of authorizing a free route", async () => {
    const f = fixture(), records = new Map<string, unknown>();
    await readEthereumFeeClassificationV1(f.entry, async () => metadataFeed(f), memoryStore(records));
    const [key, original] = [...records][0]!;
    const record = original as { identityKey: string; classification: EthereumFeeClassificationV1 };
    records.set(key, { ...record, identityKey: `sha256:${"99".repeat(32)}` });
    await expect(readEthereumFeeClassificationV1(f.entry, async () => metadataFeed(f), memoryStore(records))).rejects.toThrow("identity");
    records.set(key, { ...record, classification: { ...record.classification, routingFeePolicy: null } });
    await expect(readEthereumFeeClassificationV1(f.entry, async () => metadataFeed(f), memoryStore(records))).rejects.toThrow("policy");
  });
  it("accepts an identical concurrent insert but requires durable storage before returning a new classification", async () => {
    const f = fixture(), records = new Map<string, unknown>(), base = memoryStore(records);
    expect(await readEthereumFeeClassificationV1(f.entry, async () => metadataFeed(f), {
      ...base, write: async (key, record) => { await base.write(key, record); throw Error("already inserted"); },
    })).toEqual(f.classification);
    await expect(readEthereumFeeClassificationV1(f.entry, async () => metadataFeed(f), {
      read: async () => null, write: async () => { throw Error("store unavailable"); },
    })).rejects.toThrow("store unavailable");
  });
});

describe("Ethereum Native30 exact runtime waiver", () => {
  function proofFixture(recipe = ETHEREUM_NATIVE30_RECIPES_V1.native30_fee_kernel_v2 as { hook: typeof ETHEREUM_NATIVE30_RECIPES_V1.native30_fee_kernel_v2.hook | typeof ETHEREUM_NATIVE30_RECIPES_V2.native30_fee_kernel_v3.hook | typeof ETHEREUM_NATIVE100_RECIPES_V1.native100_fee_kernel_v1.hook; vault: typeof ETHEREUM_NATIVE30_RECIPES_V1.native30_fee_kernel_v2.vault | typeof ETHEREUM_NATIVE30_RECIPES_V2.native30_fee_kernel_v3.vault | typeof ETHEREUM_NATIVE100_RECIPES_V1.native100_fee_kernel_v1.vault }) {
    const hooks = "0x12340000000000000000000000000000000020cc" as Address;
    const vault = getContractAddress({ from: hooks, nonce: 1n });
    const market: EthereumNative30MarketV1 = { chainId: "1", poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      currency0: zero, currency1: "0x5678000000000000000000000000000000000000", fee: 0, tickSpacing: 60, hooks };
    const word = (value: bigint | string) => toHex(BigInt(value), { size: 32 });
    const hook = materializeEthereumNative30RuntimeWordsV1(recipe.hook, { poolManager: word(market.poolManager), token: word(market.currency1),
      feeVault: word(vault), creatorBuyFeeBps: word(5n), creatorSellFeeBps: word(5n), lpFee: word(0n), tickSpacing: word(60n),
      initialSqrtPriceX96: word(1n << 96n), initializer: word("0x1111000000000000000000000000000000000000"),
      module: word(0n), moduleCodeHash: word(0n), maxModuleLpFeePips: word(0n) });
    const vaultCode = materializeEthereumNative30RuntimeWordsV1(recipe.vault, { poolManager: word(market.poolManager), kernel: word(hooks), creatorRecipient: word("0x1111000000000000000000000000000000000000") });
    return { market, codes: { [hooks.toLowerCase()]: hook, [vault.toLowerCase()]: vaultCode } };
  }
  it("recognizes the exact 1% pool and keeps the historical 0.3% proof separate", () => {
    const f = proofFixture(ETHEREUM_NATIVE100_RECIPES_V1.native100_fee_kernel_v1);
    const proof = proveEthereumNative30RuntimeV1(f.market, f.codes)!;
    expect(proof.rateBps).toBe(100);
    expect(rebuildEthereumNative30RuntimeProofV1(JSON.parse(JSON.stringify(proof)), f.market)).toEqual(proof);
    expect(ethereumPoolFeeMatchesPolicy(ETHEREUM_ROUTING_FEE_POLICY_V3, proof)).toBe(true);
    const old = proofFixture(ETHEREUM_NATIVE30_RECIPES_V2.native30_fee_kernel_v3);
    expect(ethereumPoolFeeMatchesPolicy(ETHEREUM_ROUTING_FEE_POLICY_V3, proveEthereumNative30RuntimeV1(old.market,old.codes)!)).toBe(false);
    expect(ethereumPoolFeeMatchesPolicy(ETHEREUM_ROUTING_FEE_POLICY_V2, proof)).toBe(false);
  });
  it("recognizes the separately compiled V3 treasury and rejects mixed custody versions", () => {
    const current = proofFixture(ETHEREUM_NATIVE30_RECIPES_V2.native30_fee_kernel_v3);
    const old = proofFixture();
    const proof = proveEthereumNative30RuntimeV1(current.market, current.codes)!;
    expect(proof.recipeId).toBe("native30_fee_kernel_v3");
    expect(proof.recipient).toBe(ETHEREUM_ROUTING_FEE_POLICY_V2.defaultCollection.recipient);
    expect(rebuildEthereumNative30RuntimeProofV1(JSON.parse(JSON.stringify(proof)), current.market)).toEqual(proof);
    const vault = getContractAddress({ from: current.market.hooks, nonce: 1n }).toLowerCase();
    expect(proveEthereumNative30RuntimeV1(current.market, { ...current.codes, [vault]: old.codes[vault]! })).toBeNull();
  });
  it("recognizes exact Ethereum source and preserves the immutable recipient", () => {
    const f = proofFixture(), proof = proveEthereumNative30RuntimeV1(f.market, f.codes)!;
    expect(proof).not.toBeNull(); expect(proof.recipient).toBe(ETHEREUM_ROUTING_FEE_POLICY_V1.defaultCollection.recipient);
    expect(rebuildEthereumNative30RuntimeProofV1(JSON.parse(JSON.stringify(proof)), f.market)).toEqual(proof);
  });
  it("rejects runtime drift and a different chain or pool key", () => {
    const f = proofFixture();
    const codes = { ...f.codes, [f.market.hooks.toLowerCase()]: (`0x00${f.codes[f.market.hooks.toLowerCase()]!.slice(4)}`) as Hex };
    expect(proveEthereumNative30RuntimeV1(f.market, codes)).toBeNull();
    expect(proveEthereumNative30RuntimeV1({ ...f.market, chainId: "4663" } as unknown as EthereumNative30MarketV1, f.codes)).toBeNull();
    expect(proveEthereumNative30RuntimeV1({ ...f.market, tickSpacing: 10 }, f.codes)).toBeNull();
  });
});
