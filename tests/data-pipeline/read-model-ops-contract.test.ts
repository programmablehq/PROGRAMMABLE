import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error Operational JavaScript modules intentionally have no declarations.
import { evaluateReadModelOperationsSourceContracts } from "../../scripts/perf/read-model-ops-source-contracts.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

function source(path: string) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function evaluate(sourceOverrides: Record<string, string> = {}) {
  return evaluateReadModelOperationsSourceContracts(ROOT, { sourceOverrides });
}

function failureIds(result: ReturnType<typeof evaluate>) {
  return result.failures.map(({ id }: { id: string }) => id);
}

describe("Explore index-reset operations source contract", () => {
  it("accepts the exact provider-free reset and preserves independent jobs", () => {
    const result = evaluate();

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks.map(({ id }: { id: string }) => id)).toEqual([
      "ops-index-reset-config",
      "ops-index-reset-response-helper",
      "ops-public-explore-routes-static",
      "ops-health-index-reset",
      "ops-retired-indexing-operations-static",
      "ops-cron-exact-set",
      "ops-protocol-revenue-binding",
      "ops-custom-v2-reconciler-binding",
      "ops-reset-smoke-binding",
      "ops-retired-provider-release-paths-absent",
      "ops-provider-environment-cannot-reactivate",
      "ops-package-verify-binding",
      "ops-exact-candidate-and-verify-binding",
      "ops-sensitive-metadata-binding",
      "ops-production-post-promotion-binding",
      "ops-manual-promotion-and-rollback-binding",
      "ops-retired-candidate-cutover",
      "ops-prepare-routes-no-broadcast-authority",
    ]);
  });

  it("rejects provider or fallback authority in the reset manifest", () => {
    const path = "config/read-model-operations.v1.json";
    const manifest = JSON.parse(source(path));
    manifest.providerPolicy.externalCallsExpected = 1;
    manifest.providerPolicy.fallbacks = true;
    manifest.providerPolicy.environmentActivation = true;

    const result = evaluate({ [path]: JSON.stringify(manifest) });

    expect(failureIds(result)).toEqual(expect.arrayContaining([
      "ops-index-reset-config",
      "ops-provider-environment-cannot-reactivate",
    ]));
  });

  it("rejects any network capability restored to a public Explore route", () => {
    const path = "app/api/explore/route.ts";
    const result = evaluate({
      [path]: `${source(path)}\nvoid fetch("https://example.invalid");\n`,
    });

    expect(failureIds(result)).toContain("ops-public-explore-routes-static");
  });

  it("rejects reset response or provenance-header drift", () => {
    const path = "lib/server/explore-index-reset.ts";
    const changed = source(path)
      .replace('"Retry-After": "3600"', '"Retry-After": "5"')
      .replace(
        '"X-Programmable-Indexing-Status": "reset"',
        '"X-Programmable-Read-Source": "legacy"',
      );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-index-reset-response-helper",
    );
  });

  it("rejects runtime capability restored to any retired worker", () => {
    const path = "app/api/ops/index-v2/route.ts";
    const changed = source(path).replace(
      'import { NextResponse } from "next/server";',
      'import { NextResponse } from "next/server";\nvoid process.env.GMGN_API_KEY;',
    );
    const failures = failureIds(evaluate({ [path]: changed }));

    expect(failures).toContain("ops-retired-indexing-operations-static");
    expect(failures).toContain("ops-provider-environment-cannot-reactivate");
  });

  it("rejects a provider-bearing health response", () => {
    const path = "app/api/ops/health/route.ts";
    const changed = source(path).replace(
      "providers: []",
      'providers: [{ name: "gmgn" }]',
    );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-health-index-reset",
    );
  });

  it("rejects restoration of an Explore index cron", () => {
    const path = "vercel.json";
    const vercel = JSON.parse(source(path));
    vercel.crons.push({ path: "/api/ops/projector", schedule: "* * * * *" });

    expect(failureIds(evaluate({ [path]: JSON.stringify(vercel) }))).toContain(
      "ops-cron-exact-set",
    );
  });

  it("keeps the unrelated protocol-revenue job source-bound", () => {
    const path = "app/api/ops/protocol-revenue/route.ts";
    const changed = source(path).replace("timingSafeEqual(provided, expected)", "true");

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-protocol-revenue-binding",
    );
  });

  it("keeps the unrelated Custom Launch projector source-bound", () => {
    const path = "app/api/ops/custom-launch/generic-v2-projector/route.ts";
    const changed = source(path).replace("timingSafeEqual(expected, actual)", "true");

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-custom-v2-reconciler-binding",
    );
  });

  it("requires the exact staged reset smoke without a soft-fail condition", () => {
    const path = ".github/workflows/deploy-production.yml";
    const changed = source(path).replace(
      "node scripts/smoke-explore-index-reset-public-apis.mjs",
      "echo skipped",
    );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-reset-smoke-binding",
    );
  });

  it("rejects restoration of the old provider release smoke", () => {
    const path = ".github/workflows/deploy-production.yml";
    const changed = `${source(path)}\n# scripts/smoke-static-dexscreener-public-apis.mjs\n`;

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-retired-provider-release-paths-absent",
    );
  });

  it("requires every verification lane to consume the reset smoke test", () => {
    const path = "package.json";
    const changed = source(path).replaceAll(
      "scripts/test/smoke-explore-index-reset-public-apis.test.mjs",
      "scripts/test/read-bounded-response.test.mjs",
    );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-package-verify-binding",
    );
  });

  it("requires Custom V2 to execute the shared smoke-test command", () => {
    const path = "package.json";
    const manifest = JSON.parse(source(path));
    manifest.scripts["verify:custom-v2:ci"] = manifest.scripts["verify:custom-v2:ci"]
      .replace("npm run verify:custom-v2:checks:ci", "npm run typecheck");

    expect(failureIds(evaluate({ [path]: JSON.stringify(manifest) }))).toContain(
      "ops-package-verify-binding",
    );
  });

  it("requires the shared Custom V2 command to retain the reset smoke test", () => {
    const path = "package.json";
    const manifest = JSON.parse(source(path));
    manifest.scripts["verify:custom-v2:checks:ci"] = manifest.scripts["verify:custom-v2:checks:ci"]
      .replace("scripts/test/smoke-explore-index-reset-public-apis.test.mjs", "");

    expect(failureIds(evaluate({ [path]: JSON.stringify(manifest) }))).toContain(
      "ops-package-verify-binding",
    );
  });

  it("preserves exact-SHA Verify proof and stage-only deployment", () => {
    const path = ".github/workflows/deploy-production.yml";
    const changed = `${source(path)}\n# vercel promote\n`;

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-exact-candidate-and-verify-binding",
    );
  });

  it("preserves value-free Vercel metadata binding", () => {
    const path = "scripts/bind-vercel-sensitive-production-metadata.mjs";
    const changed = source(path).replaceAll(
      "containsForbiddenValueField",
      "removedForbiddenValueCheck",
    );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-sensitive-metadata-binding",
    );
  });

  it("requires post-promotion verification of the same reset surface", () => {
    const path = "scripts/perf/read-model-post-promotion.mjs";
    const changed = source(path).replace(
      'id: "production-explore-index-reset-public-apis"',
      'id: "production-legacy-provider-surface"',
    );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-production-post-promotion-binding",
    );
  });

  it("preserves the owner-only promotion and rollback sequence", () => {
    const path = "docs/operations/read-model-scheduler-cutover.md";
    const changed = source(path).replace(
      'vercel rollback "$PREVIOUS_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"',
      "echo rollback-skipped",
    );

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-manual-promotion-and-rollback-binding",
    );
  });

  it("keeps the historical candidate cutover non-executable", () => {
    const path = "scripts/data-pipeline/cutover-runtime.mjs";
    const changed = `${source(path)}\nvoid process.env.PROGRAMMABLE_PROJECTOR_ACTIVE;\n`;

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-retired-candidate-cutover",
    );
  });

  it("does not grant broadcast authority to excluded action routes", () => {
    const path = "app/api/trade/prepare/route.ts";
    const changed = `${source(path)}\nvoid sendTransaction;\n`;

    expect(failureIds(evaluate({ [path]: changed }))).toContain(
      "ops-prepare-routes-no-broadcast-authority",
    );
  });
});
