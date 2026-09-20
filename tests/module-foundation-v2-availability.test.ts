import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";
import { fetchFoundationAvailability, parseFoundationAvailability, FOUNDATION_AVAILABILITY_SCHEMA, FOUNDATION_AVAILABILITY_SCHEMA_V2, FOUNDATION_AVAILABILITY_SCHEMA_V3 } from "@/lib/module-foundation/availability";
import { FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";
import { FOUNDATION_CATALOG_SCHEMA_V1 } from "@/lib/module-foundation/catalog";

const hash = `0x${"1".repeat(64)}`;
const token = getAddress("0x1234567890abcdef1234567890abcdef12345678");
function envelope() {
  return { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V2, available: true,
    binding: { releaseDigest: hash, sourceCommit: "a".repeat(40), startBlock: "1", factoryVersion: "v2", lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID,
      factory: { address: "0x1000000000000000000000000000000000000000", runtimeCodeHash: hash },
      hookDeployer: { address: "0x2000000000000000000000000000000000000000", runtimeCodeHash: hash } },
    evidence: { checkedAt: new Date().toISOString(), sourcePath: `/v1/modules/foundation/source/release/${hash}`,
      artifactDigest: hash, decisionDigest: hash, sourceManifestHash: hash, deploymentEvidenceDigest: hash,
      runtimeVerificationDigest: hash, finalityEvidenceDigest: hash, blockHash: hash },
    catalog: { document: { schemaVersion: FOUNDATION_CATALOG_SCHEMA_V1, entries: [] }, authority: { admissions: [], releases: [] } },
  };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("V2 same-origin authority transport boundary", () => {
  it("binds the V2 response schema, exact custody and release-specific source path", () => {
    const source = envelope(), parsed = parseFoundationAvailability(source);
    expect(parsed.binding?.factoryVersion).toBe("v2");
    expect(parsed.binding?.lpCustodyId).toBe(FOUNDATION_LP_CUSTODY_DEAD_ID);
    source.evidence.sourcePath = "/v1/modules/foundation/source";
    expect(() => parseFoundationAvailability(source)).toThrow("evidence");
  });
  it("does not accept a V2 binding inside a V1 schema or infer V2 from a missing discriminator", () => {
    const source = envelope();
    expect(() => parseFoundationAvailability({ ...source, schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA })).toThrow();
    expect(() => parseFoundationAvailability({ ...source, binding: { ...source.binding, factoryVersion: undefined } })).toThrow("version");
    expect(() => parseFoundationAvailability({ ...source, binding: { ...source.binding, lpCustodyId: `0x${"2".repeat(64)}` } })).toThrow("custody");
  });
  it("requires an exact V3 schema and source binding for directional-fee launches", () => {
    const source = envelope();
    const binding = { ...source.binding, factoryVersion: "v3" };
    expect(parseFoundationAvailability({ ...source, schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V3, binding }).binding?.factoryVersion).toBe("v3");
    expect(() => parseFoundationAvailability({ ...source, binding })).toThrow("version");
    expect(() => parseFoundationAvailability({ ...source, schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V3 })).toThrow("version");
  });
  it("preserves the original structurally validated V1 source response", () => {
    const source = envelope();
    const binding = { releaseDigest: source.binding.releaseDigest, sourceCommit: source.binding.sourceCommit, startBlock: source.binding.startBlock,
      factory: source.binding.factory, hookDeployer: source.binding.hookDeployer };
    const parsed = parseFoundationAvailability({ ...source, schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA, binding,
      evidence: { ...source.evidence, sourcePath: "/v1/modules/foundation/source" } });
    expect(parsed.available).toBe(true); expect(parsed.binding?.factoryVersion).toBeUndefined();
  });
  it("uses exactly the selected token endpoint and binds the normalized response token", async () => {
    const request = vi.fn(async () => Response.json({ ...envelope(), token: token.toLowerCase() })); vi.stubGlobal("fetch", request);
    const result = await fetchFoundationAvailability(undefined, token);
    expect(result.token).toBe(token.toLowerCase());
    expect(request).toHaveBeenCalledWith(`/api/module-foundation?token=${token}`, expect.objectContaining({ credentials: "same-origin", redirect: "error", cache: "no-store" }));
    request.mockResolvedValue(Response.json({ ...envelope(), token: "0x1000000000000000000000000000000000000000" }));
    await expect(fetchFoundationAvailability(undefined, token)).rejects.toThrow("different token");
  });
  it("requires token identity for token-specific success and forbids token output on the default request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(envelope())));
    await expect(fetchFoundationAvailability(undefined, token)).rejects.toThrow("different token");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...envelope(), token: token.toLowerCase() })));
    await expect(fetchFoundationAvailability()).rejects.toThrow("different token");
  });
  it.each(["0x0000000000000000000000000000000000000000", `${token}?token=other`, `${token}/extra`, token.toUpperCase()])(
    "rejects invalid or aliased token input before fetching: %s", async address => {
      const request = vi.fn(); vi.stubGlobal("fetch", request);
      await expect(fetchFoundationAvailability(undefined, address as Address)).rejects.toThrow("address");
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("keeps token-specific unavailable state without requesting a default release", async () => {
    const request = vi.fn(async () => Response.json({ schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V2, available: false, token: token.toLowerCase() }, { status: 503 }));
    vi.stubGlobal("fetch", request);
    const result = await fetchFoundationAvailability(undefined, token);
    expect(result).toMatchObject({ available: false, binding: null, token: token.toLowerCase(), schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V2 });
    expect(request).toHaveBeenCalledOnce();
  });
});
