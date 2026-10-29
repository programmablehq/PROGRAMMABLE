import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { assertEvmCapabilitiesResponse } from "../packages/launch/src/api-client.mjs";
import profile from "../packages/launch/src/hyperevm-profile-v1.json" with { type: "json" };

/** Public, read-only release gate. A deployed image or static ready flag is insufficient. */
export async function verifyHyperEvmCustomLive(evidence, request = fetch) {
  assert.equal(evidence.status, "passed", "HyperEvm acceptance has not completed");
  assert.match(evidence.releaseId, /^sha256:[0-9a-f]{64}$/);
  assert.match(evidence.requestId, /^[0-9a-f-]{36}$/);
  assert.match(evidence.launchTransactionHash, /^0x[0-9a-f]{64}$/);
  assert.ok(evidence.platformFeesVerified === true && evidence.openingTaxVerified === true
    && evidence.sourcesVerified === true, "Funded trade, fee and source acceptance is required");
  const read = async url => {
    const response = await request(url, { cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error" });
    assert.equal(response.ok, true, "Public HyperEvm endpoint unavailable");
    return response.json();
  };
  const prefix = "https://api.programmable.market/v4/chains/999";
  const readiness = await read(prefix + "/readiness");
  assert.equal(readiness.chainId, "999");
  assert.equal(readiness.mode, "active");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.publicLaunchAuthorized, true);
  assert.equal(readiness.releaseId, evidence.releaseId);
  const capabilities = await read(prefix + "/capabilities");
  assertEvmCapabilitiesResponse(capabilities, "999");
  assert.equal(capabilities.mode, "active");
  assert.equal(capabilities.releaseId, evidence.releaseId);
  let cursor = null, found = null, pages = 0;
  const seen = new Set();
  do {
    assert.ok(++pages <= 5, "HyperEVM acceptance launch was not found in the bounded feed read");
    const feed = await read(prefix + "/finalized-custom-launches" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""));
    assert.equal(feed.schemaVersion, "programmable.finalized-custom-launch-metadata-list.v1");
    assert.ok(Array.isArray(feed.launches));
    assert.ok(feed.launches.every(item => item.chainId === "999"));
    found = feed.launches.find(item => item.resourceId === evidence.requestId) ?? found;
    cursor = feed.nextCursor ?? null;
    assert.ok(cursor === null || !seen.has(cursor), "Repeated HyperEvm pagination cursor");
    if (cursor) seen.add(cursor);
  } while (cursor && !found);
  assert.ok(found, "Accepted HyperEvm launch missing from the finalized feed");
  assert.equal(found.router.toLowerCase(), profile.router.toLowerCase());
  assert.equal(found.finality.transactionHash, evidence.launchTransactionHash);
  assert.equal(found.token.toLowerCase(), evidence.token.toLowerCase());
  const explore = await read("https://programmable.market/api/explore/hyperevm?q=" + encodeURIComponent(evidence.token));
  assert.ok(explore.items?.some(item => item.chainId === 999 && item.tokenAddress?.toLowerCase() === evidence.token.toLowerCase()),
    "HyperEvm launch missing from public Explore");
  const unified = await read("https://programmable.market/api/explore/launches?chain=999&q=" + encodeURIComponent(evidence.token));
  assert.ok(unified.items?.some(item => item.chainId === 999 && item.tokenAddress?.toLowerCase() === evidence.token.toLowerCase()
    && item.transactionHash === evidence.launchTransactionHash), "HyperEvm launch missing from the shared Explore catalog");
  return { status: "passed", releaseId: readiness.releaseId, requestId: evidence.requestId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const evidence = JSON.parse(readFileSync(fileURLToPath(new URL("../docs/operations/releases/custom-launch-v4.3.0/hyperevm-live-acceptance.json", import.meta.url))));
  console.log(JSON.stringify(await verifyHyperEvmCustomLive(evidence)));
}
