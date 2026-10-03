import { test } from "node:test";
import assert from "node:assert/strict";
import { createRpcHandler } from "./api/robinhood-rpc.mjs";

const env = { FEE_CLAIM_ROBINHOOD_PRIMARY_URL: "https://lb.drpc.live/robinhood/abcdefghijklmnopqrst",
  FEE_CLAIM_ROBINHOOD_SECONDARY_URL: "https://robinhood-mainnet.g.alchemy.com/v2/uvwxyzabcdefghijklmn" };
async function invoke(handler, { method = "eth_blockNumber", params = [], provider = "primary", id = 17, origin, omitParams = false } = {}) {
  const request = { method: "POST", url: `/api/robinhood-rpc?provider=${provider}`,
    headers: { host: "claimhazard.vercel.app", ...(origin ? { origin } : {}) },
    body: { jsonrpc: "2.0", id, method, ...(!omitParams ? { params } : {}) } };
  const reply = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(request, reply); return reply;
}

test("each provider remains independent and response IDs follow the caller", async () => {
  const urls = [];
  const handler = createRpcHandler({ env, fetcher: async url => {
    urls.push(url); return Response.json({ jsonrpc: "2.0", id: 1, result: "0x4b00" });
  } });
  assert.equal((await invoke(handler)).body.id, 17);
  assert.equal((await invoke(handler, { provider: "secondary", id: 18 })).body.id, 18);
  assert.deepEqual(urls, Object.values(env));
});

test("parameterless viem requests are forwarded with an empty parameter list", async () => {
  const handler = createRpcHandler({ env, fetcher: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body).params, []);
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x4b01" });
  } });
  const reply = await invoke(handler, { omitParams: true });
  assert.equal(reply.code, 200);
  assert.equal(reply.body.result, "0x4b01");
});

test("broadcasts, arbitrary simulation targets and cross-origin requests never reach a provider", async () => {
  let calls = 0;
  const handler = createRpcHandler({ env, fetcher: async () => { calls++; throw new Error(); } });
  assert.equal((await invoke(handler, { method: "eth_sendRawTransaction", params: ["0x1234"] })).code, 400);
  assert.equal((await invoke(handler, { method: "eth_call", params: [{ to: "0x1234", data: "0x" }] })).code, 400);
  assert.equal((await invoke(handler, { origin: "https://unrelated.example" })).code, 403);
  assert.equal((await invoke(handler, { provider: "https://unrelated.example" })).code, 503);
  assert.equal(calls, 0);
});

test("rate limits and provider exceptions never expose an endpoint or credential", async () => {
  const limited = createRpcHandler({ env, fetcher: async () => new Response("rate limit", { status: 429 }) });
  assert.equal((await invoke(limited)).code, 429);
  const broken = createRpcHandler({ env, fetcher: async () => { throw new Error(env.FEE_CLAIM_ROBINHOOD_PRIMARY_URL); } });
  const reply = await invoke(broken);
  assert.equal(reply.code, 503);
  assert.equal(JSON.stringify(reply.body).includes("abcdefghijklmnopqrst"), false);
});

test("range limits and revert data remain available for range splitting and simulation", async () => {
  const range = createRpcHandler({ env, fetcher: async () => Response.json({ jsonrpc: "2.0", id: 1,
    error: { code: 22, message: "eth_getLogs range over 100000 blocks is not supported " + env.FEE_CLAIM_ROBINHOOD_PRIMARY_URL } }, { status: 500 }) });
  const result = await invoke(range);
  assert.equal(result.body.error.code, 22);
  assert.match(result.body.error.message, /range/);
  assert.equal(result.body.error.message.includes("https"), false);
  const reverted = createRpcHandler({ env, fetcher: async () => Response.json({ jsonrpc: "2.0", id: 1,
    error: { code: 3, message: "execution reverted", data: "0xdeadbeef" } }) });
  assert.equal((await invoke(reverted)).body.error.data, "0xdeadbeef");
});
