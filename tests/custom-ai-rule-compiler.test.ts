import { beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, keccak256, stringToHex, type Abi, type Hex } from "viem";
vi.mock("server-only", () => ({}));
import template from "../lib/custom-ai/feed-v2-code.json";
import fixture from "./fixtures/custom-ai/london-liquidity-v2.json";
import { normalizeRuleSpec } from "../lib/custom-ai/rule-spec";
import { compileRuleSpec, type RuleFeedBinding } from "../lib/custom-ai/rule-compiler.server";
import { compileDraft } from "../lib/custom-ai/compiler.server";
import { composableModuleSource, seedComposableFeeds } from "../scripts/custom-ai/composable-module.mjs";
describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("composed rule EVM evidence", () => {
  let feed: RuleFeedBinding;
  beforeAll(async () => {
    const tool = createRequire(join(process.env.CUSTOM_AI_COMPILER_DIR!, "package.json"));
    const { createVM } = tool("@ethereumjs/vm");
    const { createCustomCommon, Mainnet, Hardfork } = tool("@ethereumjs/common");
    const { createAddressFromString, hexToBytes, bytesToHex } = tool("@ethereumjs/util");
    const vm = await createVM({ common: createCustomCommon({ chainId: 1 }, Mainnet, { hardfork: Hardfork.Cancun }) });
    const result = await vm.evm.runCall({ caller: createAddressFromString("0x9000000000000000000000000000000000000009"), gasLimit: 5000000n,
      data: hexToBytes(encodeDeployData({ abi: template.abi as Abi, bytecode: template.initCode as Hex,
        args: [`0x${"ab".repeat(32)}`, `0x${"cd".repeat(32)}`, "0x1000000000000000000000000000000000000001", 0n, 100000n, 1800n] })) });
    expect(result.execResult.exceptionError).toBeUndefined();
    const runtimeCode = bytesToHex(await vm.stateManager.getCode(result.createdAddress)) as Hex;
    feed = { id: "london-rain-v1", address: result.createdAddress.toString(), runtimeCode, runtimeHash: keccak256(runtimeCode),
      minimum: "0", maximum: "100000", maxAge: 1800, sourceVersion: "model-v1" };
  });
  it("runs the complete countdown and weather rules through the fixed core on both chains", async () => {
    const result = await compileRuleSpec(normalizeRuleSpec(fixture), 1, [feed]);
    expect(result.diagnostics).toEqual([]);
    expect(result.validation?.status).toBe("passed");
    expect(result.lifecycle?.status).toBe("passed");
    expect(BigInt(result.validation!.maxGas!)).toBeLessThan(100000n);
  }, 90000);
  it("bounds the cold-read gas of four active feeds", async () => {
    const feeds = [1,2,3,4].map(n => ({ ...feed, id: `source-${n}`, address: `0x2${String(n).padStart(39, "0")}` as Hex }));
    const spec = normalizeRuleSpec({ version: 2, requirements: [{ id: "fee", text: "Use all four feeds" }], creatorShareBps: 10000, actions: [],
      phases: [{ id: "always", startsAtSeconds: 0, endsAtSeconds: null, requirementIds: ["fee"], fee: { kind: "conditional",
        when: { kind: "all", conditions: feeds.map(f => ({ kind: "feed", feedId: f.id, operator: "gte", value: "1" })) },
        then: { kind: "fixed", buyBps: 500, sellBps: 500 }, otherwise: { kind: "fixed", buyBps: 100, sellBps: 100 } } }] });
    const result = await compileRuleSpec(spec, 1, feeds);
    expect(result.diagnostics).toEqual([]);
    expect(BigInt(result.validation!.maxGas!)).toBeLessThan(100000n);
  }, 90000);
  it("rejects modified source instead of authorizing an arbitrary external call", async () => {
    const spec = normalizeRuleSpec(fixture), binding = { spec, specHash: "untrusted", chainId: 1 as const, feeds: [feed] };
    const source = composableModuleSource(spec, [feed]).replace("staticcall{gas:18000}", "staticcall{gas:19000}");
    const result = await compileDraft(source, undefined, [], undefined, binding);
    expect(result.validation?.status).toBe("blocked");
    expect(result.artifact).toBeUndefined();
  }, 30000);
  it("enforces the delayed weather action in actual EVM calls", async () => {
    const spec = normalizeRuleSpec({...fixture,actions:[{...fixture.actions[0],startsAtSeconds:600,
      when:{kind:"feed",feedId:feed.id,operator:"changed",value:"0"}}]});
    const result = await compileRuleSpec(spec,1,[feed]);
    expect(result.validation?.status).toBe("passed");
    const tool = createRequire(join(process.env.CUSTOM_AI_COMPILER_DIR!, "package.json"));
    const {createVM}=tool("@ethereumjs/vm"), {createBlock}=tool("@ethereumjs/block");
    const {createCustomCommon,Mainnet,Hardfork}=tool("@ethereumjs/common");
    const {createAddressFromString,hexToBytes,bytesToHex}=tool("@ethereumjs/util");
    const common=createCustomCommon({chainId:1},Mainnet,{hardfork:Hardfork.Cancun});
    const vm=await createVM({common});
    const caller=createAddressFromString("0x8000000000000000000000000000000000000008");
    const deployed=await vm.evm.runCall({caller,gasLimit:5000000n,data:hexToBytes(result.artifact!.initCode)});
    expect(deployed.execResult.exceptionError).toBeUndefined();
    const action = keccak256(stringToHex("compound"));
    const events: Hex[]=[];
    for (const now of [1599,1600,2200]) {
      await seedComposableFeeds(tool,vm,result.composable!,BigInt(now),[{feedId:feed.id,sequence:"2",transitionSequence:"1",
        value:"1",previousValue:"0",changedAt:1300,observedAt:now,validUntil:now+1800,fresh:true}]);
      const call=await vm.evm.runCall({caller,to:deployed.createdAddress,gasLimit:1000000n,
        block:createBlock({header:{timestamp:BigInt(now)}},{common}),
        data:hexToBytes(encodeFunctionData({abi:result.artifact!.abi,functionName:"actionState",args:[action,1000n]}))});
      expect(call.execResult.exceptionError).toBeUndefined();
      const state=decodeFunctionResult({abi:result.artifact!.abi,functionName:"actionState",data:bytesToHex(call.execResult.returnValue)}) as [boolean,Hex,bigint];
      expect(state[0]).toBe(now>=1600);
      if(state[0])events.push(state[1]);
    }
    expect(events[0]).toBe(events[1]);
  },90000);
});
