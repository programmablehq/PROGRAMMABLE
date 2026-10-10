import { expect, it } from "vitest";
import { ETHEREUM_MODULE_BINDING as binding } from "@/lib/module-foundation/ethereum-release";
import { parseFoundationAvailability, FOUNDATION_AVAILABILITY_SCHEMA_V5, unavailableFoundation } from "@/lib/module-foundation/availability";
function envelope() { return JSON.parse(JSON.stringify({ schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V5, chainId: 1, available: true, binding,
  catalog: unavailableFoundation().catalog, evidence: { kind: "owner-source-runtime-v1", providerCount: 2, releaseDigest: binding.releaseDigest,
    checkedAt: new Date().toISOString(), blockHash: "0x" + "1".repeat(64) } }, (_, v) => typeof v === "bigint" ? v.toString() : v)); }
it("binds Ethereum graph availability to installed source without inventing an independent review", () => {
  const value = envelope(), parsed = parseFoundationAvailability(value);
  expect(parsed.binding?.ethereumGraph?.implementation).toEqual(binding.factory);
  expect(value.evidence.decisionDigest).toBeUndefined();
  for (const change of [{ chainId: 4663 }, { binding: { ...value.binding, factory: { ...value.binding.factory, address: "0x" + "1".repeat(40) } } },
    { evidence: { ...value.evidence, providerCount: 1 } }, { evidence: { ...value.evidence, checkedAt: "2020-01-01T00:00:00Z" } }]) {
    expect(() => parseFoundationAvailability({ ...value, ...change })).toThrow();
  }
});

it("keeps pending index reads non-authorizing and specific to an Ethereum token", () => {
  const pending = { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V5, chainId: 1, available: false, reason: "MODULE_INDEX_PENDING" };
  const parsed = parseFoundationAvailability({ ...pending, token: "0x1111111111111111111111111111111111111111" });
  expect(parsed.indexPending).toBe(true);
  expect(parsed.available).toBe(false);
  expect(parsed.binding).toBeNull();
  expect(parseFoundationAvailability(pending).indexPending).toBeUndefined();
});

it("reports a missing stamp without granting authority or polling for index recovery", () => {
  const missing = { schemaVersion: FOUNDATION_AVAILABILITY_SCHEMA_V5, chainId: 1,
    available: false, reason: "MODULE_STAMP_MISSING" };
  const parsed = parseFoundationAvailability({ ...missing, token: "0x1111111111111111111111111111111111111111" });
  expect(parsed).toMatchObject({ stampMissing: true, available: false, binding: null });
  expect(parsed.indexPending).toBeUndefined();
  expect(parsed.reason).toContain("no Programmable launch stamp");
  expect(parseFoundationAvailability(missing).stampMissing).toBeUndefined();
});
