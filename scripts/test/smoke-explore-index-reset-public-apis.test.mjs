import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  runProductionExploreIndexResetSmokeV1,
  runStagedExploreIndexResetSmokeV1,
} from "../smoke-explore-index-reset-public-apis.mjs";
import {
  parsePostPromotionArguments,
  verifyPostPromotion,
} from "../perf/read-model-post-promotion.mjs";

const NOW = new Date().toISOString();
const BYPASS = "0123456789abcdef";

const PUBLIC_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json",
  "retry-after": "3600",
  "x-programmable-indexing-status": "reset",
});

const RUNTIME_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json",
  "x-programmable-indexing-status": "reset",
});

function genericPublicBody() {
  return {
    error: "Token data is temporarily unavailable",
    status: "index_rebuilding",
  };
}

function responseSpec(url, method) {
  if (
    url.pathname === "/api/explore" ||
    url.pathname === "/api/explore/token" ||
    url.pathname === "/api/explore/token/analytics"
  ) {
    return {
      body: genericPublicBody(),
      headers: PUBLIC_HEADERS,
      status: 503,
    };
  }
  if (url.pathname === "/api/explore/token/chart") {
    return {
      body: {
        schemaVersion: "programmable.market-chart-error.v2",
        source: "programmable",
        status: "unavailable",
        generatedAt: NOW,
        address: url.searchParams.get("address"),
        range: url.searchParams.get("range"),
        reason: "identity-unavailable",
        error: "Price history is temporarily unavailable",
      },
      headers: PUBLIC_HEADERS,
      status: 503,
    };
  }
  if (url.pathname === "/api/explore/profile") {
    return {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
        },
      },
      headers: PUBLIC_HEADERS,
      status: 503,
    };
  }

  const retiredOperations = new Map([
    ["GET /api/ops/index-v2", "index-v2"],
    ["GET /api/ops/projector", "projector"],
    ["GET /api/ops/market-projector", "market-projector"],
    ["GET /api/ops/alchemy-launch-refresh", "alchemy-launch-refresh"],
    [
      "POST /api/ops/read-model-performance-capture",
      "read-model-performance-capture",
    ],
    [
      "POST /api/ops/read-model-real-block-sla",
      "read-model-real-block-sla",
    ],
    [
      "PUT /api/ops/read-model-real-block-sla",
      "read-model-real-block-sla",
    ],
  ]);
  const retiredOperation = retiredOperations.get(`${method} ${url.pathname}`);
  if (retiredOperation !== undefined) {
    return {
      body: {
        status: "index_rebuilding",
        code: "indexing_reset",
        operation: retiredOperation,
      },
      headers: RUNTIME_HEADERS,
      status: 410,
    };
  }

  const pausedTriggers = new Map([
    ["/api/ops/projector-wake", "projector-wake"],
    ["/api/alchemy/webhook", "alchemy-webhook"],
  ]);
  const pausedTrigger = pausedTriggers.get(url.pathname);
  if (pausedTrigger !== undefined) {
    assert.equal(method, "POST");
    return {
      body: {
        status: "paused",
        code: "indexing_reset",
        operation: pausedTrigger,
      },
      headers: RUNTIME_HEADERS,
      status: 200,
    };
  }

  if (url.pathname === "/api/ops/health") {
    assert.equal(method, "GET");
    return {
      body: {
        schemaVersion: "programmable.operations-health.v2", scope: "website-launch-indexes", status: "ready", checkedAt: NOW,
        indexes: [
          { chainId: 1, status: "ready", updatedAt: NOW, catalogUrl: "https://programmable.market/api/explore/ethereum" },
          { chainId: 4663, status: "ready", updatedAt: NOW, catalogUrl: "https://programmable.market/api/explore/robinhood" },
          { chainId: 8453, status: "ready", updatedAt: NOW, catalogUrl: "https://programmable.market/api/explore/base" },
        ],
        providers: [{ name: "codex", roles: ["ethereum-and-robinhood-market-data"], health: "not-checked" }],
        customLaunchReadiness: [
          { chainId: 1, readinessUrl: "https://api.programmable.market/readyz", capabilitiesUrl: "https://api.programmable.market/v3/capabilities" },
          { chainId: 4663, readinessUrl: "https://api.programmable.market/v4/chains/4663/custom-launch-plans/readiness",
            capabilitiesUrl: "https://api.programmable.market/v4/chains/4663/custom-launch-capabilities" },
          { chainId: 8453, readinessUrl: "https://api.programmable.market/v4/chains/8453/readiness",
            capabilitiesUrl: "https://api.programmable.market/v4/chains/8453/capabilities" },
        ],
      },
      headers: { ...RUNTIME_HEADERS, "x-programmable-indexing-status": "ready" },
      status: 200,
    };
  }
  throw new Error(`unexpected fixture request ${method} ${url.pathname}`);
}

