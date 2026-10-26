#!/usr/bin/env node

import { appendFileSync } from "node:fs";

import { readBoundedResponseText } from "./read-bounded-response.mjs";

const PRODUCTION_ORIGIN = "https://programmable.market/";
const TEST_ADDRESS = "0x1111111111111111111111111111111111111111";
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAXIMUM_GENERATED_AT_SKEW_MS = 5 * 60_000;
const RESET_CACHE_CONTROL = "no-store";
const RESET_RETRY_AFTER = "3600";
const RESET_STATUS_HEADER = "reset";

const PUBLIC_UNAVAILABLE_BODY = Object.freeze({
  error: "Token data is temporarily unavailable",
  status: "index_rebuilding",
});

const PUBLIC_PROBES = Object.freeze([
  Object.freeze({
    id: "explore-ethereum",
    method: "GET",
    path: "/api/explore?chain=1&limit=9&page=1&sort=newest",
    validateBody: exactPublicUnavailableBody,
  }),
  Object.freeze({
    id: "explore-robinhood",
    method: "GET",
    path: "/api/explore?chain=4663&limit=9&page=1&sort=newest",
    validateBody: exactPublicUnavailableBody,
  }),
  Object.freeze({
    id: "explore-token",
    method: "GET",
    path: `/api/explore/token?chain=1&address=${TEST_ADDRESS}`,
    validateBody: exactPublicUnavailableBody,
  }),
  Object.freeze({
    id: "explore-token-analytics",
    method: "GET",
    path:
      `/api/explore/token/analytics?chain=1&address=${TEST_ADDRESS}&section=summary`,
    validateBody: exactPublicUnavailableBody,
  }),
  Object.freeze({
    id: "explore-token-chart",
    method: "GET",
    path: `/api/explore/token/chart?address=${TEST_ADDRESS}&range=1d`,
    validateBody: exactChartUnavailableBody,
  }),
  Object.freeze({
    id: "explore-profile",
    method: "GET",
    path: `/api/explore/profile?account=${TEST_ADDRESS}`,
    validateBody: exactProfileUnavailableBody,
  }),
]);

const RETIRED_OPERATION_PROBES = Object.freeze([
  Object.freeze({ id: "index-v2", method: "GET", path: "/api/ops/index-v2" }),
  Object.freeze({ id: "projector", method: "GET", path: "/api/ops/projector" }),
  Object.freeze({
    id: "market-projector",
    method: "GET",
    path: "/api/ops/market-projector",
  }),
  Object.freeze({
    id: "alchemy-launch-refresh",
    method: "GET",
    path: "/api/ops/alchemy-launch-refresh",
  }),
  Object.freeze({
    id: "read-model-performance-capture",
    method: "POST",
    path: "/api/ops/read-model-performance-capture",
  }),
  Object.freeze({
    id: "read-model-real-block-sla-post",
    operation: "read-model-real-block-sla",
    method: "POST",
    path: "/api/ops/read-model-real-block-sla",
  }),
  Object.freeze({
    id: "read-model-real-block-sla-put",
    operation: "read-model-real-block-sla",
    method: "PUT",
    path: "/api/ops/read-model-real-block-sla",
  }),
]);

const PAUSED_TRIGGER_PROBES = Object.freeze([
  Object.freeze({
    id: "projector-wake",
    method: "POST",
    path: "/api/ops/projector-wake",
  }),
  Object.freeze({
    id: "alchemy-webhook",
    method: "POST",
    path: "/api/alchemy/webhook",
  }),
]);

const RUNTIME_PROBE_COUNT =
  RETIRED_OPERATION_PROBES.length + PAUSED_TRIGGER_PROBES.length + 1;

function exactOrigin(value, targetKind) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("Explore index-reset smoke target is not an exact origin");
  }
  const exactOriginShape =
    target.protocol === "https:" &&
    target.username === "" &&
    target.password === "" &&
    target.port === "" &&
    target.pathname === "/" &&
    target.search === "" &&
    target.hash === "";
  const expectedHost = targetKind === "staged"
    ? target.hostname.endsWith(".vercel.app")
    : target.toString() === PRODUCTION_ORIGIN;
  if (!exactOriginShape || !expectedHost) {
    throw new Error("Explore index-reset smoke target is not an exact origin");
  }
  return target;
}

function exactObjectKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function exactPublicUnavailableBody(body) {
  return exactObjectKeys(body, ["error", "status"]) &&
    body.error === PUBLIC_UNAVAILABLE_BODY.error &&
    body.status === PUBLIC_UNAVAILABLE_BODY.status;
}

function exactIsoTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function exactChartUnavailableBody(body, nowMs) {
  if (
    !exactObjectKeys(body, [
      "address",
      "error",
      "generatedAt",
      "range",
      "reason",
      "schemaVersion",
      "source",
      "status",
    ]) ||
    body.schemaVersion !== "programmable.market-chart-error.v2" ||
    body.source !== "programmable" ||
    body.status !== "unavailable" ||
    body.address !== TEST_ADDRESS ||
    body.range !== "1d" ||
    body.reason !== "identity-unavailable" ||
    body.error !== "Price history is temporarily unavailable" ||
    !exactIsoTimestamp(body.generatedAt)
  ) return false;
  return Math.abs(nowMs - Date.parse(body.generatedAt)) <=
    MAXIMUM_GENERATED_AT_SKEW_MS;
}

