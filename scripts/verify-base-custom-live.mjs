import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assertBaseCapabilitiesResponse } from "../packages/launch/src/api-client.mjs";
import profile from "../packages/launch/src/base-profile-v1.json" with { type: "json" };

/** Public, read-only release gate. A deployed image or static ready flag is insufficient. */
export async function verifyBaseCustomLive(evidence, request = fetch) {
  assert.equal(evidence.status, "passed", "Base acceptance has not completed");
  assert.match(evidence.releaseId, /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence.requestId, /^[0-9a-f-]{36}$/);
  assert.match(evidence.launchTransactionHash, /^0x[0-9a-f]{64}$/);
  const read = async url => {
    const response = await request(url, { cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error" });
    assert.equal(response.ok, true, "Public Base endpoint unavailable");
    return response.json();
  };
  const prefix = "https://api.programmable.market/v4/chains/8453";
  const readiness = await read(prefix + "/readiness");
  assert.equal(readiness.chainId, "8453");
  assert.equal(readiness.mode, "active");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.publicLaunchAuthorized, true);
  assert.equal(readiness.releaseId, evidence.releaseId);
  const capabilities = await read(prefix + "/capabilities");
  assertBaseCapabilitiesResponse(capabilities);
  assert.equal(capabilities.mode, "active");
  assert.equal(capabilities.releaseId, evidence.releaseId);
  let cursor = null, found = null;
  const seen = new Set();
  do {
    const feed = await read(prefix + "/finalized-custom-launches" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""));
    assert.equal(feed.schemaVersion, "programmable.finalized-custom-launch-metadata-list.v1");
    assert.ok(Array.isArray(feed.launches));
    assert.ok(feed.launches.every(item => item.chainId === "8453"));
    found = feed.launches.find(item => item.resourceId === evidence.requestId) ?? found;
    cursor = feed.nextCursor ?? null;
    assert.ok(cursor === null || !seen.has(cursor), "Repeated Base pagination cursor");
    if (cursor) seen.add(cursor);
    assert.ok(seen.size < 10000, "Base feed exceeded verification bound");
  } while (cursor && !found);
  assert.ok(found, "Accepted Base launch missing from the finalized feed");
  assert.equal(found.router.toLowerCase(), profile.router.toLowerCase());
  assert.equal(found.finality.transactionHash, evidence.launchTransactionHash);
  assert.equal(found.token.toLowerCase(), evidence.token.toLowerCase());
  const explore = await read("https://programmable.market/api/explore/base?q=" + encodeURIComponent(evidence.token));
  assert.ok(explore.items?.some(item => item.chainId === 8453 && item.tokenAddress?.toLowerCase() === evidence.token.toLowerCase()),
    "Base launch missing from public Explore");
  return { status: "passed", releaseId: readiness.releaseId, requestId: evidence.requestId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const evidence = JSON.parse(readFileSync(fileURLToPath(new URL("../docs/operations/releases/custom-launch-v4.2.0/base-live-acceptance.json", import.meta.url))));
  console.log(JSON.stringify(await verifyBaseCustomLive(evidence)));
}
