import assert from "node:assert/strict";
import test from "node:test";
import profile from "../../packages/launch/src/base-profile-v1.json" with { type: "json" };
import { verifyBaseCustomLive } from "../verify-base-custom-live.mjs";

const prefix = "https://api.programmable.market/v4/chains/8453";
const evidence = {
  status: "passed", releaseId: "sha256:" + "a".repeat(64),
  requestId: "11111111-2222-4333-8444-555555555555",
  launchTransactionHash: "0x" + "b".repeat(64), token: "0x" + "c".repeat(40),
};
function fixture(change = () => {}) {
  const readiness = { chainId: "8453", mode: "active", ready: true,
    publicLaunchAuthorized: true, releaseId: evidence.releaseId };
  const capabilities = {
    schemaVersion: "programmable.custom-launch-capabilities.v1", apiVersion: "v4",
    chain: { id: "8453", name: "Base" }, serverTime: new Date().toISOString(),
    releaseId: evidence.releaseId, mode: "active", publicLaunchAuthorized: true, moduleMode: false,
    profile, routes: Object.fromEntries(Object.entries({
      create: "/custom-launches", list: "/custom-launches", status: "/custom-launches/{launchId}",
      preflight: "/custom-launches/preflight", capabilities: "/capabilities", readiness: "/readiness",
      finalizedMetadata: "/finalized-custom-launches",
    }).map(([key, value]) => [key, "/v4/chains/8453" + value])),
    authentication: { create: "bearer-api-key", requiredScopes: ["custom-launch:create", "custom-launch:read"] },
  };
  const launch = { chainId: "8453", resourceId: evidence.requestId, router: profile.router,
    token: evidence.token, finality: { transactionHash: evidence.launchTransactionHash } };
  const explore = { items: [{ chainId: 8453, tokenAddress: evidence.token }] };
  const unified = { items: [{ chainId: 8453, tokenAddress: evidence.token, transactionHash: evidence.launchTransactionHash }] };
  const state = { readiness, capabilities, launch, explore, unified, repeatCursor: false };
  change(state);
  const visited = [];
  return { visited, request: async url => {
    visited.push(url);
    let body;
    if (url === prefix + "/readiness") body = state.readiness;
    else if (url === prefix + "/capabilities") body = state.capabilities;
    else if (url === prefix + "/finalized-custom-launches") body = {
      schemaVersion: "programmable.finalized-custom-launch-metadata-list.v1", launches: [], nextCursor: "second-page",
    };
    else if (url === prefix + "/finalized-custom-launches?cursor=second-page") body = {
      schemaVersion: "programmable.finalized-custom-launch-metadata-list.v1",
      launches: state.repeatCursor ? [] : [state.launch], nextCursor: state.repeatCursor ? "second-page" : null,
    };
    else if (url.startsWith("https://programmable.market/api/explore/base?")) body = state.explore;
    else if (url.startsWith("https://programmable.market/api/explore/launches?")) body = state.unified;
    else throw new Error("Unexpected endpoint");
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  } };
}
test("public Base acceptance requires the exact launch across paginated API and Explore", async () => {
  const f = fixture();
  assert.equal((await verifyBaseCustomLive(evidence, f.request)).status, "passed");
  assert.ok(f.visited.includes(prefix + "/finalized-custom-launches?cursor=second-page"));
});
test("inactive releases, substituted transactions or roots, missing indexing and cursor loops fail closed", async () => {
  for (const mutate of [
    s => s.readiness.mode = "canary",
    s => s.capabilities.releaseId = "sha256:" + "d".repeat(64),
    s => s.launch.finality.transactionHash = "0x" + "d".repeat(64),
    s => s.launch.router = "0x" + "d".repeat(40),
    s => s.launch.chainId = "1",
    s => s.explore.items = [],
    s => s.unified.items = [],
    s => s.unified.items[0].transactionHash = "0x" + "d".repeat(64),
    s => s.repeatCursor = true,
  ]) await assert.rejects(verifyBaseCustomLive(evidence, fixture(mutate).request));
  await assert.rejects(verifyBaseCustomLive({ ...evidence, status: "pending" }, fixture().request));
  await assert.rejects(verifyBaseCustomLive(evidence, async () => new Response("", { status: 503 })));
});
