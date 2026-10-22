import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { applyCoinSetupPatch, coinBio, EMPTY_COIN_SETUP, parseCoinSetupPatch, setupQuoteAddress } from "../lib/custom-ai/coin-setup";
import { parseChatRequest, type ChatRequest, type Draft } from "../lib/custom-ai/types";
import { runCustomAI } from "../lib/custom-ai/service.server";

const address = "0x1111111111111111111111111111111111111111";
const request: ChatRequest = { id: "coin-setup-test-0001", intent: "chat", coin: EMPTY_COIN_SETUP,
  messages: [{ role: "user", content: "Call it Example, ticker EXM, on Robinhood with an ETH pair." }] };
const response = (value: object) => ({ text: JSON.stringify(value), inputTokens: 20, outputTokens: 20 });

describe("Chat-driven coin details", () => {
  it("applies only the named fields and retains the rest", () => {
    expect(applyCoinSetupPatch(EMPTY_COIN_SETUP, { name: "Example", symbol: "EXM" })).toEqual({ ...EMPTY_COIN_SETUP, name: "Example", symbol: "EXM" });
  });
  it("drops an old custom pair and amount when the network changes", () => {
    const previous = { ...EMPTY_COIN_SETUP, pairToken: address, initialBuy: "300" };
    expect(applyCoinSetupPatch(previous, { chainId: 4663 })).toEqual({ ...EMPTY_COIN_SETUP, chainId: 4663 });
    expect(applyCoinSetupPatch(previous, { chainId: 4663, pairToken: address, initialBuy: "20" })).toEqual({ ...previous, chainId: 4663, initialBuy: "20" });
  });
  it("resolves ETH separately for each chain and clears incompatible amount units", () => {
    expect(setupQuoteAddress(EMPTY_COIN_SETUP)).not.toBe(setupQuoteAddress({ ...EMPTY_COIN_SETUP, chainId: 4663 }));
    expect(applyCoinSetupPatch(EMPTY_COIN_SETUP, { pairToken: address }).initialBuy).toBe("");
    expect(parseCoinSetupPatch({ pairToken: "WETH" })).toEqual({ pairToken: "ETH" });
  });
  it("rejects unsupported chains, malformed addresses and non-decimal amounts", () => {
    for (const patch of [{ chainId: 8453 }, { pairToken: "USDC" }, { pairToken: "0x0" }, { initialBuy: "1e5" }, { name: "x".repeat(49) }]) {
      expect(() => parseCoinSetupPatch(patch)).toThrow();
    }
    expect(parseCoinSetupPatch({ name: null, initialBuy: "0.009" })).toEqual({ initialBuy: "0.009" });
  });
  it("includes bounded current form values in chat without allowing an injected context", () => {
    expect(parseChatRequest(request).coin).toEqual(EMPTY_COIN_SETUP);
    expect(() => parseChatRequest({ ...request, coin: { chainId: 8453 } })).toThrow();
  });
  it("changes settings without compiling a new hook", async () => {
    const compile = vi.fn();
    const call = vi.fn(async () => response({ reply: "Example is set to Robinhood with ETH.", source: "", hookSummary: "",
      setupPatch: { name: "Example", symbol: "EXM", chainId: 4663, pairToken: "ETH", initialBuy: null } }));
    const result = await runCustomAI(request, undefined, { call, compile });
    expect(result.setupPatch).toEqual({ name: "Example", symbol: "EXM", chainId: 4663, pairToken: "ETH" });
    expect(result.draft).toBeUndefined();
    expect(compile).not.toHaveBeenCalled();
    expect(call.mock.calls).toHaveLength(1);
  });
  it("rejects a model-invented payment address and accepts one actually supplied", async () => {
    const call = async () => response({ reply: "Pair selected.", source: "", setupPatch: { pairToken: address } });
    await expect(runCustomAI(request, undefined, { call, compile: vi.fn() })).rejects.toThrow("pair address");
    const result = await runCustomAI({ ...request, messages: [{ role: "user", content: `Use the pair token ${address}.` }] }, undefined, { call, compile: vi.fn() });
    expect(result.setupPatch?.pairToken).toBe(address);
  });
  it("binds the bio to the successful source and derives its name from the current form", async () => {
    const draft: Draft = { source: "example", sourceHash: "exact-source", compiled: true, diagnostics: [],
      validation: { version: "self-contained-fee-v1", status: "passed", artifactHash: "exact-artifact", cases: 1, samples: [], deployments: [] } };
    const result = await runCustomAI(request, undefined, {
      call: async () => response({ reply: "Done.", source: "example", hookSummary: "charges 3% on buys and sells for 24 hours, then 1%", setupPatch: {} }),
      compile: async () => draft,
    });
    expect(result.draft?.sourceHash).toBe("exact-source");
    expect(coinBio("Renamed", result.draft?.hookSummary)).toBe("Renamed is a coin with a hook that charges 3% on buys and sells for 24 hours, then 1%.");
  });
  it("never attaches a new claimed bio to a failed build", async () => {
    const result = await runCustomAI(request, undefined, {
      call: async () => response({ reply: "Done.", source: "invalid", hookSummary: "pays everyone", setupPatch: {} }),
      compile: async () => ({ source: "invalid", sourceHash: "failed", compiled: false, diagnostics: ["invalid"] }),
    });
    expect(result.draft?.hookSummary).toBeUndefined();
  });
  it("preserves the requested coin details across compiler repairs", async () => {
    const call = vi.fn().mockResolvedValueOnce(response({ reply: "Draft.", source: "first",
      setupPatch: { name: "Example", symbol: "EXM", chainId: 4663 } }))
      .mockResolvedValueOnce(response({ reply: "Done.", source: "repaired", hookSummary: "charges 1% on swaps", setupPatch: { name: null, initialBuy: "500" } }));
    const compile = vi.fn().mockResolvedValueOnce({ source: "first", sourceHash: "first", compiled: false, diagnostics: ["repair"] })
      .mockResolvedValueOnce({ source: "repaired", sourceHash: "repaired", compiled: true, diagnostics: [], validation: { status: "passed" } });
    const result = await runCustomAI(request, undefined, { call, compile });
    expect(result.setupPatch).toEqual({ name: "Example", symbol: "EXM", chainId: 4663 });
    expect(result.draft?.sourceHash).toBe("repaired");
  });
});
