import "server-only";
import { encodeFunctionData, decodeFunctionResult, getAddress, keccak256, parseUnits, stringToHex, type Abi, type Address, type Hex } from "viem";
import code from "./composable-code.json";
import type { BoundRuleSpec } from "./rule-compiler.server";
import type { CustomAIChain } from "./chain.server";
import { bytesV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { CustomAIError } from "./types";
import { matchesRuntime } from "./runtime";
export type ComposableProgramPlan = { factory: Address; data: Hex; router: Address; programs: Address[]; bundleHash: string };
const artifacts = code.contracts as Record<string, { abi: Abi; runtimeTemplate: Hex; immutableReferences: Record<string, {start:number; length:number}[]> }>;
export async function planComposablePrograms(binding: BoundRuleSpec, chain: CustomAIChain, input: {
  programFactory: Address; coreFactory: Address; account: Address; launchSalt: Hex; quote: Address; quoteDecimals: number;
}): Promise<ComposableProgramPlan> {
  const a = artifacts.CustomAIProgramFactoryV1;
  if (!a || !matchesRuntime(await chain.code(input.programFactory), a)) throw new CustomAIError("program", "The program deployment version is not active.", 503);
  const actions = binding.spec.actions.map(action => ({ id: keccak256(stringToHex(action.id)), kind: ["liquidity", "distribution", "staking", "buyback"].indexOf(action.kind),
    shareBps: action.shareBps, recipient: action.recipient === "creator" ? input.account : action.recipient || "0x0000000000000000000000000000000000000000",
    maximumBatch: parseUnits(action.maximumQuote, input.quoteDecimals), minimumTokensPerQuote: parseUnits(action.minimumTokensPerQuote ?? "0", 18),
    deviation: action.maximumPriceDeviationBps, interval: BigInt(action.intervalSeconds), maxPriceAge: BigInt(action.priceMaxAgeSeconds),
    minimumObservations: action.minimumObservations, minimumHistory: 60n }));
  const configuration = { factory: input.coreFactory, creator: input.account, launchSalt: input.launchSalt, quote: input.quote,
    quoteDecimals: input.quoteDecimals, ruleSpecHash: `0x${binding.specHash}`, actions };
  const query = encodeFunctionData({ abi: a.abi, functionName: "predictPrograms", args: [configuration] });
  const result = decodeFunctionResult({ abi: a.abi, functionName: "predictPrograms", data: await chain.agreed("eth_call", [{ to: input.programFactory, data: query }, chain.reference], bytesV1) }) as [Address, Address[], Hex];
  if (result[1].length !== actions.length) throw new CustomAIError("program", "The predicted program set differs from this design.", 409);
  return { factory: input.programFactory, data: encodeFunctionData({ abi: a.abi, functionName: "deployPrograms", args: [configuration] }),
    router: getAddress(result[0]), programs: result[1].map(address => getAddress(address)), bundleHash: code.bundleHash };
}
export async function readComposableProgramBinding(chain: CustomAIChain, plan: ComposableProgramPlan) {
  const runtime = await chain.code(plan.router);
  if (plan.bundleHash !== code.bundleHash || !matchesRuntime(runtime, artifacts.CustomAIProgramRouterV1)) throw new CustomAIError("program", "The deployed allocation program changed.", 409);
  return { instance: plan.router, runtimeHash: keccak256(runtime), configurationHash: await chain.call(plan.router, "function configurationHash() view returns (bytes32)") as Hex };
}
