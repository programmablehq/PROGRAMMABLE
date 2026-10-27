import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { classicLaunchEvents, classicV2Events, parseClassicLaunchLogs, type ClassicRawLog } from "../lib/market-data/classic-launch-proof";
import { CLASSIC_RPC_LOG_WINDOW, discoverClassicRpcLaunches } from "../lib/market-data/classic-rpc-discovery";
import config from "../config/classic-launch-catalog.v1.json";

const source = config.sources[1]!;
const token = "0x1111111111111111111111111111111111111111";
const creator = "0x2222222222222222222222222222222222222222";
const vault = "0x3333333333333333333333333333333333333333";
const hash = `0x${"ab".repeat(32)}` as const;
const pool = `0x${"cd".repeat(32)}` as const;
afterEach(() => vi.useRealTimers());
function events(): ClassicRawLog[] {
  const values = [
    {deployer:creator,token,poolId:pool,feeHook:source.hook,rewardVault:vault,positionRecipient:creator,positionTokenId:1n,buySwapFeeBps:100,sellSwapFeeBps:200,rewardConfigurationHash:hash,launchHash:hash},
    {token,totalSupply:1_000n,tokenLiquidityAmount:900n,lockedTokenDust:1n,initialTick:100,tickLower:0,tickUpper:200,lpFeePips:0,launchHash:hash},
    {deployer:creator,token,poolId:pool,nativeAmount:1n,tokenAmount:99n,launchHash:hash},
    {deployer:creator,token,custody:"0x0000000000000000000000000000000000000000",mode:0,durationDays:0,cliffDays:0,configurationHash:hash,launchHash:hash},
  ];
  return classicLaunchEvents.map((event, i) => {
    const args = values[i]! as Record<string, unknown>;
    const dataInputs = event.inputs.filter(input => !("indexed" in input && input.indexed));
    return {address:source.launcher,blockNumber:String(source.startBlock+1),blockHash:hash,transactionHash:hash,transactionIndex:0,logIndex:i,removed:false,
      topics:encodeEventTopics({abi:[event],eventName:event.name,args} as never) as string[],
      data:encodeAbiParameters(dataInputs,dataInputs.map(input=>args[input.name]) as never)};
  });
}
describe("canonical Classic launch proofs without Envio", () => {
  it("preserves the creator, fee vault and economics from a complete bound launch", () => {
    expect(parseClassicLaunchLogs(events())).toMatchObject([{creatorAddress:creator,tokenAddress:token,rewardVaultAddress:vault,buyHookFeeBps:100,sellHookFeeBps:200,totalSupplyRaw:"1000",launchModelVersion:"classic-v3"}]);
  });
  it("rejects incomplete, duplicate, removed and foreign-source events", () => {
    expect(()=>parseClassicLaunchLogs(events().slice(0,3))).toThrow();
    expect(()=>parseClassicLaunchLogs([...events(),events()[0]!])).toThrow();
    expect(()=>parseClassicLaunchLogs(events().map(e=>({...e,removed:true})))).toThrow();
    expect(()=>parseClassicLaunchLogs(events().map(e=>({...e,address:creator})))).toThrow();
  });
  it("rejects events from another receipt or a mismatching block", () => {
    const receipt = events(); receipt[1]!.transactionHash=pool;
    expect(()=>parseClassicLaunchLogs(receipt)).toThrow();
    const block = events(); block[1]!.blockHash=pool;
    expect(()=>parseClassicLaunchLogs(block)).toThrow();
  });

  it("discovers the complete launch from bounded RPC windows without a market provider", async () => {
    const result = await discoverClassicRpcLaunches(BigInt(source.startBlock + 1), async (from, to) =>
      events().filter(log => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to));
    expect(result.candidates).toEqual([{ token, poolId: pool, hook: source.hook, transaction: hash, block: source.startBlock + 1 }]);
    expect(result.logs).toHaveLength(4);
  });

  it("does not accept incomplete history or logs outside the requested boundary", async () => {
    await expect(discoverClassicRpcLaunches(BigInt(source.startBlock + 1), async (from, to) =>
      events().slice(0, 3).filter(log => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to))).rejects.toThrow();
    await expect(discoverClassicRpcLaunches(BigInt(source.startBlock + 1), async () => events())).rejects.toThrow();
    await expect(discoverClassicRpcLaunches(BigInt(source.startBlock + 1), async () => { throw Error("RPC unavailable"); })).rejects.toThrow();
  });

  it("reads cached history without RPC pacing delays while keeping six reads in flight", async () => {
    vi.useFakeTimers();
    const started = Date.now();
    let active = 0;
    let peak = 0;
    let reads = 0;
    const end = BigInt(config.sources[0]!.startBlock) + 90n * CLASSIC_RPC_LOG_WINDOW - 1n;
    const discovery = discoverClassicRpcLaunches(end, async () => {
      reads++;
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return [];
    });
    await vi.runAllTimersAsync();

    expect(await discovery).toEqual({ candidates: [], logs: [] });
    expect(reads).toBe(90);
    expect(peak).toBe(6);
    expect(active).toBe(0);
    expect(Date.now() - started).toBe(150);
  });

  it("retains the existing V2 main-token scope while discovering later releases", async () => {
    const old = config.sources[0]!;
    const event = classicV2Events[0]!;
    const args = { creator, token, poolId: pool, feeHook: old.hook, positionRecipient: creator, positionTokenId: 1n,
      totalSwapFeeBps: 100, launchHash: hash };
    const dataInputs = event.inputs.filter(input => !("indexed" in input && input.indexed));
    const excluded: ClassicRawLog = { ...events()[0]!, address: old.launcher, blockNumber: String(old.startBlock),
      topics: encodeEventTopics({ abi: [event], eventName: event.name, args } as never) as string[],
      data: encodeAbiParameters(dataInputs, dataInputs.map(input => args[input.name as keyof typeof args]) as never) };
    const result = await discoverClassicRpcLaunches(BigInt(source.startBlock + 1), async (from, to) =>
      [...events(), excluded].filter(log => BigInt(log.blockNumber) >= from && BigInt(log.blockNumber) <= to));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.hook).toBe(source.hook);
  });
});
