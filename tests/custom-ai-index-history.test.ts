import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bindings from "../lib/custom-ai/deployments.json";
import type { CustomAIPublicToken } from "../lib/custom-ai/public-types";

vi.mock("server-only", () => ({}));
const store = vi.hoisted(() => ({ readObject: vi.fn(), listObjects: vi.fn() }));
vi.mock("../lib/custom-ai/store.server", () => ({ productionAIStore: () => store }));
import { readCustomAICatalog, readCustomAIToken } from "../lib/custom-ai/index.server";
import { CUSTOM_AI_PUBLISHED_INDEX_SOURCES, publishedCustomAIIndexSources } from "../lib/custom-ai/deployment.server";

const original = structuredClone(bindings.networks);
const address = `0x${"11".repeat(20)}` as const;
const factoryB = `0x${"22".repeat(20)}` as const;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = (overrides: Partial<CustomAIPublicToken> = {}) => ({
  chainId: 4663, factory: original[4663].factory.address, coreBundleHash: original[4663].bundleHash,
  tokenAddress: address, ...overrides,
}) as CustomAIPublicToken;

beforeEach(() => {
  vi.clearAllMocks();
  store.listObjects.mockResolvedValue([token()]);
  store.readObject.mockImplementation(async (_owner, kind) => kind === "token" ? { value: token(), revision: 1 }
    : { value: { status: "current", updatedAt: new Date().toISOString() }, revision: 1 });
});
afterEach(() => Object.assign(bindings.networks, structuredClone(original)));

describe("Custom AI authenticated indexing history", () => {
  it("pins only known published generations to the immutable funded acceptance", () => {
    const raw = readFileSync(new URL("../docs/operations/custom-ai/funded-acceptance-20261022.json", import.meta.url));
    const proof = JSON.parse(raw.toString());
    expect(Object.isFrozen(CUSTOM_AI_PUBLISHED_INDEX_SOURCES)).toBe(true);
    for (const source of CUSTOM_AI_PUBLISHED_INDEX_SOURCES) {
      expect(source.acceptanceEvidenceHash).toBe(hash(raw.toString()));
      expect(source.factory.toLowerCase()).toBe(proof.chains[source.chainId].token.factory.toLowerCase());
      expect(source.bundleHash).toBe(proof.bundleHash);
      expect(source.deploymentBlock).toBe(original[source.chainId].deploymentBlock);
      expect(Object.isFrozen(source)).toBe(true);
    }
  });

  it.each(["factory", "bundle"])("retains generation A after activating B with a new %s and reads independent checkpoints", async changed => {
    bindings.networks[4663] = { ...original[4663],
      factory: { ...original[4663].factory, address: changed === "factory" ? factoryB : original[4663].factory.address },
      bundleHash: changed === "bundle" ? "f".repeat(64) : original[4663].bundleHash };
    const second = token({ factory: bindings.networks[4663].factory.address as `0x${string}`,
      coreBundleHash: bindings.networks[4663].bundleHash, tokenAddress: `0x${"33".repeat(20)}` });
    store.listObjects.mockResolvedValue([token(), second]);
    expect((await readCustomAICatalog()).items).toEqual([token(), second]);
    expect(await readCustomAIToken(4663, address)).toEqual(token());
    for (const source of [original[4663], bindings.networks[4663]]) {
      expect(store.readObject).toHaveBeenCalledWith("public", "index", hash(`4663:${source.factory.address}:${source.bundleHash}`));
    }
    expect(publishedCustomAIIndexSources(4663)).toHaveLength(2);
  });

  it("keeps incomplete historical checkpoints visible as syncing", async () => {
    bindings.networks[4663] = { ...original[4663], factory: { ...original[4663].factory, address: factoryB } };
    const oldCursor = hash(`4663:${original[4663].factory.address}:${original[4663].bundleHash}`);
    store.readObject.mockImplementation(async (_owner, _kind, id) => id === oldCursor ? null
      : { value: { status: "current", updatedAt: new Date().toISOString() }, revision: 1 });
    expect(await readCustomAICatalog()).toMatchObject({ status: "syncing", items: [token()] });
  });

  it.each([
    { factory: factoryB },
    { coreBundleHash: "f".repeat(64) },
    { chainId: 1 as const },
  ])("rejects unknown or mismatched source bindings: %j", async overrides => {
    store.listObjects.mockResolvedValue([token(overrides)]);
    store.readObject.mockResolvedValue({ value: token(overrides), revision: 1 });
    expect((await readCustomAICatalog()).items).toEqual([]);
    expect(await readCustomAIToken(4663, address)).toBeNull();
  });

  it("rejects a saved direct lookup with a different canonical token identity", async () => {
    store.readObject.mockResolvedValue({ value: token({ tokenAddress: factoryB }), revision: 1 });
    expect(await readCustomAIToken(4663, address)).toBeNull();
  });

  it("keeps unpublished staged generations out of discovery and requires explicit staged lookup", async () => {
    bindings.networks[4663] = { ...original[4663], status: "staged", factory: { ...original[4663].factory, address: factoryB } };
    const staged = token({ factory: factoryB });
    store.listObjects.mockResolvedValue([staged]);
    store.readObject.mockResolvedValue({ value: staged, revision: 1 });
    expect((await readCustomAICatalog()).items).toEqual([]);
    expect(await readCustomAIToken(4663, address)).toBeNull();
    expect(await readCustomAIToken(4663, address, true)).toEqual(staged);
  });
});