function resetFetch(mutate = ({ spec }) => spec) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    calls.push({ url, init, method, headers });
    const base = responseSpec(url, method);
    const spec = mutate({ spec: base, url, method, headers, init }) ?? base;
    const body = spec.rawBody ?? JSON.stringify(spec.body);
    return new Response(body, {
      status: spec.status,
      headers: spec.headers,
    });
  };
  return { calls, fetchImpl };
}

function stagedEnvironment(overrides = {}) {
  return {
    STAGED_TARGET_URL: "https://candidate.vercel.app/",
    VERCEL_AUTOMATION_BYPASS_SECRET: BYPASS,
    GITHUB_OUTPUT: "/tmp/unused-index-reset-smoke-output",
    ...overrides,
  };
}

test("staged smoke verifies every public and runtime reset contract in parallel", async () => {
  const fixture = resetFetch();
  const outputWrites = [];
  const result = await runStagedExploreIndexResetSmokeV1({
    environment: stagedEnvironment(),
    fetchImpl: fixture.fetchImpl,
    appendOutput: (...args) => outputWrites.push(args),
    now: () => new Date(NOW),
  });

  assert.deepEqual(result, {
    status: "verified-explore-index-reset-public-apis",
    targetKind: "staged",
    publicRoutesChecked: 6,
    retiredOperationsChecked: 10,
    providerCallsExpected: 0,
    providerCallsScope: "legacy-reset-routes",
    healthScope: "website-launch-indexes",
  });
  assert.equal(fixture.calls.length, 16);
  assert.equal(
    new Set(
      fixture.calls.map(({ method, url }) => `${method} ${url.pathname}${url.search}`),
    ).size,
    16,
  );
  assert.deepEqual(
    fixture.calls
      .filter(({ method }) => method === "POST")
      .map(({ url }) => url.pathname)
      .sort(),
    [
      "/api/alchemy/webhook",
      "/api/ops/projector-wake",
      "/api/ops/read-model-performance-capture",
      "/api/ops/read-model-real-block-sla",
    ],
  );
  assert.deepEqual(
    fixture.calls
      .filter(({ method }) => method === "PUT")
      .map(({ url }) => url.pathname),
    ["/api/ops/read-model-real-block-sla"],
  );
  for (const call of fixture.calls) {
    assert.equal(call.url.origin, "https://candidate.vercel.app");
    assert.equal(call.headers.get("accept"), "application/json");
    assert.equal(call.headers.get("x-vercel-protection-bypass"), BYPASS);
    assert.equal(call.headers.get("x-vercel-set-bypass-cookie"), "false");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.cache, "no-store");
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.deepEqual(outputWrites, [[
    "/tmp/unused-index-reset-smoke-output",
    "indexing_status=index-reset\n" +
      "public_routes_checked=6\n" +
      "retired_operations_checked=10\n" +
      "provider_calls_expected=0\n",
    "utf8",
  ]]);
});

test("production runner is pinned to the exact production origin and ignores staging input", async () => {
  const fixture = resetFetch();
  const result = await runProductionExploreIndexResetSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://attacker.invalid/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "must-not-be-used",
    },
    fetchImpl: fixture.fetchImpl,
    now: () => new Date(NOW),
  });

  assert.equal(result.targetKind, "production");
  assert.equal(fixture.calls.length, 16);
  for (const call of fixture.calls) {
    assert.equal(call.url.origin, "https://programmable.market");
    assert.equal(call.headers.get("x-vercel-protection-bypass"), null);
    assert.equal(call.headers.get("x-vercel-set-bypass-cookie"), null);
  }
});

