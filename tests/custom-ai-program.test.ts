import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import programCode from "../lib/custom-ai/program-code.json";
import feedCode from "../lib/custom-ai/feed-code.json";
import { decodeAbiParameters, parseAbiParameters, type Address, type Hex } from "viem";
vi.mock("server-only", () => ({}));
import { parseProgram, bindProgramSource, type ProgramSpec } from "../lib/custom-ai/program";
import { checkProgram, programInitCode, programArtifact } from "../lib/custom-ai/program.server";
import { normalizeObservation } from "../lib/custom-ai/feed-update.server";
import manifest from "../lib/custom-ai/program-manifest.json";
import type { Draft } from "../lib/custom-ai/types";

const staking: ProgramSpec = { kind: "staking", rewardShareBps: 5000, intervalSeconds: 3600, recipient: "", maximumBatch: "0", minimumTokensPerQuote: "0" };
const address = `0x${"12".repeat(20)}` as Address;
function draft(spec = staking): Draft {
  const program = { spec, chainId: 1 as const, quote: address, bundleHash: manifest.bundleHash, available: false };
  return { source: bindProgramSource("contract Test {}", { spec, chainId: 1, quote: address }, manifest.bundleHash), sourceHash: "test",
    compiled: true, diagnostics: [], program };
}
describe("fixed funded programs", () => {
  it("exports source-bound program and feed bytecode", () => {
    for (const [source, hashes] of [["src/custom-ai/CustomAIProgramV1.sol", programCode.sourceHashes], ["src/custom-ai/CustomAIDataFeedV1.sol", feedCode.sourceHashes]] as const) {
      const actual = createHash("sha256").update(readFileSync(new URL(`../contracts/${source}`, import.meta.url))).digest("hex");
      expect(actual).toBe((hashes as Record<string, string>)[source]);
    }
  });
  it("rejects missing splits, ambiguous recipients, and unbounded buybacks", () => {
    expect(parseProgram(staking)).toEqual(staking);
    expect(() => parseProgram({ ...staking, rewardShareBps: 10001 })).toThrow();
    expect(() => parseProgram({ ...staking, kind: "distribution" })).toThrow();
    expect(() => parseProgram({ ...staking, kind: "buyback", recipient: "creator" })).toThrow();
    expect(() => parseProgram({ ...staking, intervalSeconds: 0 })).toThrow();
  });
  it("binds the program and pair to the exact source review", () => {
    const value = draft(); expect(() => checkProgram(value)).not.toThrow();
    value.program!.spec = { ...staking, rewardShareBps: 10000 };
    expect(() => checkProgram(value)).toThrow("Recheck");
    expect(bindProgramSource(value.source, undefined, manifest.bundleHash)).not.toContain("@programmable-program");
  });
  it("encodes the creator, salt, selected quote and immutable program settings", () => {
    const launchSalt = `0x${"34".repeat(32)}` as Hex;
    const init = programInitCode(draft(), { factory: address, account: address, launchSalt, quote: address, quoteDecimals: 18 });
    const tail = `0x${init.slice(programArtifact.initCode.length)}` as Hex;
    const [config] = decodeAbiParameters(parseAbiParameters("(address factory,address creator,bytes32 launchSalt,address quote,uint8 quoteDecimals,uint8 mode,address recipient,uint64 interval,uint128 maximumBatch,uint256 minimumTokensPerQuote)"), tail);
    expect(config.creator.toLowerCase()).toBe(address); expect(config.launchSalt).toBe(launchSalt);
    expect(config.mode).toBe(1); expect(config.interval).toBe(3600n); expect(config.maximumBatch).toBe(0n);
  });
  it("never rounds a buyback amount up when the quote token has fewer decimals", () => {
    const value = draft({ ...staking, kind: "buyback", recipient: "creator", maximumBatch: "0.0000001", minimumTokensPerQuote: "100" });
    expect(() => programInitCode(value, { factory: address, account: address, launchSalt: `0x${"00".repeat(32)}`, quote: address, quoteDecimals: 6 })).toThrow("decimals");
  });
});

describe("source observation normalization", () => {
  const adapter = { url: "https://example.com/feed", valuePath: ["temperature"], timestampPath: ["observed"], decimals: 2 };
  const now = 1800000000;
  it("converts an exact decimal observation with its actual source time", () => {
    expect(normalizeObservation({ temperature: "-12.34", observed: now - 5 }, adapter, now, 60, "-5000", "5000"))
      .toEqual({ value: -1234n, observedAt: BigInt(now - 5), validUntil: BigInt(now + 55) });
  });
  it("rejects stale, future, missing, out of range and rounded observations", () => {
    for (const payload of [{ temperature: "1.001", observed: now }, { temperature: "51", observed: now },
      { temperature: "1", observed: now + 1 }, { temperature: "1", observed: now - 61 }, { observed: now }]) {
      expect(() => normalizeObservation(payload, adapter, now, 60, "-5000", "5000")).toThrow();
    }
  });
  it("maps only explicitly configured event outcomes", () => {
    const event = { ...adapter, decimals: 0, values: { won: "1", lost: "0" } };
    expect(normalizeObservation({ temperature: "won", observed: now }, event, now, 60, "0", "1").value).toBe(1n);
    expect(() => normalizeObservation({ temperature: "pending", observed: now }, event, now, 60, "0", "1")).toThrow();
  });
});