function exactProfileUnavailableBody(body) {
  return exactObjectKeys(body, ["error", "status"]) &&
    body.status === "error" &&
    exactObjectKeys(body.error, ["code", "kind", "message"]) &&
    body.error.kind === "temporary" &&
    body.error.code === "creator_profile_temporarily_unavailable" &&
    body.error.message ===
      "Onchain creator data is temporarily unavailable";
}

function exactOperationBody(body, expectedStatus, operation) {
  return exactObjectKeys(body, ["code", "operation", "status"]) &&
    body.status === expectedStatus &&
    body.code === "indexing_reset" &&
    body.operation === operation;
}

function exactHealthBody(body, nowMs) {
  if (!exactObjectKeys(body, ["schemaVersion", "scope", "status", "checkedAt", "indexes", "providers", "customLaunchReadiness"])
    || body.schemaVersion !== "programmable.operations-health.v2" || body.scope !== "website-launch-indexes"
    || typeof body.checkedAt !== "string" || !Number.isFinite(Date.parse(body.checkedAt))
    || Math.abs(nowMs - Date.parse(body.checkedAt)) > MAXIMUM_GENERATED_AT_SKEW_MS
    || !Array.isArray(body.indexes) || body.indexes.length !== 3) return false;
  const indexes = [
    { chainId: 1, path: "ethereum", statuses: ["ready", "partial", "stale", "unavailable"] },
    { chainId: 4663, path: "robinhood", statuses: ["ready", "syncing", "stale", "unavailable"] },
    { chainId: 8453, path: "base", statuses: ["ready", "stale", "unavailable"] },
  ];
  if (!indexes.every((expected, index) => {
    const actual = body.indexes[index];
    return exactObjectKeys(actual, ["chainId", "status", "updatedAt", "catalogUrl"])
      && actual.chainId === expected.chainId && expected.statuses.includes(actual.status)
      && (actual.updatedAt === null || typeof actual.updatedAt === "string" && Number.isFinite(Date.parse(actual.updatedAt)))
      && actual.catalogUrl === `https://programmable.market/api/explore/${expected.path}`;
  })) return false;
  const status = body.indexes.every(index => index.status === "ready") ? "ready"
    : body.indexes.every(index => index.status === "unavailable") ? "unavailable" : "degraded";
  if (body.status !== status || !Array.isArray(body.providers) || body.providers.length !== 1) return false;
  const provider = body.providers[0];
  if (!exactObjectKeys(provider, ["name", "roles", "health"]) || provider.name !== "codex" || provider.health !== "not-checked"
    || JSON.stringify(provider.roles) !== JSON.stringify(["ethereum-and-robinhood-market-data"])) return false;
  const readiness = [
    { chainId: 1, readiness: "/readyz", capabilities: "/v3/capabilities" },
    { chainId: 4663, readiness: "/v4/chains/4663/custom-launch-plans/readiness", capabilities: "/v4/chains/4663/custom-launch-capabilities" },
    { chainId: 8453, readiness: "/v4/chains/8453/readiness", capabilities: "/v4/chains/8453/capabilities" },
  ];
  return Array.isArray(body.customLaunchReadiness) && body.customLaunchReadiness.length === 3
    && readiness.every((expected, index) => {
      const actual = body.customLaunchReadiness[index];
      return exactObjectKeys(actual, ["chainId", "readinessUrl", "capabilitiesUrl"])
        && actual.chainId === expected.chainId && actual.readinessUrl === `https://api.programmable.market${expected.readiness}`
        && actual.capabilitiesUrl === `https://api.programmable.market${expected.capabilities}`;
    });
}

function hasHealthResponse(response, body) {
  return response.status === (body?.status === "unavailable" ? 503 : 200)
    && response.headers.get("cache-control") === "no-store"
    && response.headers.get("x-programmable-indexing-status") === body?.status
    && response.headers.get("retry-after") === null;
}

function hasResetHeaders(response, { publicRoute }) {
  if (
    response.headers.get("cache-control") !== RESET_CACHE_CONTROL ||
    response.headers.get("x-programmable-indexing-status") !==
      RESET_STATUS_HEADER ||
    response.headers.get("retry-after") !==
      (publicRoute ? RESET_RETRY_AFTER : null)
  ) return false;

  for (const [name] of response.headers) {
    if (
      name.startsWith("x-programmable-") &&
      name !== "x-programmable-indexing-status"
    ) return false;
  }
  return true;
}

