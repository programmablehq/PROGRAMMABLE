import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureDirectory = new URL(
  "./test/fixtures/",
  import.meta.url,
);

async function readFixture(file) {
  return JSON.parse(
    await readFile(new URL(file, fixtureDirectory), "utf8"),
  );
}

function pinnedDependencyStates() {
  return {
    "v4-core": {
      localCommit: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
      upstreamCommit: "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
      dirty: false,
    },
    "v4-periphery": {
      localCommit: "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
      upstreamCommit: "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
      dirty: false,
    },
    "liquidity-launcher": {
      localCommit: "e4660afe4f820f4a39181c7ea1f9bce6c423499f",
      upstreamCommit: "e4660afe4f820f4a39181c7ea1f9bce6c423499f",
      dirty: false,
    },
    "uerc20-factory": {
      localCommit: "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68",
      upstreamCommit: "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68",
      dirty: false,
    },
    permit2: {
      localCommit: "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219",
      upstreamCommit: "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219",
      dirty: false,
    },
  };
}

const verifierImport = await import(
  "./verify-official-deployments-lib.mjs"
).catch((error) => ({ importError: error }));

test("verifies the six canonical Mainnet records against the official registry", async () => {
  assert.equal(
    typeof verifierImport.verifyOfficialDeploymentSnapshot,
    "function",
    verifierImport.importError?.message,
  );

  const dataset = await readFixture("official-deployments.json");
  const snapshot = await readFixture("ethereum-mainnet.json");

  assert.deepEqual(
    verifierImport.verifyOfficialDeploymentSnapshot({
      dataset,
      snapshot,
    }),
    {
      verifiedCount: 6,
      reviewWarnings: [],
    },
  );
});

test("rejects a canonical Mainnet address that differs from the official registry", async () => {
  const dataset = await readFixture("official-deployments.json");
  const snapshot = await readFixture("ethereum-mainnet.json");
  snapshot.contracts.poolManager.address =
    "0x1111111111111111111111111111111111111111";

  assert.throws(
    () =>
      verifierImport.verifyOfficialDeploymentSnapshot({
        dataset,
        snapshot,
      }),
    /poolManager address mismatch on Mainnet/,
  );
});