test("staged runner rejects non-exact origins before fetching", async () => {
  const invalidTargets = [
    "http://candidate.vercel.app/",
    "https://candidate.vercel.app/path",
    "https://candidate.vercel.app/?query=1",
    "https://user@candidate.vercel.app/",
    "https://candidate.vercel.app:8443/",
    "https://candidate.example/",
  ];
  for (const target of invalidTargets) {
    let fetched = false;
    await assert.rejects(
      runStagedExploreIndexResetSmokeV1({
        environment: stagedEnvironment({ STAGED_TARGET_URL: target }),
        fetchImpl: async () => {
          fetched = true;
          throw new Error("fetch must not run");
        },
        appendOutput: () => undefined,
        now: () => new Date(NOW),
      }),
      /not an exact origin/u,
    );
    assert.equal(fetched, false);
  }
});

test("staged runner requires both the bypass secret and GITHUB_OUTPUT", async () => {
  const fixture = resetFetch();
  await assert.rejects(
    runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment({
        VERCEL_AUTOMATION_BYPASS_SECRET: "too-short",
      }),
      fetchImpl: fixture.fetchImpl,
      appendOutput: () => undefined,
      now: () => new Date(NOW),
    }),
    /automation bypass is unavailable/u,
  );
  await assert.rejects(
    runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment({ GITHUB_OUTPUT: "" }),
      fetchImpl: fixture.fetchImpl,
      appendOutput: () => undefined,
      now: () => new Date(NOW),
    }),
    /GITHUB_OUTPUT is unavailable/u,
  );
  assert.equal(fixture.calls.length, 0);
});

test("smoke rejects public status, body, header, and provenance drift", async () => {
  const scenarios = [
    ({ spec }) => ({ ...spec, status: 200 }),
    ({ spec }) => ({ ...spec, body: { ...spec.body, tokens: [] } }),
    ({ spec }) => ({
      ...spec,
      headers: { ...spec.headers, "retry-after": "5" },
    }),
    ({ spec }) => ({
      ...spec,
      headers: { ...spec.headers, "cache-control": "public, max-age=60" },
    }),
    ({ spec }) => ({
      ...spec,
      headers: {
        ...spec.headers,
        "x-programmable-read-source": "legacy-indexer",
      },
    }),
  ];
  for (const mutateTarget of scenarios) {
    const fixture = resetFetch((input) =>
      input.url.pathname === "/api/explore" &&
          input.url.searchParams.get("chain") === "1"
        ? mutateTarget(input)
        : input.spec
    );
    await assert.rejects(
      runStagedExploreIndexResetSmokeV1({
        environment: stagedEnvironment(),
        fetchImpl: fixture.fetchImpl,
        appendOutput: () => undefined,
        now: () => new Date(NOW),
      }),
      /does not match the exact reset contract/u,
    );
  }
});

test("smoke rejects chart and profile schema drift", async () => {
  const chartFixture = resetFetch(({ spec, url }) =>
    url.pathname === "/api/explore/token/chart"
      ? {
          ...spec,
          body: {
            ...spec.body,
            generatedAt: new Date(Date.parse(NOW) - 60 * 60_000).toISOString(),
          },
        }
      : spec
  );
  await assert.rejects(
    runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment(),
      fetchImpl: chartFixture.fetchImpl,
      appendOutput: () => undefined,
      now: () => new Date(NOW),
    }),
    /does not match the exact reset contract/u,
  );

  const profileFixture = resetFetch(({ spec, url }) =>
    url.pathname === "/api/explore/profile"
      ? {
          ...spec,
          body: {
            ...spec.body,
            error: { ...spec.body.error, message: "different" },
          },
        }
      : spec
  );
  await assert.rejects(
    runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment(),
      fetchImpl: profileFixture.fetchImpl,
      appendOutput: () => undefined,
      now: () => new Date(NOW),
    }),
    /does not match the exact reset contract/u,
  );
});

