import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";
import { encodeDeployData, keccak256, type Abi } from "viem";
vi.mock("server-only", () => ({}));
import template from "../lib/custom-ai/feed-code.json";
import { compileLaunchDraft } from "../lib/custom-ai/lifecycle.server";
import { compileDraft } from "../lib/custom-ai/compiler.server";
import { eventModuleSource } from "../scripts/custom-ai/event-module.mjs";
import { parseRulePlan } from "../lib/custom-ai/rules";
import type { FeedBinding } from "../lib/custom-ai/feed";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("bound event rules", () => {
  let feed: FeedBinding;
  const checks = [19,20,21].flatMap(value => [true,false].map(buy => ({ afterSeconds: 0, buy, feedValue: String(value), feedFresh: true,
    totalFeeBps: value < 20 ? (buy ? 100 : 200) : (buy ? 300 : 400) }))).concat([true,false].map(buy => ({ afterSeconds: 0, buy, feedValue: "20", feedFresh: false, totalFeeBps: 50 })));
  beforeAll(async () => {
    const requireTool = createRequire(join(process.env.CUSTOM_AI_COMPILER_DIR!, "package.json"));
    const { createVM } = requireTool("@ethereumjs/vm");
    const { createCustomCommon, Mainnet, Hardfork } = requireTool("@ethereumjs/common");
    const { createAddressFromString, hexToBytes, bytesToHex } = requireTool("@ethereumjs/util");
    const vm = await createVM({ common: createCustomCommon({ chainId: 1 }, Mainnet, { hardfork: Hardfork.Cancun }) });
    const deployed = await vm.evm.runCall({ caller: createAddressFromString("0x9000000000000000000000000000000000000009"), gasLimit: 5_000_000n,
      data: hexToBytes(encodeDeployData({ abi: template.abi as Abi, bytecode: template.initCode as `0x${string}`,
        args: [`0x${"ab".repeat(32)}`, "0x1000000000000000000000000000000000000001", -1000n, 1000n, 60n] })) });
    expect(deployed.execResult.exceptionError).toBeUndefined();
    const runtimeCode = bytesToHex(await vm.stateManager.getCode(deployed.createdAddress)) as `0x${string}`;
    feed = { rule: { id: "weather-fixture", threshold: "20", belowBuyBps: 100, belowSellBps: 200, aboveBuyBps: 300, aboveSellBps: 400 },
      chainId: 1, address: deployed.createdAddress.toString(), runtimeCode, runtimeHash: keccak256(runtimeCode), maxAge: 60, minimum: "-1000", maximum: "1000", title: "Synthetic temperature", sourceUrl: "https://example.com/weather", unit: "C" };
  });
  it("checks both threshold sides and stale fallback through the actual feed runtime and full core lifecycle", async () => {
    const result = await compileLaunchDraft(eventModuleSource(feed), undefined, checks, feed);
    expect(result.diagnostics).toEqual([]);
    expect(result.validation?.status).toBe("passed");
    expect(result.validation?.expectationCases).toBe(32);
    expect(result.lifecycle?.status).toBe("passed");
  }, 90_000);
  it("rejects changed source instead of allowing arbitrary external calls", async () => {
    const result = await compileDraft(eventModuleSource(feed).replace("fee = value < threshold", "fee = value <= threshold"), undefined, checks, feed);
    expect(result.validation?.status).toBe("blocked");
    expect(result.artifact).toBeUndefined();
  }, 30_000);
  it("does not accept a different interpretation of an event threshold", async () => {
    const result = await compileDraft(eventModuleSource(feed), undefined, [{ ...checks[2], totalFeeBps: 100 }], feed);
    expect(result.validation?.status).toBe("blocked");
    expect(result.diagnostics.join(" ")).toContain("Requested rule mismatch");
  }, 30_000);
  it("requires explicit fresh and stale scenarios from the independent interpreter", () => {
    const plan = { reply: "A temperature rule.", action: "build", memory: "Temperature", requirements: ["At 20 C use the higher rates."], unresolved: [], lookups: [], feeChecks: checks, eventRule: feed.rule };
    expect(parseRulePlan(plan).eventRule).toEqual(feed.rule);
    expect(() => parseRulePlan({ ...plan, feeChecks: checks.filter(check => check.feedFresh) })).toThrow("stale-data");
  });
});
