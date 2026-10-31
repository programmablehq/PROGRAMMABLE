import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../scripts/custom-ai/artifact-hash.mjs", () => ({ artifactHash: () => "artifact" }));
vi.mock("../lib/custom-ai/launch.server", () => ({ checkedDeployment: vi.fn(async () => ({})), launchPrice: vi.fn(async () => ({ checked: { expiresAt: Date.now()/1000+60, quote: { decimals: 18, initialBuyRaw: "1000" } } })) }));
vi.mock("../lib/custom-ai/quote.server", () => ({ inspectCustomAIQuote: vi.fn(async () => ({ status: "compatible", decimals: 18 })) }));
vi.mock("../lib/custom-ai/transaction.server", () => ({ makeStep: vi.fn(async () => ({ transaction: { gas: "0x5208" } })) }));
const wallet = "0x1000000000000000000000000000000000000001" as const;
vi.mock("../lib/custom-ai/chain.server", () => ({ customAIChain: vi.fn(async () => ({
  profile: { wrappedEth: { address: "0x2000000000000000000000000000000000000002" } }, reference: "latest",
  finish: async () => undefined, call: async () => 1000000n, agreed: async (method: string) => method === "eth_getBalance" ? "1000000" : "1",
})) }));
import { prepareLaunch, assertReadyTicket, type LaunchInputs } from "../lib/custom-ai/launch-preparation.server";
import { CUSTOM_AI_BUNDLE_HASH } from "../lib/custom-ai/launch-plan";
import { designReadiness } from "../lib/custom-ai/readiness";
import type { AIStore } from "../lib/custom-ai/store.server";
const sourceHash = createHash("sha256").update("source").digest("hex");
const input: LaunchInputs = { draftId: "draft-fixture-0001", imageId: "image-fixture-0001", account: wallet,
  settings: { name: "Example", symbol: "EX", chainId: 1, quote: "0x2000000000000000000000000000000000000002", initialBuy: "0.01", imageURI: "https://example.com/image.webp" } };
let values: Map<string, unknown>; let store: AIStore;
beforeEach(() => {
  values = new Map();
  store = { read: async () => ({ state: "completed", result: { draft: { source: "source", sourceHash, artifact: { initCode: "0x1234" }, validation: { status: "passed", artifactHash: "artifact" },
    verification: { status: "passed", sourceHash }, lifecycle: { status: "passed", bundleHash: CUSTOM_AI_BUNDLE_HASH } } } }),
    readObject: async (owner: string, kind: string, id: string) => kind === "image" ? { value: { url: input.settings.imageURI } } : values.has(`${owner}:${id}`) ? { value: values.get(`${owner}:${id}`), revision: 1 } : null,
    saveObject: async (owner: string, _kind: string, id: string, value: unknown) => { values.set(`${owner}:${id}`, value); return 1; },
  } as unknown as AIStore;
});
afterEach(() => vi.restoreAllMocks());
describe("one version-bound launch preparation", () => {
  it("requests only missing coin details and keeps their focus order", () => {
    const base = { sourceHash, checked: true, name: "Rain", symbol: "RAIN", image: true, connected: false };
    expect(designReadiness({ ...base, image: false })).toMatchObject({ message: "Add your coin’s image.", missingFields: ["image"] });
    expect(designReadiness({ ...base, name: "  " })).toMatchObject({ message: "Add your coin’s name.", missingFields: ["name"] });
    expect(designReadiness({ ...base, symbol: "" })).toMatchObject({ message: "Add your coin’s ticker.", missingFields: ["symbol"] });
    expect(designReadiness({ ...base, name: "", symbol: "", image: false })).toMatchObject({ missingFields: ["name", "symbol", "image"] });
    expect(designReadiness({ ...base, pendingChange: "change fees", image: false })).not.toHaveProperty("missingFields");
  });
  it("keeps a pending edit and disconnected design distinct from launch readiness", () => {
    const base = { sourceHash, checked: true, name: "EX", symbol: "EX", image: true, connected: false };
    expect(designReadiness(base).state).toBe("design-ready");
    expect(designReadiness({ ...base, pendingChange: "change fee" }).state).toBe("blocked");
  });
  it("rejects another owner, modified settings and an expired ticket", async () => {
    const ready = await prepareLaunch(store, "alice", input);
    expect(ready.state).toBe("ready");
    await expect(assertReadyTicket(store, "alice", ready.ticket!, input, sourceHash)).resolves.toBeDefined();
    await expect(assertReadyTicket(store, "bob", ready.ticket!, input, sourceHash)).rejects.toThrow();
    await expect(assertReadyTicket(store, "alice", ready.ticket!, { ...input, settings: { ...input.settings, initialBuy: "0.02" } }, sourceHash)).rejects.toThrow();
    const ticket = values.get(`alice:${ready.ticket}`) as { expiresAt: number }; ticket.expiresAt = Date.now()-1;
    await expect(assertReadyTicket(store, "alice", ready.ticket!, input, sourceHash)).rejects.toThrow();
  });
});
