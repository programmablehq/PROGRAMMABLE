import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import profile from "../src/hyperevm-profile-v1.json" with { type: "json" };
import { getLaunchCapabilities, statusLaunch } from "../src/api-client.mjs";
import { validateEmbeddedDirectNativeProfile } from "../src/profile-direct-native-v1.mjs";
import { packFreshLaunch } from "../src/pack-current-profile.mjs";

function capabilities() {
  const prefix = "/v4/chains/999";
  return {
    schemaVersion: "programmable.custom-launch-capabilities.v1", apiVersion: "v4",
    chain: { id: "999", name: "HyperEVM" }, serverTime: "2026-10-20T19:00:00.000Z",
    releaseId: `sha256:${"a".repeat(64)}`, mode: "active", publicLaunchAuthorized: true, moduleMode: false,
    profile: { ...structuredClone(profile), productionLaunchAuthorized: true },
    routes: { create: prefix + "/custom-launches", list: prefix + "/custom-launches",
      status: prefix + "/custom-launches/{launchId}", preflight: prefix + "/custom-launches/preflight",
      capabilities: prefix + "/capabilities", readiness: prefix + "/readiness", finalizedMetadata: prefix + "/finalized-custom-launches" },
    authentication: { create: "bearer-api-key", requiredScopes: ["custom-launch:create", "custom-launch:read"] },
  };
}
const response = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

test("HyperEvm discovery and status use chain-qualified endpoints", async () => {
  const urls = [];
  await getLaunchCapabilities({ chainId: "999", maxAttempts: 1,
    fetchImpl: async url => { urls.push(url); return response(capabilities()); } });
  const requestId = "60000000-0000-4000-8000-000000000006";
  await statusLaunch({ requestId, chainId: "999", maxAttempts: 1,
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
    fetchImpl: async url => { urls.push(url); return response({ requestId, status: "received" }); } });
  assert.deepEqual(urls, ["https://api.programmable.market/v4/chains/999/capabilities",
    `https://api.programmable.market/v4/chains/999/custom-launches/${requestId}`]);
});

test("HyperEvm discovery rejects substituted roots, fee policy, transport and unavailable releases", async () => {
  for (const mutate of [
    v => { v.profile.chainId = "1"; },
    v => { v.profile.router = "0x1111111111111111111111111111111111111111"; },
    v => { v.profile.programmableTradeFeePolicy.defaultCollection.routedRateBps = 30; },
    v => { v.routes.create = "/v3/custom-launches"; },
    v => { v.moduleMode = true; },
    v => { v.publicLaunchAuthorized = false; },
    v => { v.mode = "disabled"; },
  ]) {
    const v = capabilities(); mutate(v);
    await assert.rejects(getLaunchCapabilities({ chainId: 999, maxAttempts: 1,
      fetchImpl: async () => response(v) }), error => error.details?.code === "CAPABILITIES_CONTRACT_INVALID");
  }
  assert.deepEqual(validateEmbeddedDirectNativeProfile(profile), profile);
  const wrong = structuredClone(profile); wrong.chainId = "1";
  assert.throws(() => validateEmbeddedDirectNativeProfile(wrong));
});

test("fresh HyperEvm packing selects HyperEvm capabilities without changing Ethereum defaults", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "base-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: "programmable.launch-pack-config.v3", chainId: "999" }));
  const selected = await packFreshLaunch({ configPath, maxAttempts: 1, packLaunchImpl: async args => args,
    fetchImpl: async url => { assert.match(url, /\/v4\/chains\/999\/capabilities$/); return response(capabilities()); } });
  assert.equal(selected.directNativeProfileVersion, "3.6.0");
  assert.deepEqual(selected.directNativeTradeFeePolicy, profile.programmableTradeFeePolicy);
});