async function parseBoundedJson(response, label) {
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    await response.body?.cancel?.("unexpected content type").catch(() => {});
    throw new Error(`${label} did not return JSON`);
  }
  const text = await readBoundedResponseText(response, {
    maximumBytes: MAXIMUM_RESPONSE_BYTES,
    label,
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function requestResetContract(input) {
  const requestUrl = new URL(input.path, input.target);
  if (requestUrl.origin !== input.target.origin) {
    throw new Error("Explore index-reset smoke request escaped its origin");
  }
  const response = await input.fetchImpl(requestUrl, {
    method: input.method,
    headers: input.headers,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const label = `index-reset API ${input.path}`;
  const body = await parseBoundedJson(response, label);
  if (
    !(input.validateResponse ? input.validateResponse(response, body)
      : response.status === input.expectedStatus && hasResetHeaders(response, { publicRoute: input.publicRoute })) ||
    !input.validateBody(body, input.nowMs)
  ) {
    throw new Error(`${label} does not match the exact reset contract`);
  }
}

async function runExploreIndexResetSmoke(input) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const appendOutput = input.appendOutput ?? appendFileSync;
  const now = input.now ?? (() => new Date());
  if (typeof fetchImpl !== "function" || typeof appendOutput !== "function") {
    throw new Error("Explore index-reset smoke dependencies are invalid");
  }
  if (typeof now !== "function") {
    throw new Error("Explore index-reset smoke clock is invalid");
  }
  const observedNow = now();
  if (!(observedNow instanceof Date) || !Number.isFinite(observedNow.getTime())) {
    throw new Error("Explore index-reset smoke clock is invalid");
  }

  const target = exactOrigin(input.targetUrl, input.targetKind);
  const headers = new Headers({ Accept: "application/json" });
  if (input.targetKind === "staged") {
    if (typeof input.bypass !== "string" || input.bypass.trim().length < 16) {
      throw new Error("Explore index-reset smoke automation bypass is unavailable");
    }
    headers.set("x-vercel-protection-bypass", input.bypass.trim());
    headers.set("x-vercel-set-bypass-cookie", "false");
    if (typeof input.githubOutput !== "string" || input.githubOutput === "") {
      throw new Error("Explore index-reset smoke GITHUB_OUTPUT is unavailable");
    }
  }

  const publicRequests = PUBLIC_PROBES.map((probe) =>
    requestResetContract({
      ...probe,
      target,
      headers,
      fetchImpl,
      nowMs: observedNow.getTime(),
      expectedStatus: 503,
      publicRoute: true,
    })
  );
  const retiredOperationRequests = RETIRED_OPERATION_PROBES.map((probe) =>
    requestResetContract({
      ...probe,
      target,
      headers,
      fetchImpl,
      nowMs: observedNow.getTime(),
      expectedStatus: 410,
      publicRoute: false,
      validateBody: (body) =>
        exactOperationBody(
          body,
          "index_rebuilding",
          probe.operation ?? probe.id,
        ),
    })
  );
  const pausedTriggerRequests = PAUSED_TRIGGER_PROBES.map((probe) =>
    requestResetContract({
      ...probe,
      target,
      headers,
      fetchImpl,
      nowMs: observedNow.getTime(),
      expectedStatus: 200,
      publicRoute: false,
      validateBody: (body) => exactOperationBody(body, "paused", probe.id),
    })
  );
  const healthRequest = requestResetContract({
    target,
    headers,
    fetchImpl,
    nowMs: observedNow.getTime(),
    id: "health",
    method: "GET",
    path: "/api/ops/health",
    expectedStatus: 200,
    publicRoute: false,
    validateBody: exactHealthBody,
    validateResponse: hasHealthResponse,
  });

  await Promise.all([
    ...publicRequests,
    ...retiredOperationRequests,
    ...pausedTriggerRequests,
    healthRequest,
  ]);

  if (input.targetKind === "staged") {
    appendOutput(
      input.githubOutput,
      [
        "indexing_status=index-reset",
        `public_routes_checked=${PUBLIC_PROBES.length}`,
        `retired_operations_checked=${RUNTIME_PROBE_COUNT}`,
        "provider_calls_expected=0",
      ].join("\n") + "\n",
      "utf8",
    );
  }

  const result = Object.freeze({
    status: "verified-explore-index-reset-public-apis",
    targetKind: input.targetKind,
    publicRoutesChecked: PUBLIC_PROBES.length,
    retiredOperationsChecked: RUNTIME_PROBE_COUNT,
    providerCallsExpected: 0,
    providerCallsScope: "legacy-reset-routes",
    healthScope: "website-launch-indexes",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

export function runStagedExploreIndexResetSmokeV1(input = {}) {
  const environment = input.environment ?? process.env;
  return runExploreIndexResetSmoke({
    targetKind: "staged",
    targetUrl: environment.STAGED_TARGET_URL,
    bypass: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
    githubOutput: environment.GITHUB_OUTPUT,
    fetchImpl: input.fetchImpl,
    appendOutput: input.appendOutput,
    now: input.now,
  });
}

export function runProductionExploreIndexResetSmokeV1(input = {}) {
  return runExploreIndexResetSmoke({
    targetKind: "production",
    targetUrl: PRODUCTION_ORIGIN,
    fetchImpl: input.fetchImpl,
    appendOutput: input.appendOutput,
    now: input.now,
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await runStagedExploreIndexResetSmokeV1();
}