test("flags registry metadata drift for review without rewriting the pinned snapshot", async () => {
  const dataset = await readFixture("official-deployments.json");
  const snapshot = await readFixture("ethereum-mainnet.json");
  const originalSnapshot = structuredClone(snapshot);
  dataset.generatedAt = "2026-07-29T00:00:00.000Z";
  dataset.source.commit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.deepEqual(
    verifierImport.verifyOfficialDeploymentSnapshot({
      dataset,
      snapshot,
    }),
    {
      verifiedCount: 6,
      reviewWarnings: [
        "Official deployment dataset timestamp drift: pinned 2026-07-15T22:25:40.000Z, upstream 2026-07-29T00:00:00.000Z",
        "Official deployment dataset commit drift: pinned 37936185dee7decf681360ec799c124e0e034672, upstream aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ],
    },
  );
  assert.deepEqual(snapshot, originalSnapshot);
});

test("rejects a Mainnet runtime hash that differs from the pinned contract", async () => {
  assert.equal(
    typeof verifierImport.verifyMainnetRuntimeHashes,
    "function",
  );

  const snapshot = await readFixture("ethereum-mainnet.json");
  const runtimeCodeHashes = Object.fromEntries(
    Object.entries(snapshot.contracts).map(([key, contract]) => [
      key,
      contract.runtimeCodeHash,
    ]),
  );
  runtimeCodeHashes.v4Quoter =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  assert.throws(
    () =>
      verifierImport.verifyMainnetRuntimeHashes({
        snapshot,
        runtimeCodeHashes,
      }),
    /v4Quoter runtime hash mismatch on Mainnet/,
  );
});

test("flags newer upstream dependency heads without changing reviewed pins", async () => {
  assert.equal(typeof verifierImport.verifyDependencyPins, "function");

  const sourcePins = await readFixture("source-pins.json");
  const originalPins = structuredClone(sourcePins);
  const dependencyStates = pinnedDependencyStates();
  dependencyStates["v4-core"].upstreamCommit =
    "46c6834698c48bc4a463a86d8420f4eb1d7f3b75";

  assert.deepEqual(
    verifierImport.verifyDependencyPins({
      sourcePins,
      dependencyStates,
    }),
    {
      verifiedCount: 5,
      pinnedCommits: {
        "v4-core": "59d3ecf53afa9264a16bba0e38f4c5d2231f80bc",
        "v4-periphery": "ad04c9f24a170accf5ea1b2836bbafd514537ca6",
        "liquidity-launcher": "e4660afe4f820f4a39181c7ea1f9bce6c423499f",
        "uerc20-factory": "6f18f1cdf80dc173d33d3cd6bbe91ee52c314f68",
        permit2: "cc56ad0f3439c502c246fc5cfcc3db92bb8b7219",
      },
      reviewWarnings: [
        "Dependency upstream drift requires review: v4-core pinned 59d3ecf53afa9264a16bba0e38f4c5d2231f80bc, upstream HEAD 46c6834698c48bc4a463a86d8420f4eb1d7f3b75",
      ],
    },
  );
  assert.deepEqual(sourcePins, originalPins);
});

test("rejects a local dependency checkout that differs from its reviewed pin", async () => {
  const sourcePins = await readFixture("source-pins.json");
  const dependencyStates = pinnedDependencyStates();
  dependencyStates["v4-periphery"].localCommit =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  assert.throws(
    () =>
      verifierImport.verifyDependencyPins({
        sourcePins,
        dependencyStates,
      }),
    /v4-periphery checkout does not match reviewed pin/,
  );
});

test("rejects uncommitted edits inside a reviewed dependency checkout", async () => {
  const sourcePins = await readFixture("source-pins.json");
  const dependencyStates = pinnedDependencyStates();
  dependencyStates.permit2.dirty = true;

  assert.throws(
    () =>
      verifierImport.verifyDependencyPins({
        sourcePins,
        dependencyStates,
      }),
    /permit2 checkout has uncommitted changes/,
  );
});

test("rejects an RPC endpoint that is not Ethereum Mainnet", async () => {
  assert.equal(
    typeof verifierImport.fetchMainnetRuntimeHashes,
    "function",
  );
  const snapshot = await readFixture("ethereum-mainnet.json");
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: "0xaa36a7",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  await assert.rejects(
    () =>
      verifierImport.fetchMainnetRuntimeHashes({
        snapshot,
        rpcUrl: "https://rpc.invalid",
        fetchImpl,
      }),
    /RPC chain ID 11155111 is not Ethereum Mainnet/,
  );
});

test("runtime fallback is restricted to infrastructure faults and never masks invalid chain or code", async () => {
  const snapshot = await readFixture("ethereum-mainnet.json");
  const calls = [];
  const success = (_url, options) => {
    const request = JSON.parse(options.body);
    const result = request.method === "eth_chainId" ? "0x1"
      : request.method === "eth_blockNumber" ? "0x123" : "0x6000";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  };
  for (const status of [408, 429, 500, 502, 503, 504]) {
    calls.length = 0;
    const result = await verifierImport.fetchMainnetRuntimeHashesWithFallback({ snapshot,
      rpcUrls: ["https://first.invalid", "https://second.invalid"],
      fetchImpl: async (url, options) => {
        calls.push(url);
        return url === "https://first.invalid" ? new Response("unavailable", { status }) : success(url, options);
      } });
    assert.equal(result.blockNumber, 0x123);
    assert.equal(calls[0], "https://first.invalid");
    assert.equal(calls.slice(1).every((url) => url === "https://second.invalid"), true);
  }
  for (const fault of [
    () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" })),
    () => new Response(JSON.stringify({ error: { code: -32602, message: "Invalid params" } })),
    () => new Response("invalid JSON"),
    () => new Response("unauthorized", { status: 401 }),
  ]) {
    calls.length = 0;
    await assert.rejects(() => verifierImport.fetchMainnetRuntimeHashesWithFallback({ snapshot,
      rpcUrls: ["https://first.invalid", "https://second.invalid"],
      fetchImpl: async (url) => { calls.push(url); return fault(); } }));
    assert.deepEqual(calls, ["https://first.invalid"]);
  }
  calls.length = 0;
  await assert.rejects(() => verifierImport.fetchMainnetRuntimeHashesWithFallback({ snapshot,
    rpcUrls: ["https://explicit.invalid"],
    fetchImpl: async (url) => { calls.push(url); return new Response("limit", { status: 429 }); } }));
  assert.deepEqual(calls, ["https://explicit.invalid"]);
});

test("runtime fallback restarts chain/block/code reads together and preserves fail-closed bytecode validation", async () => {
  const snapshot = await readFixture("ethereum-mainnet.json");
  const calls = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, method: request.method, params: request.params });
    if (url === "https://first.invalid" && request.method === "eth_getCode") {
      return new Response(JSON.stringify({ error: { code: -32005, message: "rate limit" } }));
    }
    const result = request.method === "eth_chainId" ? "0x1"
      : request.method === "eth_blockNumber" ? (url === "https://first.invalid" ? "0x123" : "0x124") : "0x6000";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  };
  const result = await verifierImport.fetchMainnetRuntimeHashesWithFallback({ snapshot,
    rpcUrls: ["https://first.invalid", "https://second.invalid"], fetchImpl });
  assert.equal(result.blockNumber, 0x124);
  const second = calls.filter((call) => call.url === "https://second.invalid");
  assert.deepEqual(second.slice(0, 2).map((call) => call.method), ["eth_chainId", "eth_blockNumber"]);
  assert.equal(second.filter((call) => call.method === "eth_getCode").length, 6);
  assert.ok(second.slice(2).every((call) => call.params[1] === "0x124"));
  assert.throws(() => verifierImport.verifyMainnetRuntimeHashes({ snapshot, runtimeCodeHashes: result.runtimeCodeHashes }));
});

