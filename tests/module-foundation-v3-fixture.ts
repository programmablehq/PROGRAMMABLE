import { encodeEventTopics } from "viem";
import { encodeFoundationLaunchEntry, foundationFactoryV3Abi, type FoundationLaunchParametersV3 } from "@/lib/module-foundation/abi";
import { FOUNDATION_FACTORY_V3_ID, FOUNDATION_LP_CUSTODY_DEAD_ID } from "@/lib/module-foundation/constants";
import { foundationV2Fixture } from "./module-foundation-v2-fixture";

/** Extends the synthetic custody fixture; no deployment or source authority is implied. */
export function foundationV3Fixture(creatorBuyFeeBps = 100, creatorSellFeeBps = 700, nativeQuote = false) {
  const f = foundationV2Fixture(false, nativeQuote);
  const common = { ...f.parameters, creatorFeeBps: undefined };
  const parameters: FoundationLaunchParametersV3 = { ...common, creatorBuyFeeBps, creatorSellFeeBps };
  const binding = { ...f.binding, factoryVersion: "v3" as const, lpCustodyId: FOUNDATION_LP_CUSTODY_DEAD_ID };
  f.state.factoryValues.VERSION_ID = FOUNDATION_FACTORY_V3_ID;
  f.steps[0].transaction.data = encodeFoundationLaunchEntry(parameters, { functionName: "launch" });
  const fees = { creatorBuyFeeBps, creatorSellFeeBps };
  f.state.readOverride = read => read.address === f.hook && read.functionName in fees ? fees[read.functionName as keyof typeof fees] : undefined;
  const launchLog = () => {
    const old = f.launchLog();
    // V3's result/event payload is the exact existing V2 tuple; only the event topic changes.
    return { ...old, data: old.data,
      topics: encodeEventTopics({ abi: foundationFactoryV3Abi, eventName: "FoundationLaunchedV3", args: { token: f.token, creator: f.account, poolId: f.pool.poolId } }) };
  };
  f.methods.getLogs.mockImplementation(async () => [launchLog()]);
  const receipt = f.methods.getTransactionReceipt.getMockImplementation()!;
  f.methods.getTransactionReceipt.mockImplementation(async () => ({ ...await receipt(), logs: [launchLog(), f.mintLog(f.result.basePositionId)] }));
  return { ...f, binding, parameters, fees, launchLog, expected: { ...f.expected, parameters } };
}
