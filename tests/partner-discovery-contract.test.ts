import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PARTNER_CREDENTIALS_PUBLIC_CONTRACT_V1 } from
  "../lib/custom-launch/partner-credentials-v1";
import { PROGRAMMABLE_AGENT_SETUP_TEXT_V1 } from
  "../lib/custom-launch/agent-setup-v1";
import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from
  "../lib/custom-launch/registry-public-manifest-v1";
import {
  createProgrammableWellKnownHandlerV1,
  programmableWellKnownDocumentV1,
} from
  "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const BACKEND_PARTNER_CREDENTIALS_V1 = Object.freeze({
  schemaVersion: "programmable.partner-public-contract.v1",
  status: "live",
  environmentVariable: "PROGRAMMABLE_API_KEY",
  credentialKinds: ["root", "subkey"],
  canonicalV3LaunchRoutes: true,
  launchScopes: ["custom-launch:create", "custom-launch:read"],
  rootOnlyScope: "partner-subkeys:manage",
  subkeyAdminRoutes: [
    "GET /v1/partner/subkeys",
    "POST /v1/partner/subkeys",
    "POST /v1/partner/subkeys/{subkeyId}/rotate",
    "DELETE /v1/partner/subkeys/{subkeyId}",
  ],
  maximumSubkeyDepth: 1,
  subkeyScopesAndBudgetsCannotExceedRoot: true,
  subkeyExpiryCannotExceedRoot: true,
  permitReissueDispositionCredentialKind: "wallet-only",
  metadataPolicySameAsWalletKeys: true,
  controllerWallet: {
    walletKey: "must-equal-key-wallet-binding",
    partnerCredential: "selected-by-exact-request",
    mustReviewSignAndBroadcast: true,
  },
  launchHistoryVisibility: {
    root: "all-partner-attributed-root-and-subkey-launches",
    subkey: "stable-subkey-lineage-only",
    rootAggregatesSubkeys: true,
    rotationPreservesLineageHistory: true,
    newDistinctSubkeyStartsIsolatedLineage: true,
    revokedCredentialCanAuthenticate: false,
  },
  secretDelivery: "issue-and-rotation-response-only",
  callerSuppliedAttributionAccepted: false,
  attributionSource: "authenticated-partner-api-key",
  attributionIsVerificationOrSafetyClaim: false,
  walletSigningAuthority: false,
  walletBroadcastAuthority: false,
  gateBypassAuthority: false,
  adminProvisioning: {
    authentication: "website-bff-assertion-v2",
    authorization: "server-configured-privy-user-wallet-pair-allowlist",
    clientMaySelfAuthorize: false,
  },
});

