import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { foundationChainProfile } from "../lib/module-foundation/chains";
import { inspectCustomAIQuote } from "../lib/custom-ai/quote.server";
import { customAIChain } from "../lib/custom-ai/chain.server";
import { matchesRuntime } from "../lib/custom-ai/runtime";

describe("Custom AI runtime binding", () => {
  it("permits only declared immutable bytes and rejects truncated or out-of-bounds runtime slots", () => {
    const template = `0x60${"00".repeat(32)}61` as const;
    const actual = `0x60${"11".repeat(32)}61` as const;
    const a = { runtimeTemplate: template, immutableReferences: { "1": [{ start: 1, length: 32 }] } };
    expect(matchesRuntime(actual, a)).toBe(true);
    expect(matchesRuntime(`0x62${"11".repeat(32)}61`, a)).toBe(false);
    expect(matchesRuntime("0x60", a)).toBe(false);
    expect(matchesRuntime(actual, { ...a, immutableReferences: { "1": [{ start: 4, length: 32 }] } })).toBe(false);
  });
});

// Explicit read-only integration probe; never part of the default unit run.
it.skipIf(process.env.CUSTOM_AI_LIVE_READS !== "true")("records the real quote-transfer and control checks", async () => {
  const config = process.env.CUSTOM_AI_RPC_CONFIG_FILE;
  const output = process.env.CUSTOM_AI_EVIDENCE_DIR;
  if (!config || !output) throw Error("Provide the private RPC config and evidence directory.");
  Object.assign(process.env, JSON.parse(readFileSync(config, "utf8")));
  const results = [];
  for (const chainId of [1, 4663] as const) {
    const quote = foundationChainProfile(chainId).wrappedEth.address;
    try { results.push(await inspectCustomAIQuote(chainId, quote, await customAIChain(chainId))); }
    catch (error) { results.push({ chainId, status: "unresolved", message: "Independent network reads did not complete.",
      diagnostic: error instanceof Error ? error.name + ": " + error.message.replace(/https?:\/\/\S+/g, "[endpoint]") : "UnknownError" }); }
  }
  writeFileSync(join(output, "live-quotes.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  expect(results).toHaveLength(2);
}, 60_000);
