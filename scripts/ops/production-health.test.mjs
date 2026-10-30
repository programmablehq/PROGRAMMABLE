import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceIncidentState, assessHealth, collectObservations, TARGETS } from "./production-health.mjs";

const NOW = Date.parse("2026-10-28T13:00:00Z");
const sourceCommit = "a".repeat(40);
const updatedAt = new Date(NOW - 60_000).toISOString();
function healthy() {
  return TARGETS.map(target => {
    let body;
    if (target.id === "indexes") body = {
      schemaVersion: "programmable.operations-health.v2", status: "ready", checkedAt: updatedAt,
      indexes: [1, 4663, 8453, 999].map(chainId => ({ chainId, status: "ready", updatedAt })),
    };
    else if (target.chainId) body = {
      status: "ready", items: [{ chainId: target.chainId, tokenAddress: target.tokenAddress,
        market: { priceUsd: 1, marketCapUsd: 100, observedAt: updatedAt } }],
    };
    else if (target.id === "api") body = { status: "ready", sourceCommit };
    else body = { mode: "active", ready: true, readsReady: true, finalityReady: true, sourceWorkerReady: true, sourceCommit };
    return { id: target.id, http: 200, elapsedMs: 100, body };
  });
}

test("accepts fresh cached observations without false alarms", () => {
  const observations = healthy();
  observations[0].body.status = "degraded";
  observations[0].body.indexes[0].status = "stale";
  observations[1].body.status = "syncing";
  assert.deepEqual(assessHealth(observations, NOW).issues, []);
});

test("does not mistake a successful HTTP response for a usable service", () => {
  const observations = healthy();
  observations.find(value => value.id === "api").body = { error: "unavailable" };
  observations.find(value => value.id === "robinhood-api").body.mode = "disabled";
  assert.deepEqual(assessHealth(observations, NOW).issues.map(value => value.code), ["api:not_ready", "robinhood-api:not_active"]);
});

test("detects stale index and market data even when health says ready", () => {
  const observations = healthy();
  observations[0].body.indexes[0].updatedAt = new Date(NOW - 21 * 60_000).toISOString();
  observations[1].body.items[0].market.observedAt = new Date(NOW - 36 * 60_000).toISOString();
  assert.deepEqual(assessHealth(observations, NOW).issues.map(value => value.code), ["ethereum:market_data_stale", "index-1:stale"]);
});

test("rejects wrong-chain, duplicate and malformed response identities", () => {
  const observations = healthy();
  observations[0].body.indexes[0] = null;
  observations[1].body.items[0].chainId = 4663;
  observations[2].body.items.push(observations[2].body.items[0]);
  const codes = assessHealth(observations, NOW).issues.map(value => value.code);
  assert.ok(codes.includes("indexes:invalid_response"));
  assert.ok(codes.includes("ethereum:wrong_identity"));
  assert.ok(codes.includes("robinhood:market_data_missing"));
});

test("detects missing valuations rather than accepting empty price fields", () => {
  const observations = healthy();
  observations[1].body.items[0].market.priceUsd = 0;
  assert.ok(assessHealth(observations, NOW).issues.some(value => value.code === "ethereum:market_data_missing"));
});

test("checks HyperEVM without rejecting additional chain observations", () => {
  const observations = healthy();
  observations[0].body.indexes.push({ chainId: 10, status: "ready", updatedAt });
  assert.deepEqual(assessHealth(observations, NOW).issues, []);
  observations[0].body.indexes.find(index => index.chainId === 999).status = "unavailable";
  assert.deepEqual(assessHealth(observations, NOW).issues.map(value => value.code), ["index-999:unavailable"]);
  observations[0].body.indexes = observations[0].body.indexes.filter(index => index.chainId !== 999);
  assert.deepEqual(assessHealth(observations, NOW).issues.map(value => value.code), ["index-999:invalid_response"]);
});

test("rejects duplicate chain identities including the fourth chain", () => {
  const observations = healthy();
  observations[0].body.indexes.push({ chainId: 999, status: "ready", updatedAt });
  assert.deepEqual(assessHealth(observations, NOW).issues.map(value => value.code), ["indexes:invalid_response"]);
});

test("notifies once after two bad checks and once after two healthy checks", () => {
  const issues = [{ code: "api:not_ready", severity: "error" }];
  const first = advanceIncidentState(undefined, issues, NOW);
  assert.deepEqual(first.opened, []);
  const second = advanceIncidentState(first.state, issues, NOW + 1);
  assert.deepEqual(second.opened, issues);
  const third = advanceIncidentState(second.state, issues, NOW + 2);
  assert.deepEqual(third.opened, []);
  const recovering = advanceIncidentState(third.state, [], NOW + 3);
  assert.deepEqual(recovering.recovered, []);
  const recovered = advanceIncidentState(recovering.state, [], NOW + 4);
  assert.deepEqual(recovered.recovered, issues);
  assert.deepEqual(advanceIncidentState(recovered.state, [], NOW + 5).recovered, []);
});

test("a single transient failure is cleared without creating an incident", () => {
  const issues = [{ code: "indexes:unavailable", severity: "error" }];
  const first = advanceIncidentState(undefined, issues, NOW);
  const healthy = advanceIncidentState(first.state, [], NOW + 1);
  assert.deepEqual(healthy.state.incidents, []);
  assert.deepEqual(advanceIncidentState(healthy.state, issues, NOW + 2).opened, []);
});

test("runs only six public GETs, at most two concurrently, without retries or secrets", async () => {
  let active = 0, maximum = 0;
  const calls = [];
  const results = await collectObservations(async (url, options) => {
    calls.push({ url, options });
    const call = calls.length;
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (call === 1) throw Error("private provider details");
    return Response.json({ status: "ready" });
  });
  assert.equal(calls.length, TARGETS.length);
  assert.equal(calls.length, 6);
  assert.equal(results.length, TARGETS.length);
  assert.ok(maximum <= 2);
  assert.ok(calls.every(call => call.options.method === "GET" && call.options.redirect === "error" && !call.options.headers));
  assert.ok(calls.every(call => !call.url.includes("/ops/robinhood-index") && !call.url.includes("/graphql")));
  assert.ok(calls.every(call => !call.url.includes("/api/explore/launches")));
  assert.equal(results[0].error, "request_failed");
  assert.ok(!JSON.stringify(results).includes("private provider"));
});

test("rejects HTML and oversized success bodies without leaking their content", async () => {
  const observations = await collectObservations(async url => {
    if (url === TARGETS[0].url) return new Response("private HTML login page", { headers: { "content-type": "text/html" } });
    if (url === TARGETS[1].url) return Response.json({ content: "x".repeat(513_000) });
    return Response.json({ status: "ready" });
  });
  assert.equal(observations[0].error, "non_json");
  assert.equal(observations[1].error, "body_too_large");
  assert.ok(!JSON.stringify(observations).includes("private HTML"));
});
