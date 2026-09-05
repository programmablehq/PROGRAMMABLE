import { keccak256 } from "viem";

export const OFFICIAL_DEPLOYMENTS_URL =
  "https://developers.uniswap.org/deployments.json";

const EXPECTED_DATASET_REPOSITORY = "https://github.com/Uniswap/contracts";

export const MAINNET_CANONICAL_RECORDS = {
  poolManager: { protocol: "v4", contract: "PoolManager" },
  positionManager: { protocol: "v4", contract: "PositionManager" },
  stateView: { protocol: "v4", contract: "StateView" },
  v4Quoter: { protocol: "v4", contract: "V4Quoter" },
  universalRouter: {
    protocol: "universal-router",
    contract: "UniversalRouter",
  },
  permit2: { protocol: "permit2", contract: "Permit2" },
};

export const REQUIRED_SOURCE_DEPENDENCIES = [
  "v4-core",
  "v4-periphery",
  "liquidity-launcher",
  "uerc20-factory",
  "permit2",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeSourceRef(sourceRef) {
  return sourceRef
    .toLowerCase()
    .replace(/^(?:v4-core|v4-periphery)@/, "");
}

export function verifyOfficialDeploymentSnapshot({ dataset, snapshot }) {
  assert(dataset.version === "1.0.0", `Unsupported dataset ${dataset.version}`);
  assert(
    dataset.source?.repo === EXPECTED_DATASET_REPOSITORY,
    "Unexpected deployment dataset source repository",
  );
  assert(Array.isArray(dataset.records), "Deployment records are missing");
  assert(snapshot.chainId === 1, "Official runtime snapshot must be Mainnet");
  assert(
    snapshot.source?.deployments === OFFICIAL_DEPLOYMENTS_URL,
    "Mainnet snapshot points to an unexpected deployment source",
  );

  const reviewWarnings = [];
  if (snapshot.source?.generatedAt !== dataset.generatedAt) {
    reviewWarnings.push(
      `Official deployment dataset timestamp drift: pinned ${snapshot.source?.generatedAt}, upstream ${dataset.generatedAt}`,
    );
  }
  if (snapshot.source?.sourceCommit !== dataset.source?.commit) {
    reviewWarnings.push(
      `Official deployment dataset commit drift: pinned ${snapshot.source?.sourceCommit}, upstream ${dataset.source?.commit}`,
    );
  }

  let verifiedCount = 0;
  for (const [key, identity] of Object.entries(MAINNET_CANONICAL_RECORDS)) {
    const local = snapshot.contracts?.[key];
    assert(local, `Mainnet snapshot is missing ${key}`);

    const official = dataset.records.find(
      (record) =>
        record.chainId === 1 &&
        record.protocol === identity.protocol &&
        record.contract === identity.contract,
    );

    assert(
      official,
      `No official ${identity.contract} record exists for Mainnet`,
    );
    assert(
      official.status === "active",
      `${official.id} is ${official.status}, not active`,
    );
    assert(
      official.address.toLowerCase() === local.address.toLowerCase(),
      `${key} address mismatch on Mainnet`,
    );
    assert(
      official.sourceRepo?.startsWith("https://github.com/Uniswap/"),
      `${official.id} has an unexpected source repository`,
    );
    assert(
      official.sourceCodeUrl?.startsWith("https://github.com/Uniswap/"),
      `${official.id} has no official source code link`,
    );

    if (local.sourceRef) {
      assert(
        normalizeSourceRef(official.sourceRef) ===
          normalizeSourceRef(local.sourceRef),
        `${key} source reference mismatch on Mainnet`,
      );
    }

    verifiedCount += 1;
  }

  return { verifiedCount, reviewWarnings };
}

export function verifyMainnetRuntimeHashes({
  snapshot,
  runtimeCodeHashes,
}) {
  let verifiedCount = 0;

  for (const key of Object.keys(MAINNET_CANONICAL_RECORDS)) {
    const expected = snapshot.contracts?.[key]?.runtimeCodeHash;
    const actual = runtimeCodeHashes?.[key];
    assert(expected, `Mainnet snapshot is missing ${key} runtime hash`);
    assert(actual, `Mainnet runtime hash is missing for ${key}`);
    assert(
      actual.toLowerCase() === expected.toLowerCase(),
      `${key} runtime hash mismatch on Mainnet`,
    );
    verifiedCount += 1;
  }

  return { verifiedCount };
}

function repositoryName(repository) {
  const pathname = new URL(repository).pathname.replace(/\/$/, "");
  return pathname.split("/").at(-1).replace(/\.git$/, "").toLowerCase();
}

export function verifyDependencyPins({ sourcePins, dependencyStates }) {
  assert(sourcePins.schemaVersion === 1, "Unsupported source pin schema");
  assert(
    Array.isArray(sourcePins.dependencies),
    "Source pin dependencies are missing",
  );

  const pinnedCommits = {};
  const reviewWarnings = [];
  let verifiedCount = 0;

  for (const dependency of REQUIRED_SOURCE_DEPENDENCIES) {
    const pin = sourcePins.dependencies.find(
      (candidate) => repositoryName(candidate.repository) === dependency,
    );
    assert(pin, `Missing reviewed source pin for ${dependency}`);
    assert(
      /^[0-9a-f]{40}$/.test(pin.commit),
      `Invalid reviewed source pin for ${dependency}`,
    );

    const state = dependencyStates?.[dependency];
    assert(state, `Missing dependency state for ${dependency}`);
    assert(
      state.localCommit?.toLowerCase() === pin.commit,
      `${dependency} checkout does not match reviewed pin`,
    );
    assert(!state.dirty, `${dependency} checkout has uncommitted changes`);
    assert(
      /^[0-9a-f]{40}$/.test(state.upstreamCommit ?? ""),
      `Missing upstream HEAD for ${dependency}`,
    );

    pinnedCommits[dependency] = pin.commit;
    if (state.upstreamCommit.toLowerCase() !== pin.commit) {
      reviewWarnings.push(
        `Dependency upstream drift requires review: ${dependency} pinned ${pin.commit}, upstream HEAD ${state.upstreamCommit.toLowerCase()}`,
      );
    }
    verifiedCount += 1;
  }

  return { verifiedCount, pinnedCommits, reviewWarnings };
}

class RpcInfrastructureError extends Error {}

async function rpcRequest({ rpcUrl, fetchImpl, method, params, id }) {
  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });
  } catch (error) {
    if (error?.name === "TimeoutError"
      || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]
        .includes(error?.cause?.code)) throw new RpcInfrastructureError(`Mainnet RPC ${method} transport failed`);
    throw error;
  }
  if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
    throw new RpcInfrastructureError(`Mainnet RPC returned HTTP ${response.status}`);
  }
  assert(response.ok, `Mainnet RPC returned HTTP ${response.status}`);

  const payload = await response.json();
  if (payload.error?.code === -32005 || ([-32000, -32016, -32603, 429].includes(payload.error?.code)
    && /\b(?:rate limit|too many requests|request limit exceeded)\b/iu.test(payload.error?.message ?? ""))) {
    throw new RpcInfrastructureError(`Mainnet RPC ${method} was rate limited`);
  }
  assert(!payload.error, `Mainnet RPC ${method} failed`);
  assert(payload.result !== undefined, `Mainnet RPC ${method} has no result`);
  return payload.result;
}