test("smoke accepts accurate degraded and unavailable catalog health", async () => {
  for (const state of ["degraded", "unavailable"]) {
    const fixture = resetFetch(({ spec, url }) => {
      if (url.pathname !== "/api/ops/health") return spec;
      const body = { ...spec.body, status: state, indexes: spec.body.indexes.map((index, position) =>
        state === "unavailable" || position === 0 ? { ...index, status: "unavailable", updatedAt: null } : index) };
      return { ...spec, body, status: state === "unavailable" ? 503 : 200,
        headers: { ...spec.headers, "x-programmable-indexing-status": state } };
    });
    const result = await runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment(), fetchImpl: fixture.fetchImpl,
      appendOutput: () => undefined, now: () => new Date(NOW),
    });
    assert.equal(result.healthScope, "website-launch-indexes");
    assert.equal(result.providerCallsScope, "legacy-reset-routes");
  }
});

test("smoke rejects retired operation, paused trigger, and health drift", async () => {
  const scenarios = [
    ({ spec, url }) => url.pathname === "/api/ops/index-v2"
      ? { ...spec, body: { ...spec.body, operation: "projector" } }
      : spec,
    ({ spec, url }) => url.pathname === "/api/alchemy/webhook"
      ? { ...spec, status: 410 }
      : spec,
    ({ spec, url }) => url.pathname === "/api/ops/health"
      ? { ...spec, body: { ...spec.body, providers: [{ name: "legacy" }] } }
      : spec,
    ({ spec, url }) => url.pathname === "/api/ops/health"
      ? { ...spec, body: { ...spec.body, providers: [{ ...spec.body.providers[0], health: "healthy" }] } }
      : spec,
    ({ spec, url }) => url.pathname === "/api/ops/health"
      ? { ...spec, body: { ...spec.body, indexes: spec.body.indexes.map(index => ({ ...index, status: "unavailable" })) } }
      : spec,
  ];
  for (const mutate of scenarios) {
    const fixture = resetFetch(mutate);
    await assert.rejects(
      runStagedExploreIndexResetSmokeV1({
        environment: stagedEnvironment(),
        fetchImpl: fixture.fetchImpl,
        appendOutput: () => undefined,
        now: () => new Date(NOW),
      }),
      /does not match the exact reset contract/u,
    );
  }
});

test("smoke requires Base catalog and readiness evidence with exact endpoints", async () => {
  const mutations = [
    body => ({ ...body, indexes: body.indexes.slice(0, 2) }),
    body => ({ ...body, customLaunchReadiness: body.customLaunchReadiness.slice(0, 2) }),
    body => ({ ...body, indexes: body.indexes.map(index => index.chainId === 8453
      ? { ...index, catalogUrl: "https://programmable.market/api/explore/ethereum" } : index) }),
    body => ({ ...body, customLaunchReadiness: body.customLaunchReadiness.map(entry => entry.chainId === 8453
      ? { ...entry, readinessUrl: "https://api.programmable.market/readyz" } : entry) }),
    body => ({ ...body, customLaunchReadiness: body.customLaunchReadiness.map(entry => entry.chainId === 8453
      ? { ...entry, capabilitiesUrl: "https://api.programmable.market/v3/capabilities" } : entry) }),
  ];
  for (const mutate of mutations) {
    const fixture = resetFetch(({ spec, url }) => url.pathname === "/api/ops/health"
      ? { ...spec, body: mutate(spec.body) } : spec);
    await assert.rejects(runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment(), fetchImpl: fixture.fetchImpl,
      appendOutput: () => undefined, now: () => new Date(NOW),
    }), /does not match the exact reset contract/u);
  }
});

test("smoke bounds response bodies and requires JSON", async () => {
  const wrongType = resetFetch(({ spec, url }) =>
    url.pathname === "/api/ops/health"
      ? {
          ...spec,
          headers: { ...spec.headers, "content-type": "text/plain" },
        }
      : spec
  );
  await assert.rejects(
    runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment(),
      fetchImpl: wrongType.fetchImpl,
      appendOutput: () => undefined,
      now: () => new Date(NOW),
    }),
    /did not return JSON/u,
  );

  const oversized = resetFetch(({ spec, url }) =>
    url.pathname === "/api/ops/health"
      ? { ...spec, rawBody: "x".repeat(64 * 1024 + 1) }
      : spec
  );
  await assert.rejects(
    runStagedExploreIndexResetSmokeV1({
      environment: stagedEnvironment(),
      fetchImpl: oversized.fetchImpl,
      appendOutput: () => undefined,
      now: () => new Date(NOW),
    }),
    /is too large/u,
  );
});

