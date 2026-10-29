import assert from "node:assert/strict";
import test from "node:test";
import profile from "../../packages/launch/src/hyperevm-profile-v1.json" with { type: "json" };
import { verifyHyperEvmCustomLive } from "../verify-hyperevm-custom-live.mjs";

const prefix = "https://api.programmable.market/v4/chains/999";
const evidence = {
  status: "passed", releaseId: `sha256:${"a".repeat(64)}`,
  requestId: "11111111-1111-1111-1111-111111111111", launchTransactionHash: `0x${"b".repeat(64)}`,
  token: "0x1111111111111111111111111111111111111111",
  platformFeesVerified: true, openingTaxVerified: true, sourcesVerified: true,
};
function fixture({ endlessFeed = false } = {}) {
  const urls = [];
  const request = async url => {
    urls.push(url);
    const u = new URL(url);
    let value;
    if (u.pathname.endsWith("/readiness")) value = {
      chainId: "999", releaseId: evidence.releaseId, ready: true, mode: "active", publicLaunchAuthorized: true,
    };
    else if (u.pathname.endsWith("/capabilities")) value = {
      schemaVersion: "programmable.custom-launch-capabilities.v1", apiVersion: "v4", chain: { id: "999", name: "HyperEVM" },
      releaseId: evidence.releaseId, serverTime: new Date().toISOString(), mode: "active", publicLaunchAuthorized: true,
      moduleMode: false, profile: { ...profile, productionLaunchAuthorized: true },
      routes: Object.fromEntries(Object.entries({ create: "custom-launches", list: "custom-launches",
        status: "custom-launches/{launchId}", preflight: "custom-launches/preflight", capabilities: "capabilities",
        readiness: "readiness", finalizedMetadata: "finalized-custom-launches" }).map(([k, v]) => [k, `${prefix}/${v}`.replace("https://api.programmable.market", "")])),
      authentication: { create: "bearer-api-key", requiredScopes: ["custom-launch:create", "custom-launch:read"] },
    };
    else if (u.pathname.endsWith("/finalized-custom-launches")) value = {
      schemaVersion: "programmable.finalized-custom-launch-metadata-list.v1",
      launches: endlessFeed ? [] : [{ chainId: "999", resourceId: evidence.requestId, router: profile.router,
        finality: { transactionHash: evidence.launchTransactionHash }, token: evidence.token }],
      nextCursor: endlessFeed ? `cursor-${urls.length}` : null,
    };
    else {
      assert.ok(u.pathname === "/api/explore/hyperevm" || (u.pathname === "/api/explore/launches" && u.searchParams.get("chain") === "999"));
      assert.equal(u.searchParams.get("q"), evidence.token);
      value = { items: [{ chainId: 999, tokenAddress: evidence.token, transactionHash: evidence.launchTransactionHash }] };
    }
    return Response.json(value);
  };
  return { request, urls };
}

test("HyperEVM acceptance checks its own chain feed and both Explore views", async () => {
  const f = fixture();
  assert.equal((await verifyHyperEvmCustomLive(evidence, f.request)).status, "passed");
  assert.equal(f.urls.length, 5);
  assert.ok(f.urls.every(url => !url.includes("/base")));
});

test("a missing canary cannot trigger an unbounded index scan", async () => {
  const f = fixture({ endlessFeed: true });
  await assert.rejects(verifyHyperEvmCustomLive(evidence, f.request), /bounded feed read/);
  assert.equal(f.urls.filter(url => url.includes("finalized-custom-launches")).length, 5);
});

test("local or partial evidence cannot enter the live verifier", async () => {
  for (const field of ["platformFeesVerified", "openingTaxVerified", "sourcesVerified"]) {
    const f = fixture();
    await assert.rejects(verifyHyperEvmCustomLive({ ...evidence, [field]: false }, f.request), /acceptance is required/);
    assert.equal(f.urls.length, 0);
  }
});