export async function fetchMainnetRuntimeHashes({
  snapshot,
  rpcUrl,
  fetchImpl = fetch,
}) {
  assert(snapshot.chainId === 1, "Runtime snapshot must target Mainnet");
  const chainIdHex = await rpcRequest({
    rpcUrl,
    fetchImpl,
    method: "eth_chainId",
    params: [],
    id: 1,
  });
  const chainId = Number.parseInt(chainIdHex, 16);
  assert(chainId === 1, `RPC chain ID ${chainId} is not Ethereum Mainnet`);

  const blockTag = await rpcRequest({
    rpcUrl,
    fetchImpl,
    method: "eth_blockNumber",
    params: [],
    id: 2,
  });
  const blockNumber = Number.parseInt(blockTag, 16);
  assert(
    Number.isSafeInteger(blockNumber),
    "Mainnet RPC returned an invalid block number",
  );

  const runtimeEntries = [];
  // Six concurrent archive-code reads can exhaust a public provider's quota.
  // Read the same pinned block sequentially and abandon only transport faults.
  for (const [index, key] of Object.keys(MAINNET_CANONICAL_RECORDS).entries()) {
    const address = snapshot.contracts?.[key]?.address;
    assert(address, `Mainnet snapshot is missing ${key} address`);
    const runtimeCode = await rpcRequest({
      rpcUrl,
      fetchImpl,
      method: "eth_getCode",
      params: [address, blockTag],
      id: index + 3,
    });
    assert(
      /^0x[0-9a-f]+$/i.test(runtimeCode),
      `${key} has no runtime code on Mainnet`,
    );
    runtimeEntries.push([key, keccak256(runtimeCode)]);
  }

  return {
    blockNumber,
    runtimeCodeHashes: Object.fromEntries(runtimeEntries),
  };
}

export async function fetchMainnetRuntimeHashesWithFallback({ snapshot, rpcUrls, fetchImpl = fetch }) {
  assert(Array.isArray(rpcUrls) && rpcUrls.length > 0, "A Mainnet RPC is required");
  for (const [index, rpcUrl] of rpcUrls.entries()) {
    try {
      return await fetchMainnetRuntimeHashes({ snapshot, rpcUrl, fetchImpl });
    } catch (error) {
      if (!(error instanceof RpcInfrastructureError) || index === rpcUrls.length - 1) throw error;
      console.warn("Mainnet runtime provider had an infrastructure failure; retrying the complete snapshot with the next configured provider.");
    }
  }
  throw new Error("Mainnet runtime providers were exhausted");
}
