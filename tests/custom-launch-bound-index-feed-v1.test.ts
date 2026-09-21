import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { launchProjectionSourceV1, syncLaunchProjectionIndex } from "@/lib/server/robinhood-index/launch-projection-source";
import { indexedLaunchProjectionV1 } from "@/lib/server/robinhood-index/indexed-launch-projection-v1";
import { launchList, parseSnapshot, profileLaunchList, tokenLaunchRecord, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { component, controller, hash, nowIso, projectionFixture, runtime, runtimeHash, stamp } from "./fixtures/universal-launch-v1";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("bound open-provenance feed through the real website index", () => {
  it("reads the feed, independently verifies two RPCs, persists and exposes the same launch in Explore, Profile and Detail", async () => {
    const base = projectionFixture();
    const stampWitness = { address: stamp, runtimeCodeHash: runtimeHash, controller, onchainLaunchId: hash, stampHash: hash, permitDigest: hash };
    const projection = { ...base, publication: { visibility: "listed" as const, name: "Own provenance program", primaryComponentId: "settlement" },
      finality: { ...base.finality, witness: { kind: "chain_read" as const, ref: "fixture:bound-open-provenance", details: { stamp: stampWitness } } } };
    const observed = new Set<string>(); let wrongRuntime = false;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url!, "http://fixture.local");
      response.setHeader("content-type", "application/json");
      if (url.pathname === "/feed") { response.end(JSON.stringify({ schemaVersion: "programmable.launch-projection-page.v1", launches: [projection], nextCursor: null })); return; }
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString()); observed.add(`${url.pathname}:${rpc.method}`);
      let result: unknown;
      if (rpc.method === "eth_chainId") result = "0x1237";
      else if (rpc.method === "eth_getBlockByNumber") result = { hash, number: "0x2a", timestamp: "0x6a000000", transactions: [] };
      else if (rpc.method === "eth_getTransactionReceipt") result = { transactionHash: hash, status: "0x1", blockNumber: "0x2a", blockHash: hash, logs: [] };
      else if (rpc.method === "eth_getCode") result = wrongRuntime && url.pathname === "/secondary" ? "0x6002" : runtime;
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
    } finally { server.closeAllConnections(); server.close(); await once(server, "close"); await rm(directory, { recursive: true }); }
  });
});