describe("partner credential discovery", () => {
  it("keeps the website mirror exact with backend V3 capabilities", () => {
    expect(PARTNER_CREDENTIALS_PUBLIC_CONTRACT_V1).toEqual(
      BACKEND_PARTNER_CREDENTIALS_V1,
    );
    expect(Object.keys(PARTNER_CREDENTIALS_PUBLIC_CONTRACT_V1)).toEqual(
      Object.keys(BACKEND_PARTNER_CREDENTIALS_V1),
    );
  });

  it("publishes the exact object through dynamic discovery", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );

    expect(document.customLaunchApi.partnerCredentials).toEqual(
      BACKEND_PARTNER_CREDENTIALS_V1,
    );
    expect(document.customLaunchApi.publicRelease.authentication).toBe(
      "bearer-api-key",
    );
    expect(document.customLaunchApi.authentication).toBe("bearer-api-key");
  });

  it("serializes the exact object from the public well-known handler", async () => {
    const response = createProgrammableWellKnownHandlerV1({})(new Request(
      "https://programmable.market/.well-known/programmable.json",
    ));
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type"))
      .toBe("application/json; charset=utf-8");
    expect(document.customLaunchApi.partnerCredentials).toEqual(
      BACKEND_PARTNER_CREDENTIALS_V1,
    );
  });

  it("keeps published API-key formats and route detail in the bound OpenAPI", () => {
    const openApi = JSON.parse(read("public/openapi/custom-launch-v3.json"));

    expect(openApi.components.securitySchemes.CustomLaunchApiKey.bearerFormat)
      .toContain("pm_live_*");
    expect(openApi.components.securitySchemes.CustomLaunchApiKey.bearerFormat)
      .toContain("pm_partner_root_");
    expect(openApi.components.securitySchemes.CustomLaunchApiKey.bearerFormat)
      .toContain("pm_partner_");
    expect(openApi.components.securitySchemes.WalletCustomLaunchApiKey)
      .toMatchObject({ bearerFormat: "pm_live_*" });
    expect(openApi.paths["/v3/custom-launches/{launchId}/permit-reissues"]
      .post.security).toEqual([{ WalletCustomLaunchApiKey: [] }]);
  });

  it("keeps the dynamic contract free of OpenAPI-only route aliases", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    const openApi = JSON.parse(read("public/openapi/custom-launch-v3.json"));
    const partnerCredentials = document.customLaunchApi.partnerCredentials as
      Readonly<Record<string, unknown>>;

    expect(partnerCredentials.credentialFormats).toBeUndefined();
    expect(partnerCredentials.canonicalLaunchRoutes).toBeUndefined();
    expect(partnerCredentials.rootSubkeyRoutes).toBeUndefined();
    expect(partnerCredentials.attributionResponseField).toBeUndefined();
    expect(partnerCredentials.attributionSchemaVersion).toBeUndefined();
    expect(partnerCredentials.launchHistoryVisibility).toEqual({
      root: "all-partner-attributed-root-and-subkey-launches",
      subkey: "stable-subkey-lineage-only",
      rootAggregatesSubkeys: true,
      rotationPreservesLineageHistory: true,
      newDistinctSubkeyStartsIsolatedLineage: true,
      revokedCredentialCanAuthenticate: false,
    });
    expect(openApi["x-programmable-partner-credentials"].rootSubkeyRoutes)
      .toEqual(BACKEND_PARTNER_CREDENTIALS_V1.subkeyAdminRoutes);
    expect(openApi.paths["/v1/partner/subkeys"]).toBeDefined();
    expect(openApi.paths["/v1/partner/subkeys/{subkeyId}"]).toBeDefined();
    expect(openApi.components.schemas.LaunchPartnerAttributionV1).toBeDefined();
    expect(openApi["x-programmable-partner-credentials"])
      .toMatchObject({
        permitReissueDispositionCredentialKind: "wallet-only",
        metadataPolicySameAsWalletKeys: true,
        adminProvisioning: BACKEND_PARTNER_CREDENTIALS_V1.adminProvisioning,
        launchHistoryVisibility: {
          rootAggregatesSubkeys: true,
          rotationPreservesLineageHistory: true,
          newDistinctSubkeyStartsIsolatedLineage: true,
          revokedCredentialCanAuthenticate: false,
        },
      });
  });

  it("documents roots and subkeys without wallet-authority claims", () => {
    const sources = [
      read("app/docs/developers/custom-launch/page.tsx"),
      read("docs/public/developers/custom-launch.md"),
      read("docs/public/developers/machine-readable.md"),
      read("public/developers/custom-launch-api-v1.md"),
    ];

    for (const source of sources) {
      expect(source).toContain("customLaunchApi.partnerCredentials");
      expect(source).toMatch(/partner root/iu);
      expect(source).toMatch(/subkey/iu);
    }
    expect(read("docs/public/developers/README.md")).toContain(
      "[API reference](machine-readable.md)",
    );
    expect(sources.join("\n")).toMatch(
      /(?:cannot|no (?:api key|credential) can) sign(?:,| or)/iu,
    );
    expect(sources.join("\n")).toMatch(/(?:cannot|no credential can).*broadcast/iu);
    expect(sources.join("\n")).toMatch(/(?:cannot|no credential can).*bypass/iu);
  });

  it("keeps agent setup and guides on the same immutable lineage contract", () => {
    const sources = [
      PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
      read("docs/public/developers/custom-launch.md"),
      read("public/developers/custom-launch-api-v1.md"),
      read("packages/launch/README.md"),
    ];

    for (const source of sources) {
      expect(source).toMatch(/partner root (?:reads|sees|can (?:list and )?read) every launch/iu);
      expect(source).toMatch(/subkey|child/iu);
      expect(source).toMatch(/stable lineage|same lineage/iu);
      expect(source).toMatch(/rotation|rotating/iu);
    }
    expect(sources.join("\n")).not.toMatch(
      /rotation does not transfer the old subkey's private launch history/iu,
    );
  });
});