test("post-promotion binds the exact deployment to the reset surface", async () => {
  const fixture = resetFetch();
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return fixture.fetchImpl(input, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.checks.at(-1)?.id,
    "production-explore-index-reset-public-apis",
  );
  assert.equal(fixture.calls.length, 16);
});

test("post-promotion fails exact deployment or reset-surface drift", async () => {
  const mismatchedDeployment = resetFetch();
  const mismatchResult = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "api.vercel.com") {
        return Response.json({
          id: "dpl_bbbbbbbbbbbbbbbbbbbbbbbb",
          projectId: "prj_programmable_test",
          readyState: "READY",
          meta: { githubCommitSha: "b".repeat(40) },
        });
      }
      return mismatchedDeployment.fetchImpl(input, init);
    },
  });
  assert.equal(mismatchResult.ok, false);
  assert.ok(
    mismatchResult.failures.some(({ id }) => id === "production-deployment-id"),
  );

  const driftedSurface = resetFetch(({ spec, url }) =>
    url.pathname === "/api/ops/health"
      ? { ...spec, body: { status: "ready", providers: [] } }
      : spec
  );
  const driftResult = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "api.vercel.com") {
        return Response.json({
          id: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
          projectId: "prj_programmable_test",
          readyState: "READY",
          meta: { githubCommitSha: "b".repeat(40) },
        });
      }
      return driftedSurface.fetchImpl(input, init);
    },
  });
  assert.equal(driftResult.ok, false);
  assert.ok(
    driftResult.failures.some(
      ({ id }) => id === "production-explore-index-reset-public-apis",
    ),
  );
});

test("post-promotion rejects non-production origins before fetching", async () => {
  let fetched = false;
  await assert.rejects(
    verifyPostPromotion({
      targetUrl: "https://programmable.market/untrusted",
      expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
      expectedGitHead: "b".repeat(40),
      token: "vercel-test-token",
      teamId: "team_programmable_test",
      projectId: "prj_programmable_test",
      fetchImpl: async () => {
        fetched = true;
        throw new Error("fetch must not run");
      },
    }),
    /production origin/u,
  );
  assert.equal(fetched, false);
});

test("post-promotion CLI keeps only the exact deployment binding arguments", () => {
  const base = [
    "--target-url",
    "https://programmable.market",
    "--deployment-id",
    "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    "--git-head",
    "b".repeat(40),
  ];
  assert.deepEqual(parsePostPromotionArguments(base), {
    "target-url": "https://programmable.market",
    "deployment-id": "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    "git-head": "b".repeat(40),
  });
  assert.throws(
    () => parsePostPromotionArguments([...base, "--provider", "legacy"]),
    /arguments must be --name value pairs/u,
  );
});

test("post-promotion source has no legacy provider-smoke dependency", () => {
  const postPromotionSource = readFileSync(
    new URL("../perf/read-model-post-promotion.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    postPromotionSource,
    /smoke-static-dexscreener|runProductionStaticDexscreener|GMGN_API_KEY|PROGRAMMABLE_REQUIRE_GMGN_MARKET/u,
  );
  assert.match(
    postPromotionSource,
    /runProductionExploreIndexResetSmokeV1\(\{ fetchImpl \}\)/u,
  );

  const smokeSource = readFileSync(
    new URL("../smoke-explore-index-reset-public-apis.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    smokeSource,
    /GMGN_API_KEY|DEXSCREENER|BITQUERY|PROGRAMMABLE_WEBSITE_MAINNET_RPC/u,
  );
  assert.match(smokeSource, /Promise\.all/u);
  assert.match(smokeSource, /MAXIMUM_RESPONSE_BYTES = 64 \* 1024/u);
  assert.match(smokeSource, /REQUEST_TIMEOUT_MS = 15_000/u);
});