test("known transient transport faults may restart the snapshot, but empty code and unknown faults stay fatal", async () => {
  const snapshot = await readFixture("ethereum-mainnet.json");
  for (const fault of [
    new DOMException("Timed out", "TimeoutError"),
    new TypeError("Fetch failed", { cause: { code: "ECONNRESET" } }),
  ]) {
    const calls = [];
    const result = await verifierImport.fetchMainnetRuntimeHashesWithFallback({ snapshot,
      rpcUrls: ["https://first.invalid", "https://second.invalid"],
      fetchImpl: async (url, options) => {
        calls.push(url);
        if (url === "https://first.invalid") throw fault;
        const request = JSON.parse(options.body);
        const value = request.method === "eth_chainId" ? "0x1"
          : request.method === "eth_blockNumber" ? "0x123" : "0x6000";
        return new Response(JSON.stringify({ result: value }));
      } });
    assert.equal(result.blockNumber, 0x123);
    assert.equal(calls.filter((url) => url === "https://second.invalid").length, 8);
  }
  for (const fault of [new Error("Unclassified failure"),
    new TypeError("Fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } }), null]) {
    const calls = [];
    await assert.rejects(() => verifierImport.fetchMainnetRuntimeHashesWithFallback({ snapshot,
      rpcUrls: ["https://first.invalid", "https://second.invalid"],
      fetchImpl: async (url, options) => {
        calls.push(url);
        if (fault) throw fault;
        const request = JSON.parse(options.body);
        return new Response(JSON.stringify({ result: request.method === "eth_chainId" ? "0x1"
          : request.method === "eth_blockNumber" ? "0x123" : "0x" }));
      } }));
    assert.ok(calls.every((url) => url === "https://first.invalid"));
  }
});

test("hashes all six contracts from one explicit Mainnet block", async () => {
  const snapshot = await readFixture("ethereum-mainnet.json");
  const codeByAddress = new Map([
    [snapshot.contracts.poolManager.address.toLowerCase(), "0x6000"],
    [snapshot.contracts.positionManager.address.toLowerCase(), "0x6001"],
    [snapshot.contracts.stateView.address.toLowerCase(), "0x6002"],
    [snapshot.contracts.v4Quoter.address.toLowerCase(), "0x6003"],
    [snapshot.contracts.universalRouter.address.toLowerCase(), "0x6004"],
    [snapshot.contracts.permit2.address.toLowerCase(), "0x6005"],
  ]);
  const codeBlockTags = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    let result;
    if (request.method === "eth_chainId") {
      result = "0x1";
    } else if (request.method === "eth_blockNumber") {
      result = "0x12d687";
    } else if (request.method === "eth_getCode") {
      codeBlockTags.push(request.params[1]);
      result = codeByAddress.get(request.params[0].toLowerCase());
    } else {
      throw new Error(`Unexpected RPC method ${request.method}`);
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  assert.deepEqual(
    await verifierImport.fetchMainnetRuntimeHashes({
      snapshot,
      rpcUrl: "https://rpc.invalid",
      fetchImpl,
    }),
    {
      blockNumber: 1_234_567,
      runtimeCodeHashes: {
        poolManager:
          "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
        positionManager:
          "0x309c67890bde4c575dc23d2cc3b5c3a3d599e312e980e9b61b5bc8f3cd87c8bb",
        stateView:
          "0xcde7aac41575d8b30bd84f598371d46d266fadb09c9dcfcdd047fd087ef8763e",
        v4Quoter:
          "0x124787cd33af4a91148bc5521374b123cb0c5aaa5b0f02ff8d9bf1bb816791b8",
        universalRouter:
          "0x48ff38a7839bff5a0a8ec3ebb1de0c376b5886f85817779bd4e7a0f82ed99b46",
        permit2:
          "0x833657cddc570dd91a5715fcdb759e6dc72e3670b7506790c97b974b3276926d",
      },
    },
  );
  assert.deepEqual(codeBlockTags, Array(6).fill("0x12d687"));
});
