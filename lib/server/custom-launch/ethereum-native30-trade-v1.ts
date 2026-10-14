import "server-only";
import { decodeFunctionData, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { isBrownieNative30RecipeV1 } from "@/lib/custom-launch/ethereum-custom-native30-recipes-v1";
import type { EthereumNative30RuntimeProofV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";

import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { pendingTradeV1, successfulTradeFramesV1, type TradeTraceV1 } from "./routed-trade-rpc-v1";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const CALLBACKS = parseAbi([
  "function beforeSwap(address sender,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,bytes hookData) returns(bytes4,int256,uint24)",
  "function afterSwap(address sender,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,int256 delta,bytes hookData) returns(bytes4,int128)",
]);
const RECORD = parseAbi(["function recordFees(uint256 platformAmount,uint256 creatorAmount)"]);
const READ = parseAbi(["function platformAccrued() view returns(uint256)", "function creatorAccrued() view returns(uint256)", "function balanceOf(address,uint256) view returns(uint256)"]);
const BROWNIE_READ = parseAbi(["function platformOwed() view returns(uint256)", "function harvestable() view returns(uint256)",
  "function moduleBudget() view returns(uint256)", "function launchTaxOwed() view returns(uint256)"]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Trace arguments fix the gross native fee base; exact vault and ERC-6909
 * post-state readbacks establish both the liability and its actual backing. */
export async function proveEthereumNative30TradeAccrualV1(input: Readonly<{
  proof: EthereumNative30RuntimeProofV1; request: { zeroForOne: boolean; amountIn: string; nativeInput?: string; hookData: Hex }; router: Address; trace: TradeTraceV1;
  post: Record<string, Record<string, unknown>>;
  call(to: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>): Promise<Hex>;
}>) {
  const { proof, request, router, trace, post, call } = input;
  const frames = successfulTradeFramesV1(trace);
  const callbacks = frames.filter(frame => frame.type === "CALL" && same(frame.from, proof.market.poolManager)
    && frame.to && same(frame.to, proof.market.hooks)).flatMap(frame => {
      try { return [{ frame, decoded: decodeFunctionData({ abi: CALLBACKS, data: frame.input }) }]; } catch { return []; }
    });
  const before = callbacks.filter(c => c.decoded.functionName === "beforeSwap"), after = callbacks.filter(c => c.decoded.functionName === "afterSwap");
  if (before.length !== 1 || after.length !== 1) return pendingTradeV1("POOL_FEE_CALLBACK_SCOPE_UNPROVEN");
  for (const { decoded } of callbacks) {
    const [sender, key, params] = decoded.args;
    const hookData = decoded.functionName === "beforeSwap" ? decoded.args[3] : decoded.args[4];
    if (!same(sender, router) || !same(key.currency0, proof.market.currency0) || !same(key.currency1, proof.market.currency1)
      || !same(key.hooks, proof.market.hooks) || key.fee !== proof.market.fee || key.tickSpacing !== proof.market.tickSpacing
      || params.zeroForOne !== request.zeroForOne || params.amountSpecified !== -BigInt(request.amountIn)
      || hookData !== request.hookData) return pendingTradeV1("POOL_FEE_CALLBACK_SCOPE_UNPROVEN");
  }
  if (before[0]!.decoded.args[2].sqrtPriceLimitX96 !== after[0]!.decoded.args[2].sqrtPriceLimitX96) return pendingTradeV1("POOL_FEE_CALLBACK_SCOPE_UNPROVEN");
  const afterDecoded = after[0]!.decoded;
  if (afterDecoded.functionName !== "afterSwap") return pendingTradeV1("POOL_FEE_CALLBACK_SCOPE_UNPROVEN");
  const nativeDelta = BigInt.asIntN(128, afterDecoded.args[3] >> 128n);
  if (request.zeroForOne ? nativeDelta >= 0n : nativeDelta <= 0n) return pendingTradeV1("POOL_FEE_BASE_UNPROVEN");
  const grossNative = request.zeroForOne ? BigInt(request.nativeInput ?? request.amountIn) : nativeDelta;
  const platform = (grossNative * BigInt(proof.rateBps) + (proof.rounding === "ceil_per_trade" ? 9999n : 0n)) / 10000n;
  if (grossNative <= 0n || platform < 0n) return pendingTradeV1("POOL_FEE_BASE_UNPROVEN");
  if (isBrownieNative30RecipeV1(proof.recipeId)) {
    const read = async (name: "platformOwed" | "harvestable" | "moduleBudget" | "launchTaxOwed", afterState: boolean) => {
      const raw = await call(proof.feeVault, encodeFunctionData({ abi: BROWNIE_READ, functionName: name }), afterState ? post : undefined);
      if (!/^0x[0-9a-f]{64}$/i.test(raw)) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
      return BigInt(raw);
    };
    const ledger = async (afterState: boolean) => {
      const [platform, ...project] = await Promise.all([read("platformOwed", afterState), read("harvestable", afterState),
        read("moduleBudget", afterState), read("launchTaxOwed", afterState)]);
      const raw = await call(proof.market.poolManager, encodeFunctionData({ abi: READ, functionName: "balanceOf", args: [proof.feeVault, 0n] }), afterState ? post : undefined);
      if (!/^0x[0-9a-f]{64}$/i.test(raw)) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
      return { platform: platform!, creator: project.reduce((sum, value) => sum + value, 0n), backing: BigInt(raw) };
    };
    const [before, after] = await Promise.all([ledger(false), ledger(true)]);
    if (after.platform - before.platform !== platform || before.backing < before.platform + before.creator
      || after.backing < after.platform + after.creator
      || after.backing - before.backing !== platform + after.creator - before.creator) return pendingTradeV1("POOL_FEE_BACKING_UNPROVEN");
    return { proofDigest: proof.proofDigest, vault: proof.feeVault, currency: ZERO, recipient: proof.recipient, rateBps: proof.rateBps,
      assessmentBase: proof.assessmentBase, rounding: proof.rounding, grossNativeAmount: grossNative.toString(), nativePoolDelta: nativeDelta.toString(),
      platformAccruedIncrease: platform.toString(), platformAccruedBefore: before.platform.toString(), platformAccruedAfter: after.platform.toString(),
      creatorAccruedBefore: before.creator.toString(), creatorAccruedAfter: after.creator.toString(), creatorAccruedIncrease: (after.creator - before.creator).toString(),
      backingBefore: before.backing.toString(), backingAfter: after.backing.toString(), backingIncrease: (after.backing - before.backing).toString(),
      callbackTraceDigest: canonicalBrowserSha256V2("programmable.immutable-pool-fee-callback-trace.v1", callbacks.map(c => c.frame)),
      recordTraceDigest: canonicalBrowserSha256V2("programmable.brownie-fee-ledger.v1", { before: { platform: before.platform.toString(), creator: before.creator.toString(), backing: before.backing.toString() },
        after: { platform: after.platform.toString(), creator: after.creator.toString(), backing: after.backing.toString() } }) };
  }
  const recorded = frames.filter(frame => frame.type === "CALL" && frame.to && same(frame.to, proof.feeVault)
    && same(frame.from, proof.feeRecorder)).flatMap(frame => {
      try { return [{ frame, args: decodeFunctionData({ abi: RECORD, data: frame.input }).args }]; } catch { return []; }
    });
  if (recorded.length !== 1 || recorded[0]!.args[0] !== platform) return pendingTradeV1("POOL_FEE_ACCRUAL_UNPROVEN");
  const read = async (name: "platformAccrued" | "creatorAccrued" | "balanceOf", afterState: boolean) => {
    const raw = await call(name === "balanceOf" ? proof.market.poolManager : proof.feeVault,
      encodeFunctionData({ abi: READ, functionName: name, args: name === "balanceOf" ? [proof.feeVault, 0n] : [] } as never), afterState ? post : undefined);
    if (!/^0x[0-9a-f]{64}$/.test(raw)) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING"); return BigInt(raw);
  };
  const [platformBefore, platformAfter, creatorBefore, creatorAfter, backingBefore, backingAfter] = await Promise.all([
    read("platformAccrued", false), read("platformAccrued", true), read("creatorAccrued", false), read("creatorAccrued", true),
    read("balanceOf", false), read("balanceOf", true),
  ]);
  if (platformAfter - platformBefore !== platform || creatorAfter - creatorBefore !== recorded[0]!.args[1]
    || backingAfter - backingBefore !== platform + recorded[0]!.args[1]
    || backingBefore < platformBefore + creatorBefore || backingAfter < platformAfter + creatorAfter) return pendingTradeV1("POOL_FEE_BACKING_UNPROVEN");
  return { proofDigest: proof.proofDigest, vault: proof.feeVault, currency: ZERO, recipient: proof.recipient, rateBps: proof.rateBps,
    assessmentBase: "gross_native_leg", rounding: proof.rounding, grossNativeAmount: grossNative.toString(),
    nativePoolDelta: nativeDelta.toString(), platformAccruedIncrease: platform.toString(),
    platformAccruedBefore: platformBefore.toString(), platformAccruedAfter: platformAfter.toString(),
    creatorAccruedBefore: creatorBefore.toString(), creatorAccruedAfter: creatorAfter.toString(), creatorAccruedIncrease: (creatorAfter - creatorBefore).toString(),
    backingBefore: backingBefore.toString(), backingIncrease: (backingAfter - backingBefore).toString(), backingAfter: backingAfter.toString(),
    callbackTraceDigest: canonicalBrowserSha256V2("programmable.immutable-pool-fee-callback-trace.v1", callbacks.map(c => c.frame)),
    recordTraceDigest: canonicalBrowserSha256V2("programmable.immutable-pool-fee-record-trace.v1", recorded.map(r => r.frame)) };
}
