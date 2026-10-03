const METHODS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_getLogs", "eth_call",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBalance", "eth_gasPrice",
  "eth_getTransactionCount", "eth_estimateGas",
]);
const MESSAGE = "Die Netzwerkverbindung ist gerade nicht verfügbar. Bitte gleich erneut versuchen.";
const MULTICALL = "0xca11bde05977b3631167028862be2a173976ca11";
const cache = new Map();
const pending = new Map();

function endpoint(provider, env) {
  const keys = { primary: ["FEE_CLAIM_ROBINHOOD_PRIMARY_URL", /^https:\/\/lb\.drpc\.live\/robinhood\/[A-Za-z0-9_-]{16,256}$/],
    secondary: ["FEE_CLAIM_ROBINHOOD_SECONDARY_URL", /^https:\/\/robinhood-mainnet\.g\.alchemy\.com\/v2\/[A-Za-z0-9_-]{16,256}$/] };
  const pair = keys[provider];
  if (!pair || !pair[1].test(env[pair[0]] ?? "")) throw new Error("RPC_CONFIGURATION_INVALID");
  return env[pair[0]];
}

function validRequest(body) {
  if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" || !METHODS.has(body.method) ||
    !(typeof body.id === "string" || Number.isSafeInteger(body.id)) || !Array.isArray(body.params) ||
    JSON.stringify(body).length > 65_536) return false;
  // Only the verified Multicall can be simulated. Transactions are sent by the user's wallet.
  if (["eth_call", "eth_estimateGas"].includes(body.method)) {
    const call = body.params[0];
    if (!call || String(call.to).toLowerCase() !== MULTICALL || !/^0x82ad56cb[0-9a-f]*$/i.test(call.data ?? "") ||
      (call.value !== undefined && BigInt(call.value) !== 0n) ||
      (call.gas !== undefined && BigInt(call.gas) > 16_000_000n)) return false;
  }
  if (body.method === "eth_getLogs") {
    const filter = body.params[0];
    if (!filter || !/^0x[0-9a-f]{40}$/i.test(filter.address ?? "") ||
      !/^0x[0-9a-f]+$/i.test(filter.fromBlock ?? "") || !/^0x[0-9a-f]+$/i.test(filter.toBlock ?? "") ||
      !Array.isArray(filter.topics) || !/^0x[0-9a-f]{64}$/i.test(filter.topics[0] ?? "")) return false;
  }
  return true;
}

async function boundedJson(response) {
  if (!response.body) throw new Error("RPC_RESPONSE_INVALID");
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 4_194_304) { await reader.cancel(); throw new Error("RPC_RESPONSE_TOO_LARGE"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

function ttl(body) {
  // Keep chain checkpoints, balances, estimates and call simulations fresh.
  if (["eth_getLogs", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getCode"].includes(body.method)) return 60_000;
  if (body.method === "eth_chainId") return 300_000;
  return 0;
}

export function createRpcHandler({ env = process.env, fetcher = fetch } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    const fail = (status, id = null, code = -32000, message = MESSAGE, data) => response.status(status).json({
      jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) },
    });
    if (request.method !== "POST") { response.setHeader("Allow", "POST"); return fail(405); }
    let body;
    try {
      body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
      if (body && !Array.isArray(body) && body.params === undefined) body = { ...body, params: [] };
      if (!validRequest(body)) return fail(400, body?.id ?? null, -32600, "Dieser RPC-Aufruf ist nicht erlaubt.");
      const url = new URL(request.url, "https://claimhazard.vercel.app");
      const provider = url.searchParams.get("provider"), target = endpoint(provider, env);
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return fail(403, body.id);
      const key = JSON.stringify([provider, body.method, body.params]);
      const cached = cache.get(key);
      if (cached && cached.until > Date.now()) return response.status(200).json({ jsonrpc: "2.0", id: body.id, result: cached.result });
      const read = async () => {
        const upstream = await fetcher(target, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, id: 1 }), signal: AbortSignal.timeout(15_000), redirect: "error" });
        if (upstream.status === 429) throw new Error("RPC_RATE_LIMIT");
        const result = await boundedJson(upstream);
        if (result.jsonrpc !== "2.0" || result.id !== 1) throw new Error("RPC_RESPONSE_INVALID");
        if (result.error) {
          const error = new Error("RPC_UPSTREAM_ERROR"); error.rpcCode = result.error.code;
          // Reverts and range limits are needed for correct simulation and range splitting.
          error.rpcMessage = /range|too many|more than|response size|limit exceeded/i.test(result.error.message ?? "")
            ? "RPC block range or response size limit exceeded" : result.error.code === 3 ? "execution reverted" : MESSAGE;
          if (/^0x[0-9a-f]{0,65536}$/i.test(result.error.data ?? "")) error.rpcData = result.error.data;
          throw error;
        }
        if (!upstream.ok) throw new Error("RPC_UNAVAILABLE");
        if (!Object.hasOwn(result, "result")) throw new Error("RPC_RESPONSE_INVALID");
        const duration = ttl(body);
        if (duration && result.result !== null) {
          if (cache.size >= 512) cache.delete(cache.keys().next().value);
          cache.set(key, { result: result.result, until: Date.now() + duration });
        }
        return result.result;
      };
      let promise = pending.get(key);
      if (!promise) { promise = read(); pending.set(key, promise); }
      let result;
      try { result = await promise; } finally { if (pending.get(key) === promise) pending.delete(key); }
      return response.status(200).json({ jsonrpc: "2.0", id: body.id, result });
    } catch (error) {
      if (error.rpcCode !== undefined) return fail(200, body?.id ?? null, error.rpcCode, error.rpcMessage, error.rpcData);
      return fail(error.message === "RPC_RATE_LIMIT" ? 429 : 503, body?.id ?? null);
    }
  };
}

export default createRpcHandler();
