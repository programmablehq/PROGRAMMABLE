import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperLaunchHistoryBridgeV1,
  CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
  CUSTOM_LAUNCH_LIST_SCHEMA_V1,
  CUSTOM_LAUNCH_LIST_SCHEMA_V2,
  CUSTOM_LAUNCH_LIST_SCHEMA_V3,
  CUSTOM_LAUNCH_LIST_SCHEMA_V4,
  CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1,
  CUSTOM_LAUNCH_SUMMARY_SCHEMA_V4,
} from "../lib/server/custom-launch/launch-history-bridge-v1";
import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER_WALLET = "0x2222222222222222222222222222222222222222" as const;
const LAUNCH_ID = "40000000-0000-4000-8000-000000000004";
const V2_LAUNCH_ID = "50000000-0000-4000-8000-000000000005";
const V3_LAUNCH_ID = "60000000-0000-4000-8000-000000000006";
const V3_NATIVE_LAUNCH_ID = "70000000-0000-4000-8000-000000000007";
const V3_ACTION_REQUIRED_LAUNCH_ID = "80000000-0000-4000-8000-000000000008";
const V4_LAUNCH_ID = "90000000-0000-4000-8000-000000000009";
const V4_REQUEST_ID = "a0000000-0000-4000-8000-00000000000a";
const V4_CHAIN_DEPLOYMENT_ID = "robinhood-mainnet-custom-launch-v1";
const V4_CHAIN_DEPLOYMENT_DIGEST = `0x${"aa".repeat(32)}` as const;
const V4_TRANSACTION_HASH = `0x${"bb".repeat(32)}` as const;
const WEBSITE_TOKEN = "w".repeat(43);
const BFF_ASSERTION_KEY = "b".repeat(43);
const ASSERTION_ISSUED_AT = "2026-08-27T08:00:00.000Z";
const RAW_PROGRAMMABLE_API_KEY =
  `pm_live_${"a".repeat(22)}_${"b".repeat(43)}`;
const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function correlatedError(response: Response) {
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toMatch(REQUEST_ID);
  const body = await response.json();
  expect(body.error.requestId).toBe(requestId);
  return { body, requestId };
}

const EXTERNAL_LIQUIDITY_INTENT = Object.freeze({
  model: "external-concentrated-liquidity",
  declaredLaunchState: "liquidity_required",
  binding: "legacy-v3-default",
});
const SEEDED_LIQUIDITY_INTENT = Object.freeze({
  model: "launch-seeded-concentrated-liquidity",
  declaredLaunchState: "assessment_required",
  binding: "explicit-request-hash",
});
const INVENTORY_LIQUIDITY_INTENT = Object.freeze({
  model: "hook-inventory-custom-accounting",
  declaredLaunchState: "assessment_required",
  binding: "explicit-request-hash",
});

const PROJECT_METADATA = Object.freeze({
  schemaVersion: "programmable.project-metadata.v1",
  token: Object.freeze({ name: "Example Hook", symbol: "HOOK" }),
  presentation: Object.freeze({
    schemaVersion: "programmable.launch-presentation-draft.v1",
    description: "A project-owned Uniswap v4 hook.",
    image: Object.freeze({
      uri: "https://assets.example.com/hook.png",
      contentSha256: `sha256:${"44".repeat(32)}`,
      mediaType: "image/png",
      byteLength: 4_096,
      width: 512,
      height: 512,
    }),
    links: Object.freeze([
      Object.freeze({ kind: "documentation", uri: "https://docs.example.com/" }),
      Object.freeze({ kind: "website", uri: "https://example.com/" }),
      Object.freeze({ kind: "x", uri: "https://x.com/example" }),
    ]),
  }),
  tokenMetadataBinding: Object.freeze({
    schemaVersion: "programmable.project-token-metadata-binding.v1",
    tokenTargetId: "token",
    declarationBinding: "request-and-launch-id",
    standardReadModel: Object.freeze({ name: true, symbol: true }),
    name: Object.freeze({
      staticSource: "constructor-argument",
      argumentIndex: 0,
      argumentName: "name_",
    }),
    symbol: Object.freeze({
      staticSource: "constructor-argument",
      argumentIndex: 1,
      argumentName: "symbol_",
    }),
    postDeploymentReadback: "required",
  }),
});

