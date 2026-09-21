import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbiParameters, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { launchProjectionSourceV1, syncLaunchProjectionIndex } from "@/lib/server/robinhood-index/launch-projection-source";
import { indexedLaunchProjectionV1 } from "@/lib/server/robinhood-index/indexed-launch-projection-v1";
import { launchList, parseSnapshot, profileLaunchList, tokenLaunchRecord, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { component, controller, hash, nowIso, projectionFixture, recordFixture, runtime, runtimeHash, stamp } from "./fixtures/universal-launch-v1";
import { atomicExecutor, atomicRecordFixture } from "./fixtures/atomic-launch-v2";
import { CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, customLaunchPlanAtomicOrderDigestV2, customLaunchPlanAtomicStampHashV2, decodeCustomLaunchPlanAtomicCallV2 } from "@/lib/custom-launch/atomic-plan-codec-v2";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("bound open-provenance feed through the real website index", () => {
  it.each(["stamp-v1", "atomic-v2"])("reads %s from the feed through two RPCs into Explore, Profile and Detail", async mode => {
    const atomic = mode === "atomic-v2", original = projectionFixture(), baseRecord = recordFixture();
    const record = atomicRecordFixture({ ...baseRecord, plan: { ...baseRecord.plan, markets: [{ marketId: "pool", kind: "uniswap_v4",
      poolManager: "0x7777777777777777777777777777777777777777", currency0: { address: "0x0000000000000000000000000000000000000000" },
      currency1: { componentId: "settlement" }, hooks: { address: "0x0000000000000000000000000000000000000000" }, fee: 3000, tickSpacing: 60 }] } });
    const envelope = decodeCustomLaunchPlanAtomicCallV2(record.steps[0].transaction.data), { order } = envelope;
    const orderDigest = customLaunchPlanAtomicOrderDigestV2(order), stampHash = customLaunchPlanAtomicStampHashV2(orderDigest);
    const market = envelope.markets[0], poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
      [market.currency0, market.currency1, market.fee, market.tickSpacing, market.hooks]));
    const base = atomic ? { ...original, planHash: record.planHash, manifestDigest: record.manifestDigest, components: record.plan.components, markets: record.plan.markets } : original;
    const stampWitness = { address: stamp, runtimeCodeHash: runtimeHash, controller, onchainLaunchId: hash, stampHash: hash, permitDigest: hash };
    const atomicWitness = { schemaVersion: "programmable.custom-launch-plan-atomic-stamp-witness.v2", executorKind: "atomic_execute_and_stamp_v2",
      address: atomicExecutor, runtimeCodeHash: runtimeHash, controller, onchainLaunchId: order.launchId, planHash: record.planHash,
      manifestDigest: record.manifestDigest, stampHash, permitDigest: orderDigest, orderDigest, callsHash: order.callsHash, callCount: 2,
      blockNumber: "42", blockHash: hash, sourceEvidenceDigest: record.planHash, releaseId: record.planHash, admissionReceiptHash: record.planHash,
      eventLogIndexes: ["0", "1", "2", "3", "4"] };
    const projection = { ...base, publication: { visibility: "listed" as const, name: "Own provenance program", primaryComponentId: "settlement" },
      finality: { ...base.finality, witness: { kind: "chain_read" as const, ref: "fixture:bound-open-provenance", details: { stamp: atomic ? atomicWitness : stampWitness } } } };
    const events = [
      ...envelope.calls.map((call, index) => ({ eventName: "AtomicProjectCallExecutedV2" as const, args: { launchId: order.launchId, callIndex: BigInt(index), target: call.target } })),
      { eventName: "AtomicPlanComponentStampedV2" as const, args: { launchId: order.launchId, ...envelope.components[0] } },
      { eventName: "AtomicPlanMarketStampedV2" as const, args: { launchId: order.launchId, marketId: market.marketId, poolId, poolManager: market.poolManager } },
      { eventName: "AtomicPlanStampedV2" as const, args: { launchId: order.launchId, controller, planHash: order.planHash, manifestDigest: order.manifestDigest, orderDigest, stampHash, callsHash: order.callsHash } },
    ];
    const logs = events.map((event, index) => {
      const definition = CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2.find(item => item.type === "event" && item.name === event.eventName)!;
      if (definition.type !== "event") throw new Error("Missing fixture event");
      const inputs = definition.inputs.filter(input => !input.indexed);
      return { address: atomicExecutor, data: encodeAbiParameters(inputs, inputs.map(input => (event.args as Record<string, unknown>)[input.name]) as never),
        topics: encodeEventTopics({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, ...event } as never) as Hex[],
        blockNumber: "0x2a", blockHash: hash, transactionHash: hash, transactionIndex: "0x0", logIndex: `0x${index.toString(16)}`, removed: false };
    });
    const observed = new Set<string>(); let wrongRuntime = false, paddedTopic = false, paddedProof = false, emptyPool = false;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, "http://fixture.local");
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/feed") { response.end(JSON.stringify({ schemaVersion: "programmable.launch-projection-page.v1", launches: [projection], nextCursor: null })); return; }
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString()); observed.add(`${url.pathname}:${rpc.method}`);
      let result: unknown;
      if (rpc.method === "eth_chainId") result = "0x1237";
      else if (rpc.method === "eth_getBlockByNumber") result = { hash, number: "0x2a", timestamp: "0x6a000000", transactions: [] };
      else if (rpc.method === "eth_getTransactionReceipt") result = { transactionHash: hash, status: "0x1", blockNumber: "0x2a", blockHash: hash,
        logs: atomic ? logs.map((log, index) => paddedTopic && index === 0 ? { ...log, topics: [...log.topics.slice(0, 3), `0x01${log.topics[3].slice(4)}`] } : log) : [] };
      else if (rpc.method === "eth_getTransactionByHash") result = { hash, from: controller, to: atomicExecutor, input: record.steps[0].transaction.data,
        value: "0x0", nonce: "0x7", gas: "0x445c0", chainId: "0x1237", type: "0x2", blockHash: hash, blockNumber: "0x2a", transactionIndex: "0x0" };
      else if (rpc.method === "eth_getCode") result = wrongRuntime && url.pathname === "/secondary" ? "0x6002" : runtime;
      else if (rpc.method === "eth_call" && atomic) {
        expect(rpc.params[1]).toEqual({ blockHash: hash, requireCanonical: true });
        const decoded = rpc.params[0].to.toLowerCase() === market.poolManager.toLowerCase() ? { functionName: "extsload" }
          : decodeFunctionData({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, data: rpc.params[0].data });
        if (decoded.functionName === "launchStampV2") result = encodeFunctionResult({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, functionName: "launchStampV2",
          result: { stampHash, orderDigest, planHash: order.planHash, manifestDigest: order.manifestDigest, callsHash: order.callsHash, controller, blockNumber: 42n } });
        else if (decoded.functionName === "stampProofV2") {
          result = encodeFunctionResult({ abi: CUSTOM_LAUNCH_PLAN_ATOMIC_ABI_V2, functionName: "stampProofV2", result: [component, runtimeHash, stampHash] });
          if (paddedProof) result = `0x01${String(result).slice(4)}`;
        } else if (decoded.functionName === "marketPoolId") result = poolId;
        else if (decoded.functionName === "extsload") result = `0x${(emptyPool ? "0" : "1").padStart(64, "0")}`;
        else throw new Error("Unexpected Atomic getter");
      }
      else if (rpc.method === "eth_call") result = encodeAbiParameters([{ type: "tuple", components: [{ type: "bytes32", name: "stampHash" }, { type: "bytes32", name: "permitDigest" }, { type: "bytes32", name: "planHash" }, { type: "bytes32", name: "manifestDigest" }, { type: "address", name: "controller" }, { type: "uint256", name: "blockNumber" }] }],
        [{ stampHash: hash, permitDigest: hash, planHash: `0x${projection.planHash!.slice(7)}`, manifestDigest: `0x${projection.manifestDigest!.slice(7)}`, controller, blockNumber: 42n }]);
      else { response.statusCode = 400; response.end(JSON.stringify({ error: `Unexpected RPC ${rpc.method}` })); return; }
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture server failed");
    const directory = await mkdtemp(join(tmpdir(), "custom-launch-bound-index-"));
    const path = join(directory, "index.json");
    const saved: RobinhoodSnapshot = { version: 1, chainId: 4663, routerAddress: stamp, binding: hash, startBlock: "1", cursor: { number: "42", hash }, checkpoints: [{ number: "42", hash }], finalizedBlock: "42", updatedAt: nowIso, items: [] };
    await writeFile(path, JSON.stringify(saved));
    const fetchLive = globalThis.fetch;
    vi.stubEnv("ROBINHOOD_RPC_URL", "https://primary.fixture.local"); vi.stubEnv("ROBINHOOD_RPC_SECONDARY_URL", "https://secondary.fixture.local");
    // All production parsers and RPC clients remain real. Only these exact remote endpoints map to the bound local feed/RPC fixture.
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const route = url.hostname === "api.programmable.market" && url.pathname === "/v4/chains/4663/finalized-launch-projections" ? "feed"
        : url.hostname === "primary.fixture.local" ? "primary" : url.hostname === "secondary.fixture.local" ? "secondary" : null;
      if (!route) throw new Error(`Unbound fixture endpoint ${url.origin}`);
      return fetchLive(`http://127.0.0.1:${address.port}/${route}`, init);
    });
    const store = { read: async () => ({ snapshot: parseSnapshot(JSON.parse(await readFile(path, "utf8"))), etag: "fixture-v1" }),
      write: async (value: RobinhoodSnapshot, etag: string | null) => { expect(etag).toBe("fixture-v1"); await writeFile(path, JSON.stringify(parseSnapshot(value))); } };
    try {
      expect(indexedLaunchProjectionV1(saved, projection.launchId, projection.sourceVersion)).toBeNull();
      expect(await syncLaunchProjectionIndex(launchProjectionSourceV1(), store)).toMatchObject({ status: "ready", indexed: 1 });
      const indexed = (await store.read()).snapshot;
      expect(indexedLaunchProjectionV1(indexed, projection.launchId, projection.sourceVersion)?.href).toBe(`/token/${component}?chain=4663`);
      expect(launchList(indexed).items.map(row => row.launchId)).toContain(projection.launchId);
      expect(profileLaunchList(indexed, controller).items.map(row => row.launchId)).toContain(projection.launchId);
      expect(tokenLaunchRecord(indexed, component).token?.launchProjection).toEqual(projection);
      for (const provider of ["primary", "secondary"]) for (const method of ["eth_chainId", "eth_getBlockByNumber", "eth_getTransactionReceipt", "eth_getCode", "eth_call"]) expect(observed.has(`/${provider}:${method}`)).toBe(true);
      const before = await readFile(path, "utf8"); wrongRuntime = true;
      projection.sourceVerification = "partial";
      await expect(syncLaunchProjectionIndex(launchProjectionSourceV1(), store)).rejects.toThrow(/runtime mismatch/);
      expect(await readFile(path, "utf8")).toBe(before);
      if (atomic) {
        wrongRuntime = false; paddedTopic = true;
        await expect(syncLaunchProjectionIndex(launchProjectionSourceV1(), store)).rejects.toThrow(/occurrence binding mismatch/);
        paddedTopic = false; paddedProof = true;
        await expect(syncLaunchProjectionIndex(launchProjectionSourceV1(), store)).rejects.toThrow(/occurrence binding mismatch/);
        paddedProof = false; emptyPool = true;
        await expect(syncLaunchProjectionIndex(launchProjectionSourceV1(), store)).rejects.toThrow(/occurrence binding mismatch/);
        emptyPool = false; projection.finality.transactionHashes = [hash, hash];
        await expect(syncLaunchProjectionIndex(launchProjectionSourceV1(), store)).rejects.toThrow(/occurrence binding mismatch/);
        expect(await readFile(path, "utf8")).toBe(before);
      }
    } finally { server.closeAllConnections(); server.close(); await once(server, "close"); await rm(directory, { recursive: true }); }
  });
});