function projectMetadataHash(metadata: unknown) {
  const hash = createHash("sha256");
  hash.update("programmable.project-metadata.v1", "utf8");
  hash.update(Buffer.from([0]));
  hash.update(canonicalizeJson(metadata), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

const PROJECT_METADATA_HASH = projectMetadataHash(PROJECT_METADATA);
const UNBOUND_GRAPH_BUNDLE_HASH = `sha256:${"ab".repeat(32)}` as const;

function projectGraphBundleHash(
  unboundGraphBundleHash: string,
  metadataHash: string,
) {
  const hash = createHash("sha256");
  hash.update("programmable.custom-graph-project-metadata.v1", "utf8");
  hash.update(Buffer.from([0]));
  hash.update(canonicalizeJson({
    graphBundleHash: unboundGraphBundleHash,
    projectMetadataHash: metadataHash,
  }), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

const GRAPH_BUNDLE_HASH = projectGraphBundleHash(
  UNBOUND_GRAPH_BUNDLE_HASH,
  PROJECT_METADATA_HASH,
);

function launch(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v1",
    launchId: LAUNCH_ID,
    requestId: LAUNCH_ID,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v1",
    ownerWallet,
    status: "authorized",
    requestHash: `sha256:${"11".repeat(32)}`,
    createdAt: "2026-08-24T12:00:00.000Z",
    updatedAt: "2026-08-24T12:00:01.000Z",
    output: {
      walletTransaction: {
        to: "0x3333333333333333333333333333333333333333",
        calldata: "0x1234",
        requiresControllerWalletSignature: true,
        broadcastByService: false,
      },
    },
    failure: null,
  };
}

function cursor(
  launchId: string = LAUNCH_ID,
  createdAt = "2026-08-24T12:00:00.000Z",
) {
  return Buffer.from(JSON.stringify({
    createdAt,
    launchId,
  }), "utf8").toString("base64url");
}

function launchV2(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v2",
    launchId: V2_LAUNCH_ID,
    requestId: V2_LAUNCH_ID,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v2",
    ownerWallet,
    status: "simulating",
    requestHash: `sha256:${"22".repeat(32)}`,
    launchProfileHash: `sha256:${"33".repeat(32)}`,
    launchIntentHash: `sha256:${"44".repeat(32)}`,
    createdAt: "2026-08-24T12:01:00.000Z",
    updatedAt: "2026-08-24T12:01:01.000Z",
    output: null,
    failure: null,
  };
}

function launchV3(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v3",
    launchId: V3_LAUNCH_ID,
    requestId: V3_LAUNCH_ID,
    onchainLaunchId: null,
    routeId: "custom-launch:create:v3",
    ownerWallet,
    status: "awaiting_funding_authorization",
    requestHash: `sha256:${"55".repeat(32)}`,
    launchProfileVersion: "3.2.0",
    launchProfileHash: `sha256:${"66".repeat(32)}`,
    launchIntentHash: `sha256:${"77".repeat(32)}`,
    projectMetadata: PROJECT_METADATA,
    projectMetadataHash: PROJECT_METADATA_HASH,
    fundingIntentHash: `0x${"88".repeat(32)}`,
    liquidityIntent: EXTERNAL_LIQUIDITY_INTENT,
    createdAt: "2026-08-24T12:02:00.000Z",
    updatedAt: "2026-08-24T12:02:01.000Z",
    output: null,
    failure: null,
  };
}

const FUNDING_BOUNDARY = Object.freeze({
  approvalTransactionRequired: false,
  permit2Used: false,
  fundingSignatureProducedByService: false,
  walletTransactionBroadcastByService: false,
});
const SOURCE_VERIFICATION = Object.freeze({
  schemaVersion: "programmable.source-verification-status.v1",
  status: "queued",
  components: [Object.freeze({
    targetId: "token",
    address: "0x3333333333333333333333333333333333333333",
    status: "queued",
    provider: null,
  })],
  updatedAt: "2026-08-24T12:05:00.000Z",
});
const REMEDIATION = Object.freeze({
  schemaVersion: "programmable.custom-launch-remediation.v1",
  remediationId: "PLATFORM_ADMISSION_FINDING",
  code: "SOURCE_MUTABLE_TRANSFER_RESTRICTION",
  stage: "admission",
  targetId: "token",
  targetRole: "token",
  sourcePath: "src/Token.sol",
  expected: "No mutable transfer restriction",
  observed: "Owner can change transfer state",
  requiredChange: "Remove the mutable restriction and rebuild the bundle.",
  catalogUrl: "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
  guideUrl: "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
  retryable: false,
  requiresNewRequest: true,
  resumeAt: "pack",
});

function launchV3Native(ownerWallet: string = WALLET) {
  return {
    ...launchV3(ownerWallet),
    launchId: V3_NATIVE_LAUNCH_ID,
    requestId: V3_NATIVE_LAUNCH_ID,
    status: "pending_review",
    fundingIntentHash: null,
    liquidityIntent: SEEDED_LIQUIDITY_INTENT,
    createdAt: "2026-08-24T12:03:00.000Z",
    updatedAt: "2026-08-24T12:03:01.000Z",
    output: {
      schemaVersion: "programmable.custom-launch-authorization-result.v3",
      integrationState: "ready",
      stage: "platform-review-pending",
      actionRequired: null,
      fundingBoundary: FUNDING_BOUNDARY,
    },
  };
}

function launchV3ActionRequired(ownerWallet: string = WALLET) {
  const reportSha256 = `sha256:${"99".repeat(32)}`;
  return {
    ...launchV3Native(ownerWallet),
    launchId: V3_ACTION_REQUIRED_LAUNCH_ID,
    requestId: V3_ACTION_REQUIRED_LAUNCH_ID,
    status: "action_required",
    liquidityIntent: INVENTORY_LIQUIDITY_INTENT,
    createdAt: "2026-08-24T12:04:00.000Z",
    updatedAt: "2026-08-24T12:04:01.000Z",
    output: {
      schemaVersion: "programmable.custom-launch-authorization-result.v3",
      integrationState: "ready",
      stage: "platform-review-action-required",
      actionRequired: {
        kind: "security-review",
        reportSha256,
        findingCodes: ["SOURCE_MUTABLE_TRANSFER_RESTRICTION"],
        message: "Additional platform review is required before wallet authorization.",
      },
      staticBaseline: {
        schemaVersion: "programmable.custom-launch-static-baseline-report.v1",
        gateVersion: "1.0.0",
        reportSha256,
        findings: [{
          code: "SOURCE_MUTABLE_TRANSFER_RESTRICTION",
          severity: "high",
          targetId: "token",
        }],
      },
      fundingBoundary: FUNDING_BOUNDARY,
    },
  };
}

function launchSummaryV4(ownerWallet: string = WALLET) {
  return {
    launchId: V4_LAUNCH_ID,
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeploymentId: V4_CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: V4_CHAIN_DEPLOYMENT_DIGEST,
    controller: {
      namespace: "eip155:4663",
      address: ownerWallet,
    },
    status: "wallet_action_required",
    walletHandoffUrl:
      `https://programmable.market/developers/api-keys?launchId=${V4_LAUNCH_ID}&chainId=4663`,
    expiresAt: "2026-08-29T12:15:00.000Z",
    createdAt: "2026-08-29T12:05:00.000Z",
    updatedAt: "2026-08-29T12:05:01.000Z",
  };
}

function launchV4(ownerWallet: string = WALLET) {
  return {
    schemaVersion: "programmable.custom-launch.v4",
    apiVersion: "v4",
    launchId: V4_LAUNCH_ID,
    requestId: V4_REQUEST_ID,
    routeId: "custom-launch:create:v4",
    chainId: "4663",
    caip2: "eip155:4663",
    chainDeploymentId: V4_CHAIN_DEPLOYMENT_ID,
    chainDeploymentDescriptorDigest: V4_CHAIN_DEPLOYMENT_DIGEST,
    chainDeployment: {
      schemaVersion: "programmable.custom-launch-chain-deployment.v1",
    },
    profile: {
      schemaVersion: "programmable.custom-launch-profile-ref.v4",
    },
    controller: {
      namespace: "eip155:4663",
      address: ownerWallet,
    },
    status: "validating",
    requestHash: `sha256:${"11".repeat(32)}`,
    rawRequestSha256: `sha256:${"22".repeat(32)}`,
    sourceBuildCommitment: `sha256:${"33".repeat(32)}`,
    graphCommitment: `sha256:${"44".repeat(32)}`,
    metadataCommitment: `sha256:${"55".repeat(32)}`,
    walletTransactionPreimageHash: null,
    commitments: {
      sourceBuild: `sha256:${"33".repeat(32)}`,
      graph: `sha256:${"44".repeat(32)}`,
      metadata: `sha256:${"55".repeat(32)}`,
      verification: `sha256:${"66".repeat(32)}`,
      fundingPermit: `sha256:${"77".repeat(32)}`,
      launchIntent: `sha256:${"88".repeat(32)}`,
    },
    projectMetadata: PROJECT_METADATA,
    funding: {
      schemaVersion: "programmable.custom-launch-funding-intent.v2",
      mode: "none",
      valueWei: "0",
    },
    liquidityModel: {
      schemaVersion: "programmable.custom-launch-liquidity-model.v1",
      model: "none-empty-pool",
      declaredLaunchState: "pool-initialized-empty",
      targetIds: [],
    },
    walletTransaction: null,
    preparedArtifact: null,
    admissionReceipt: null,
    simulationReceipt: null,
    externalContractEvidenceReceipt: null,
    onchain: null,
    failure: null,
    createdAt: "2026-08-29T12:05:00.000Z",
    updatedAt: "2026-08-29T12:05:01.000Z",
  };
}

function backendJson(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V1,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function backendJsonV2(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V2,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function backendJsonV3(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V3,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function backendJsonV4(body: Readonly<Record<string, unknown>>) {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V4,
    apiVersion: "v4",
    chainId: "4663",
    chainDeploymentId: V4_CHAIN_DEPLOYMENT_ID,
    ...body,
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function missingV2() {
  return new Response(null, { status: 404 });
}

function v3IntegrationPending() {
  return new Response(JSON.stringify({
    schemaVersion: CUSTOM_LAUNCH_LIST_SCHEMA_V3,
    error: {
      code: "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING",
      message: "V3 launch integration is not active yet.",
    },
  }), {
    status: 503,
    headers: {
      "content-type": "application/json",
      "retry-after": "30",
    },
  });
}

describe("developer launch history same-origin bridge", () => {
  const authenticate = vi.fn();
  const fetchBackend = vi.fn();
  let assertionNonceCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockReset();
    fetchBackend.mockReset();
    assertionNonceCounter = 0;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authenticate.mockResolvedValue({
      privyUserId: "did:privy:test-user",
      privySessionId: "session-1",
      wallets: [WALLET],
    });
    fetchBackend.mockResolvedValue(new Response(null, { status: 404 }));
  });

  function bridge() {
    return createDeveloperLaunchHistoryBridgeV1({
      authenticator: { authenticate },
      backendBaseUrl: "https://custom-launch-api.example/",
      websiteToken: WEBSITE_TOKEN,
      bffAssertionKeyV2: BFF_ASSERTION_KEY,
      fetchBackend,
      backendTimeoutMs: 1_000,
      assertionNow: () => new Date(ASSERTION_ISSUED_AT),
      assertionNonce: () => Buffer.alloc(
        16,
        ++assertionNonceCounter,
      ).toString("base64url"),
    });
  }

  it("returns the exact wallet history and preserves its prepared wallet transaction", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      launches: [launch()],
      nextCursor: cursor(),
      internalDebug: "must-not-cross-the-bff",
    })).mockResolvedValueOnce(missingV2());
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
      {
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
          "x-privy-identity-token": "identity-token",
        },
      },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launch()],
      nextCursor: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain("internalDebug");
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v1/wallet-admin/custom-launches?limit=5",
    );
    expect((fetchBackend.mock.calls[1]![0] as URL).toString()).toBe(
      "https://custom-launch-api.example/v2/wallet-admin/custom-launches?limit=5",
    );
    expect((fetchBackend.mock.calls[2]![0] as URL).toString()).toBe(
      "https://custom-launch-api.example/v3/wallet-admin/custom-launches?limit=5",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(headers.get("x-programmable-privy-user-id")).toBe(
      "did:privy:test-user",
    );
    expect(headers.get("x-programmable-wallet-address")).toBe(WALLET);
    expect(headers.get("x-privy-identity-token")).toBeNull();
    expect(headers.get("x-programmable-bff-assertion-version")).toBe("2");
    expect(headers.get("x-programmable-bff-assertion-issued-at")).toBe(
      ASSERTION_ISSUED_AT,
    );
    expect(headers.get("x-programmable-bff-assertion-body-sha256")).toBe(
      "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    const nonces = fetchBackend.mock.calls.slice(0, 3).map(([, requestInit]) =>
      new Headers((requestInit as RequestInit).headers).get(
        "x-programmable-bff-assertion-nonce",
      )
    );
    expect(new Set(nonces).size).toBe(3);
    expect(nonces.every((nonce) => /^[A-Za-z0-9_-]{22}$/u.test(nonce ?? "")))
      .toBe(true);
  });

  it("fails closed if the backend returns any other wallet", async () => {
    fetchBackend.mockResolvedValueOnce(backendJson({
      launches: [launch(OTHER_WALLET)],
      nextCursor: null,
    })).mockResolvedValueOnce(missingV2());
    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
    ));

    expect(response.status).toBe(503);
    const correlation = await correlatedError(response);
    expect(correlation.body.error.code).toBe(
      "launch_history_unavailable",
    );
    expect(console.error).toHaveBeenCalledWith(
      "Developer launch history request failed",
      {
        name: "BackendContractErrorV1",
        requestId: correlation.requestId,
      },
    );
  });

  it("checks one exact wallet-owned request through the reconciliation read", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(launch()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${LAUNCH_ID}?walletAddress=${WALLET}`,
      { headers: { authorization: "Bearer browser-privy-token" } },
    ), LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(launch());
    const [url] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://custom-launch-api.example/v1/wallet-admin/custom-launches/${LAUNCH_ID}`,
    );
  });

  it.each([
    [400, "REQUEST_SCHEMA_INVALID", null],
    [409, "RECONCILIATION_CONFLICT", null],
    [429, "LAUNCH_QUOTA_EXCEEDED", "19"],
  ] as const)(
    "preserves bounded backend HTTP %i errors and correlation metadata",
    async (status, code, retryAfter) => {
      const requestId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
      fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: "programmable.api-error.v1",
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      }), {
        status,
        headers: {
          "content-type": "application/json",
          ...(retryAfter ? { "retry-after": retryAfter } : {}),
        },
      })).mockResolvedValueOnce(missingV2());

      const response = await bridge().list(new Request(
        `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
      ));

      expect(response.status).toBe(status);
      expect(response.headers.get("x-request-id")).toBe(requestId);
      expect(response.headers.get("retry-after")).toBe(retryAfter);
      expect(await response.json()).toEqual({
        schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
        error: {
          code,
          message: "The request could not be completed.",
          requestId,
        },
      });
    },
  );

  it("rejects non-linked wallets and malformed opaque cursors before backend access", async () => {
    const foreign = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${OTHER_WALLET}`,
    ));
    expect(foreign.status).toBe(403);

    const malformed = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&cursor=not-a-cursor`,
    ));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe("pagination_invalid");
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("assigns a fresh correlation ID to every locally generated error", async () => {
    const methodError = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
      { method: "POST" },
    ));
    const requestError = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&cursor=not-a-cursor`,
    ));

    expect(methodError.status).toBe(405);
    expect(methodError.headers.get("allow")).toBe("GET");
    expect(requestError.status).toBe(400);
    const methodCorrelation = await correlatedError(methodError);
    const requestCorrelation = await correlatedError(requestError);
    expect(methodCorrelation.requestId).not.toBe(requestCorrelation.requestId);
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("merges bounded route-isolated V1 and V2 pages without hiding simulating", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [launch()], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [launchV2()],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV2(), launch()],
      nextCursor: null,
    });
  });

  it("preserves an exact compact authorized V2 list row with null output", async () => {
    const compact = {
      ...launchV2(),
      status: "authorized",
      output: null,
    };
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [compact],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [compact],
      nextCursor: null,
    });
  });

  it("merges the additive compact V3 wallet lane without exposing output", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV3({
        launches: [launchV3()],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV3()],
      nextCursor: null,
    });
  });

  it("keeps an authorized V3 list row compact until single-resource hydration", async () => {
    const compact = { ...launchV3(), status: "authorized", output: null };
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV3({
        launches: [compact],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [compact],
      nextCursor: null,
    });
  });

  it("projects the exact minimized V4 wallet-admin list envelope into one compact website row", async () => {
    const backendSummary = launchSummaryV4();
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV3({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV4({
        launches: [backendSummary],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
      { headers: { authorization: "Bearer browser-privy-token" } },
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [{
        schemaVersion: CUSTOM_LAUNCH_SUMMARY_SCHEMA_V4,
        apiVersion: "v4",
        launchId: V4_LAUNCH_ID,
        requestId: V4_LAUNCH_ID,
        routeId: "custom-launch:create:v4",
        chainId: "4663",
        caip2: "eip155:4663",
        chainDeploymentId: V4_CHAIN_DEPLOYMENT_ID,
        chainDeploymentDescriptorDigest: V4_CHAIN_DEPLOYMENT_DIGEST,
        controller: {
          namespace: "eip155:4663",
          address: WALLET,
        },
        status: "wallet_action_required",
        walletHandoffUrl: backendSummary.walletHandoffUrl,
        expiresAt: backendSummary.expiresAt,
        createdAt: backendSummary.createdAt,
        updatedAt: backendSummary.updatedAt,
      }],
      nextCursor: null,
    });
    expect(Object.keys(body.launches[0])).toEqual([
      "schemaVersion", "apiVersion", "launchId", "requestId", "routeId",
      "chainId", "caip2", "chainDeploymentId",
      "chainDeploymentDescriptorDigest", "controller", "status",
      "walletHandoffUrl", "expiresAt", "createdAt", "updatedAt",
    ]);
    const [url, init] = fetchBackend.mock.calls[3] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v4/chains/4663/wallet-admin/custom-launches?limit=5",
    );
    expect(new Headers(init.headers).get("authorization"))
      .toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(new Headers(init.headers).get("x-programmable-wallet-address"))
      .toBe(WALLET);
  });

  it("returns one exact full V4 resource only from the chain-scoped wallet-admin route", async () => {
    const resource = launchV4();
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V4_LAUNCH_ID}?walletAddress=${WALLET}&version=v4`,
      { headers: { authorization: "Bearer browser-privy-token" } },
    ), V4_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://custom-launch-api.example/v4/chains/4663/wallet-admin/custom-launches/${V4_LAUNCH_ID}`,
    );
    expect(new Headers(init.headers).get("authorization"))
      .toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(new Headers(init.headers).get("x-programmable-wallet-address"))
      .toBe(WALLET);
  });

  it("accepts only null source verification on a non-finalized V4 wallet resource", async () => {
    const resource = {
      ...launchV4(),
      status: "wallet_action_required",
      walletTransaction: {},
      preparedArtifact: {},
      admissionReceipt: {},
      simulationReceipt: {},
      externalContractEvidenceReceipt: {},
      sourceVerification: null,
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V4_LAUNCH_ID}?walletAddress=${WALLET}&version=v4`,
      { headers: { authorization: "Bearer browser-privy-token" } },
    ), V4_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);

    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
      ...resource,
      sourceVerification: SOURCE_VERIFICATION,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const rejected = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V4_LAUNCH_ID}?walletAddress=${WALLET}&version=v4`,
      { headers: { authorization: "Bearer browser-privy-token" } },
    ), V4_LAUNCH_ID);

    expect(rejected.status).toBe(503);
    expect((await rejected.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("proxies only the chain-scoped V4 capabilities document", async () => {
    const capabilities = {
      schemaVersion: "programmable.custom-launch-capabilities.v2",
      apiVersion: "v4",
      chain: { id: "4663", caip2: "eip155:4663" },
      chainDeploymentId: V4_CHAIN_DEPLOYMENT_ID,
      walletHandoffBaseUrl:
        "https://programmable.market/developers/api-keys",
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(capabilities), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().getV4Capabilities(new Request(
      "https://programmable.market/api/developer/custom-launches/v4-capabilities",
      { headers: { accept: "application/json" } },
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(capabilities);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://custom-launch-api.example/v4/chains/4663/capabilities",
    );
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-programmable-wallet-address")).toBeNull();
  });

  it("forwards only a V4 transaction hash hint and validates the exact non-authoritative 202", async () => {
    const acceptedAt = "2026-08-29T12:06:00.000Z";
    const statusPath =
      `/v4/chains/4663/wallet-admin/custom-launches/${V4_LAUNCH_ID}`;
    const backendResponse = {
      schemaVersion: CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1,
      apiVersion: "v4",
      launchId: V4_LAUNCH_ID,
      chainId: "4663",
      chainDeploymentId: V4_CHAIN_DEPLOYMENT_ID,
      transactionHash: V4_TRANSACTION_HASH,
      accepted: true,
      authoritative: false,
      acceptedAt,
      statusPath,
    };
    fetchBackend.mockResolvedValueOnce(new Response(
      JSON.stringify(backendResponse),
      { status: 202, headers: { "content-type": "application/json" } },
    ));
    const submission = {
      schemaVersion: CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1,
      transactionHash: V4_TRANSACTION_HASH,
    };

    const response = await bridge().submitV4SubmissionHint(new Request(
      `https://programmable.market/api/developer/custom-launches/${V4_LAUNCH_ID}/submission-hint?walletAddress=${WALLET}&version=v4`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
          "content-type": "application/json",
        },
        body: JSON.stringify(submission),
      },
    ), V4_LAUNCH_ID);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(backendResponse);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://custom-launch-api.example${statusPath}/submission-hint`,
    );
    expect(Buffer.isBuffer(init.body)).toBe(true);
    const forwarded = JSON.parse(String(init.body));
    expect(forwarded).toEqual(submission);
    expect(Object.keys(forwarded)).toEqual([
      "schemaVersion",
      "transactionHash",
    ]);
    expect(String(init.body)).not.toContain("pm_live_");
    expect(String(init.body)).not.toContain("signedTransaction");
    expect(String(init.body)).not.toContain("rawTransaction");
    expect(String(init.body)).not.toContain("evidence");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${WEBSITE_TOKEN}`);
    expect(headers.get("authorization")).not.toContain(RAW_PROGRAMMABLE_API_KEY);
    expect(headers.get("idempotency-key")).toBeNull();
    expect(headers.get("x-programmable-bff-assertion-body-sha256"))
      .toBe(`sha256:${createHash("sha256")
        .update(init.body as Buffer)
        .digest("hex")}`);
  });

  it.each([
    ["apiKey", RAW_PROGRAMMABLE_API_KEY],
    ["rawTransaction", `0x${"cc".repeat(128)}`],
    ["signedTransaction", `0x${"dd".repeat(128)}`],
    ["evidence", { provider: "untrusted", result: "accepted" }],
  ] as const)(
    "rejects a V4 submission hint carrying the extra %s field before backend access",
    async (field, value) => {
      const response = await bridge().submitV4SubmissionHint(new Request(
        `https://programmable.market/api/developer/custom-launches/${V4_LAUNCH_ID}/submission-hint?walletAddress=${WALLET}&version=v4`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: CUSTOM_LAUNCH_SUBMISSION_HINT_SCHEMA_V1,
            transactionHash: V4_TRANSACTION_HASH,
            [field]: value,
          }),
        },
      ), V4_LAUNCH_ID);

      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("launch_history_unavailable");
      expect(fetchBackend).not.toHaveBeenCalled();
    },
  );

  it("preserves canonical project metadata and its domain-framed digest", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(
      JSON.stringify(launchV3()),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projectMetadata).toEqual(PROJECT_METADATA);
    expect(body.projectMetadataHash).toBe(PROJECT_METADATA_HASH);
  });

  it("accepts canonical LF-only multiline descriptions", async () => {
    const metadata = {
      ...PROJECT_METADATA,
      presentation: {
        ...PROJECT_METADATA.presentation,
        description: "First line\nSecond line",
      },
      tokenMetadataBinding: {
        ...PROJECT_METADATA.tokenMetadataBinding,
        name: {
          ...PROJECT_METADATA.tokenMetadataBinding.name,
          argumentName: "é".repeat(128),
        },
      },
    };
    const resource = {
      ...launchV3(),
      projectMetadata: metadata,
      projectMetadataHash: projectMetadataHash(metadata),
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect((await response.json()).projectMetadata.presentation.description)
      .toBe("First line\nSecond line");
  });

  it.each([["3.5.0", true], ["3.5.0", false], ["3.6.0", true], ["3.6.0", false]])("reads profile %s only when its metadata binding is valid: %s", async (launchProfileVersion, valid) => {
    const resource = {
      ...launchV3(),
      launchProfileVersion,
      projectMetadataHash: valid ? PROJECT_METADATA_HASH : `sha256:${"ff".repeat(32)}`,
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);
    expect(response.status).toBe(valid ? 200 : 503);
    if (valid) expect(await response.json()).toEqual(resource);
  });

  it.each(["2.0.0", "3.0.0", "3.1.0"] as const)(
    "keeps legacy V3 %s metadata absence readable only as an explicit null pair",
    async (launchProfileVersion) => {
    const legacy = {
      ...launchV3(),
      launchProfileVersion,
      projectMetadata: null,
      projectMetadataHash: null,
      status: "authorized",
      output: { artifact: { route: { routePayload: "0x" } } },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(legacy), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(legacy);
    },
  );

  it.each([
    ["a missing profile version", (() => {
      const { launchProfileVersion: _removed, ...incomplete } = launchV3();
      void _removed;
      return incomplete;
    })()],
    ["an unknown profile version", {
      ...launchV3(),
      launchProfileVersion: "9.9.0",
    }],
    ["metadata on a legacy profile", {
      ...launchV3(),
      launchProfileVersion: "3.1.0",
    }],
    ["missing metadata on the bound profile", {
      ...launchV3(),
      projectMetadata: null,
      projectMetadataHash: null,
    }],
    ["an artifact metadata key on a legacy profile", {
      ...launchV3(),
      launchProfileVersion: "3.1.0",
      projectMetadata: null,
      projectMetadataHash: null,
      output: { artifact: { projectMetadata: null } },
    }],
    ["an authorized bound profile without the artifact triple", {
      ...launchV3(),
      status: "authorized",
      output: null,
    }],
    ["an altered digest", (() => ({
      ...launchV3(),
      projectMetadataHash: `sha256:${"00".repeat(32)}`,
    }))()],
    ["only one metadata field", (() => {
      const { projectMetadataHash: _removed, ...incomplete } = launchV3();
      void _removed;
      return incomplete;
    })()],
    ["an extra metadata key", (() => {
      const metadata = { ...PROJECT_METADATA, unbound: true };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["unsorted links", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [...PROJECT_METADATA.presentation.links].reverse(),
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a credential-like project link", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: "https://example.com/?api_key=should-never-cross-this-boundary",
          }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a credential-like description", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "api_key=should-never-cross-this-boundary",
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a raw Programmable API key in metadata", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: `keep ${RAW_PROGRAMMABLE_API_KEY} secret`,
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a case-insensitive API key assignment", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "programmable_api_key=do-not-cross-this-boundary",
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a percent-encoded API key in an argument name", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          name: {
            ...PROJECT_METADATA.tokenMetadataBinding.name,
            argumentName: encodeURIComponent(RAW_PROGRAMMABLE_API_KEY),
          },
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a raw API key token target", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          tokenTargetId: RAW_PROGRAMMABLE_API_KEY,
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a percent-encoded API key in a project URL", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: `https://example.com/${encodeURIComponent(
              RAW_PROGRAMMABLE_API_KEY,
            )}`,
          }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["symbol whitespace", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        token: { ...PROJECT_METADATA.token, symbol: "BAD SYMBOL" },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a tab in the description", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "First line\tSecond line",
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a C1 control in the description", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "First line\u0085Second line",
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["CRLF in the description", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "First line\r\nSecond line",
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a path on a content-addressed image URI", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          image: {
            ...PROJECT_METADATA.presentation.image,
            uri: "ar://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/image.png",
          },
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a local project link", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{ kind: "website", uri: "https://project.local/" }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["the exact local hostname", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{ kind: "website", uri: "https://local/" }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["the trailing-dot exact local hostname", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{ kind: "website", uri: "https://local./" }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a trailing-dot localhost project link", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{ kind: "website", uri: "https://localhost./" }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a trailing-dot localhost subdomain project link", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{ kind: "website", uri: "https://project.localhost./" }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["an overlong UTF-8 argument name", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          name: {
            ...PROJECT_METADATA.tokenMetadataBinding.name,
            argumentName: "é".repeat(129),
          },
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a control character in an argument name", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          name: {
            ...PROJECT_METADATA.tokenMetadataBinding.name,
            argumentName: "bad\tname",
          },
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a C1 control in an argument name", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          name: {
            ...PROJECT_METADATA.tokenMetadataBinding.name,
            argumentName: "bad\u0085name",
          },
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a percent-encoded C1 control in a project URL", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          links: [{
            kind: "website",
            uri: "https://example.com/%C2%85hidden",
          }],
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: projectMetadataHash(metadata),
      };
    })()],
    ["a lone surrogate in project text", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        presentation: {
          ...PROJECT_METADATA.presentation,
          description: "bad\ud800text",
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: PROJECT_METADATA_HASH,
      };
    })()],
    ["a lone surrogate in an argument name", (() => {
      const metadata = {
        ...PROJECT_METADATA,
        tokenMetadataBinding: {
          ...PROJECT_METADATA.tokenMetadataBinding,
          name: {
            ...PROJECT_METADATA.tokenMetadataBinding.name,
            argumentName: "bad\ud800name",
          },
        },
      };
      return {
        ...launchV3(),
        projectMetadata: metadata,
        projectMetadataHash: PROJECT_METADATA_HASH,
      };
    })()],
  ])("fails closed on %s", async (_label, resource) => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("fails closed when an artifact carries a different metadata binding", async () => {
    const resource = {
      ...launchV3(),
      status: "authorized",
      output: {
        artifact: {
          projectMetadata: PROJECT_METADATA,
          projectMetadataHash: `sha256:${"00".repeat(32)}`,
        },
      },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("fails closed when the artifact graph hash is not metadata-bound", async () => {
    const resource = {
      ...launchV3(),
      status: "authorized",
      output: {
        artifact: {
          projectMetadata: PROJECT_METADATA,
          projectMetadataHash: PROJECT_METADATA_HASH,
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: `sha256:${"ff".repeat(32)}`,
        },
      },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("preserves exact V3 liquidity intent projections in compact list rows", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV3({
        launches: [launchV3Native(), launchV3ActionRequired()],
        nextCursor: null,
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV3ActionRequired(), launchV3Native()],
      nextCursor: null,
    });
    expect(body.launches.map((candidate: { liquidityIntent: unknown }) =>
      candidate.liquidityIntent
    )).toEqual([INVENTORY_LIQUIDITY_INTENT, SEEDED_LIQUIDITY_INTENT]);
  });

  it("preserves one exact V3 liquidity intent projection on single readback", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(
      JSON.stringify(launchV3Native()),
      { status: 200, headers: { "content-type": "application/json" } },
    ));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(launchV3Native());
    expect(body.liquidityIntent).toEqual(SEEDED_LIQUIDITY_INTENT);
  });

  it("preserves an exact same-origin wallet handoff", async () => {
    const resource = {
      ...launchV3Native(),
      status: "authorized",
      output: {
        artifact: {
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: GRAPH_BUNDLE_HASH,
          projectMetadata: PROJECT_METADATA,
          projectMetadataHash: PROJECT_METADATA_HASH,
        },
      },
      walletHandoffUrl:
        `/developers/api-keys?launchId=${V3_NATIVE_LAUNCH_ID}`,
      expiresAt: "2026-08-24T12:15:00.000Z",
      secondsRemaining: 600,
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
  });

  it("preserves source verification only as an independent finalized state", async () => {
    const resource = {
      ...launchV3Native(),
      status: "finalized",
      output: null,
      sourceVerification: SOURCE_VERIFICATION,
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
  });

  it.each(["8453", "999"])("retains the exact chain %s V3 wallet link from the owner resource", async chainId => {
    const resource = { ...launchV3(), chainId, walletHandoffUrl: `https://programmable.market/developers/api-keys?launchId=${V3_LAUNCH_ID}&chainId=${chainId}`,
      expiresAt: "2026-08-24T12:15:00.000Z", secondsRemaining: 600 };
    fetchBackend.mockResolvedValueOnce(backendJson(resource));
    const response = await bridge().get(new Request(`https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}?walletAddress=${WALLET}&version=v3&chainId=${chainId}`), V3_LAUNCH_ID);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(resource);
    expect((fetchBackend.mock.calls[0][0] as URL).pathname).toBe(`/v4/chains/${chainId}/wallet-admin/custom-launches/${V3_LAUNCH_ID}`);
  });

  it("fails closed on a cross-origin V3 wallet handoff", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
      ...launchV3Native(),
      status: "authorized",
      output: {
        artifact: {
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: GRAPH_BUNDLE_HASH,
          projectMetadata: PROJECT_METADATA,
          projectMetadataHash: PROJECT_METADATA_HASH,
        },
      },
      walletHandoffUrl:
        `https://evil.example/developers/api-keys?launchId=${V3_NATIVE_LAUNCH_ID}`,
      expiresAt: "2026-08-24T12:15:00.000Z",
      secondsRemaining: 600,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("preserves bounded machine-readable V3 failure remediation", async () => {
    const resource = {
      ...launchV3Native(),
      status: "failed",
      output: null,
      failure: {
        code: "PLATFORM_ADMISSION_FAILED",
        message: "Automatic admission found a blocking source condition.",
        retryable: false,
        remediations: [REMEDIATION],
      },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
  });

  it.each([
    ["missing binding", {
      model: "external-concentrated-liquidity",
      declaredLaunchState: "liquidity_required",
    }],
    ["an extra property", {
      ...SEEDED_LIQUIDITY_INTENT,
      currentLiquidity: "unknown",
    }],
    ["a mismatched declared state", {
      ...INVENTORY_LIQUIDITY_INTENT,
      declaredLaunchState: "liquidity_required",
    }],
    ["an unknown binding", {
      ...EXTERNAL_LIQUIDITY_INTENT,
      binding: "inferred",
    }],
  ])("fails closed when V3 liquidity intent has %s", async (_label, liquidityIntent) => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
      ...launchV3Native(),
      liquidityIntent,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("keeps V1 and V2 history available during exact V3 integration pending", async () => {
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [launch()], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [launchV2()],
        nextCursor: null,
      }))
      .mockResolvedValueOnce(v3IntegrationPending());

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [launchV2(), launch()],
      nextCursor: null,
    });
  });

  it("forwards one exact V3 funding signature without echoing it", async () => {
    const signature = `0x${"11".repeat(64)}1b`;
    const resource = {
      ...launchV3(),
      status: "funding_authorization_verified",
      output: {
        schemaVersion: "programmable.custom-launch-authorization-result.v3",
        integrationState: "ready",
        stage: "funding-signature-verified",
        actionRequired: null,
      },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    const submission = {
      schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
      fundingIntentHash: launchV3().fundingIntentHash,
      typedDataDigest: `0x${"99".repeat(32)}`,
      signature,
    };
    const response = await bridge().submitFundingAuthorization(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}/funding-authorization?walletAddress=${WALLET}&version=v3`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer browser-privy-token",
          "content-type": "application/json",
          "idempotency-key": "60000000-0000-4000-8000-000000000006",
        },
        body: JSON.stringify(submission),
      },
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual(resource);
    expect(JSON.stringify(body)).not.toContain(signature);
    const [url, init] = fetchBackend.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      `https://custom-launch-api.example/v3/wallet-admin/custom-launches/${V3_LAUNCH_ID}/funding-authorization`,
    );
    expect(new Headers(init.headers).get("idempotency-key")).toBe(
      "60000000-0000-4000-8000-000000000006",
    );
    expect(JSON.parse(String(init.body))).toEqual(submission);
    expect(Buffer.isBuffer(init.body)).toBe(true);
    expect(new Headers(init.headers).get(
      "x-programmable-bff-assertion-body-sha256",
    )).toBe(`sha256:${createHash("sha256")
      .update(init.body as Buffer)
      .digest("hex")}`);
    expect(new Headers(init.headers).get(
      "x-programmable-bff-assertion-signature",
    )).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
  });

  it("fails closed if an EIP-3009 funding response loses its bound intent hash", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
      ...launchV3(),
      status: "funding_authorization_verified",
      fundingIntentHash: null,
      output: {
        schemaVersion: "programmable.custom-launch-authorization-result.v3",
        integrationState: "ready",
        stage: "funding-signature-verified",
        actionRequired: null,
        fundingBoundary: FUNDING_BOUNDARY,
      },
    }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    const response = await bridge().submitFundingAuthorization(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}/funding-authorization?walletAddress=${WALLET}&version=v3`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": V3_LAUNCH_ID,
        },
        body: JSON.stringify({
          schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
          fundingIntentHash: launchV3().fundingIntentHash,
          typedDataDigest: `0x${"99".repeat(32)}`,
          signature: `0x${"11".repeat(64)}1b`,
        }),
      },
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("launch_history_unavailable");
  });

  it("rejects a funding signature without exact V3 binding before backend access", async () => {
    const response = await bridge().submitFundingAuthorization(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_LAUNCH_ID}/funding-authorization?walletAddress=${WALLET}&version=v3`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "programmable.custom-launch-funding-authorization-signature.v1",
          fundingIntentHash: launchV3().fundingIntentHash,
          typedDataDigest: `0x${"99".repeat(32)}`,
          signature: `0x${"11".repeat(64)}1b`,
        }),
      },
    ), V3_LAUNCH_ID);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_invalid");
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("keeps each backend cursor in its own route lane", async () => {
    const v1Cursor = cursor();
    const v2Cursor = cursor(V2_LAUNCH_ID, "2026-08-24T12:01:00.000Z");
    fetchBackend
      .mockResolvedValueOnce(backendJson({
        launches: [launch()],
        nextCursor: v1Cursor,
      }))
      .mockResolvedValueOnce(backendJsonV2({
        launches: [launchV2()],
        nextCursor: v2Cursor,
      }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(backendJsonV2({ launches: [], nextCursor: null }));

    const first = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5`,
    ));
    const firstBody = await first.json();
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}&limit=5&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    ));

    expect(second.status).toBe(200);
    expect((fetchBackend.mock.calls[4]![0] as URL).searchParams.get("cursor"))
      .toBe(v1Cursor);
    expect((fetchBackend.mock.calls[5]![0] as URL).searchParams.get("cursor"))
      .toBe(v2Cursor);
    expect(await second.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      launches: [],
      nextCursor: null,
    });
  });

  it("reads an exact V2 resource only from the V2 wallet-admin route", async () => {
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(launchV2()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V2_LAUNCH_ID}?walletAddress=${WALLET}&version=v2`,
    ), V2_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(launchV2());
    expect((fetchBackend.mock.calls[0]![0] as URL).toString()).toBe(
      `https://custom-launch-api.example/v2/wallet-admin/custom-launches/${V2_LAUNCH_ID}`,
    );
  });

  it("streams a large exact V2 handoff separately from compact history pages", async () => {
    const repeatedGraphBytes = `0x${"ab".repeat(80_000)}`;
    const resource = {
      ...launchV2(),
      status: "authorized",
      output: {
        artifact: {
          route: { routePayload: repeatedGraphBytes },
          unsignedRouterTransaction: {
            calldataWithEmptySignature: repeatedGraphBytes,
          },
        },
        walletTransaction: { calldata: repeatedGraphBytes },
        simulation: { outcome: "passed" },
      },
    };
    const serialized = JSON.stringify(resource);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(131_072);
    fetchBackend.mockResolvedValueOnce(new Response(serialized, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V2_LAUNCH_ID}?walletAddress=${WALLET}&version=v2`,
    ), V2_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
  });

  it("streams a bounded near-limit V3 rich handoff with repeated calldata", async () => {
    const repeatedGraphBytes = `0x${"ab".repeat(800_000)}`;
    const transaction = {
      schemaVersion: "programmable.exact-wallet-transaction.v3",
      chainId: "1",
      from: WALLET,
      to: "0x3333333333333333333333333333333333333333",
      valueWei: "0",
      calldata: repeatedGraphBytes,
    };
    const resource = {
      ...launchV3Native(),
      status: "authorized",
      output: {
        schemaVersion: "programmable.custom-launch-authorization-result.v3",
        integrationState: "ready",
        stage: "router-transaction-required",
        actionRequired: {
          kind: "send-router-transaction",
          transaction,
          graphCommitment: `0x${"aa".repeat(32)}`,
          artifactHash: `sha256:${"bb".repeat(32)}`,
          transactionPreimageHash: `sha256:${"cc".repeat(32)}`,
          permitDigest: `0x${"dd".repeat(32)}`,
          initializerCalldataHash: `0x${"ee".repeat(32)}`,
        },
        fundingBoundary: FUNDING_BOUNDARY,
        artifact: {
          projectMetadata: PROJECT_METADATA,
          projectMetadataHash: PROJECT_METADATA_HASH,
          unboundGraphBundleHash: UNBOUND_GRAPH_BUNDLE_HASH,
          graphBundleHash: GRAPH_BUNDLE_HASH,
          route: { routePayload: repeatedGraphBytes },
          unsignedRouterTransaction: {
            calldataWithEmptySignature: repeatedGraphBytes,
          },
        },
        signedPermit: { signature: `0x${"11".repeat(65)}` },
        observationWindow: { confirmations: 2 },
        onchain: null,
        walletTransaction: transaction,
        simulation: { outcome: "passed" },
      },
    };
    const serialized = JSON.stringify(resource);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(6_000_000);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(8_388_608);
    fetchBackend.mockResolvedValueOnce(new Response(serialized, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V3_NATIVE_LAUNCH_ID}?walletAddress=${WALLET}&version=v3`,
    ), V3_NATIVE_LAUNCH_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(resource);
  });

  it("stops streaming a single-resource response beyond the 8 MiB bound", async () => {
    const resource = {
      ...launchV2(),
      status: "authorized",
      output: { oversized: "a".repeat(8_390_000) },
    };
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify(resource), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await bridge().get(new Request(
      `https://programmable.market/api/developer/custom-launches/${V2_LAUNCH_ID}?walletAddress=${WALLET}&version=v2`,
    ), V2_LAUNCH_ID);

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe(
      "launch_history_unavailable",
    );
  });

  it("preserves the bounded V2 unavailable response and Retry-After", async () => {
    const requestId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
    fetchBackend
      .mockResolvedValueOnce(backendJson({ launches: [], nextCursor: null }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch-list.v2",
        error: {
          code: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
          message: "V2 launch history is temporarily unavailable.",
          requestId,
        },
      }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "17",
          "x-request-id": requestId,
        },
      }));

    const response = await bridge().list(new Request(
      `https://programmable.market/api/developer/custom-launches?walletAddress=${WALLET}`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    expect(await response.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_HISTORY_SCHEMA_V1,
      error: {
        code: "CUSTOM_LAUNCH_V2_UNAVAILABLE",
        message: "V2 launch history is temporarily unavailable.",
        requestId,
      },
    });
  });
});
