import "server-only";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { ethereumNative30FeeAmountV1, type EthereumNative30RuntimeProofV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";
import { pendingTradeV1, type TradeTraceV1 } from "./routed-trade-rpc-v1";

const READ = parseAbi([
  "function platformCredit() view returns(uint256)", "function developmentCredit() view returns(uint256)", "function rewardCredit() view returns(uint256)",
  "function programmableFeesAccrued() view returns(uint256)", "function projectFeesAccrued() view returns(uint256)",
  "function totalQuoteFeesAccrued() view returns(uint256)", "function programmableFeeRemainder() view returns(uint256)",
  "function balanceOf(address,uint256) view returns(uint256)",
]);
type ReadName = Exclude<(typeof READ)[number]["name"], "balanceOf">;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** The caller has checked the exact before/after callbacks against the request.
 * Read all liabilities and their backing at the same agreed pre/post state. */
export async function proveEthereumLedgerNative30AccrualV1(input: Readonly<{
  proof: EthereumNative30RuntimeProofV1; grossNative: bigint; nativeDelta: bigint; callbacks: readonly TradeTraceV1[];
  post: Record<string, Record<string, unknown>>;
  call(to: Address, data: Hex, overrides?: Record<string, Record<string, unknown>>): Promise<Hex>;
  balance?: (to: Address) => Promise<bigint>;
}>) {
  const { proof, call, post, grossNative, nativeDelta } = input;
  const isRivet = proof.recipeId === "rivet_native30_v1";
  if (!isRivet && proof.recipeId !== "pidx_native30_v1") return pendingTradeV1("POOL_FEE_RUNTIME_UNPROVEN");
  const read = async (name: ReadName, after: boolean) => {
    const raw = await call(proof.feeVault, encodeFunctionData({ abi: READ, functionName: name }), after ? post : undefined);
    if (!/^0x[0-9a-f]{64}$/i.test(raw)) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
    return BigInt(raw);
  };
  let nativeBefore = 0n;
  if (isRivet) {
    if (!input.balance) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
    nativeBefore = await input.balance(proof.feeVault);
    if (nativeBefore < 0n) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
  }
  const ledger = async (after: boolean) => {
    const [platform, creator, remainder] = await Promise.all([
      read(isRivet ? "platformCredit" : "programmableFeesAccrued", after),
      isRivet ? Promise.all([read("developmentCredit", after), read("rewardCredit", after)]).then(([a, b]) => a + b)
        : read("projectFeesAccrued", after),
      isRivet ? 0n : read("programmableFeeRemainder", after),
    ]);
    let backing: bigint;
    if (isRivet) {
      const states = Object.entries(post).filter(([address]) => address.toLowerCase() === proof.feeVault.toLowerCase());
      if (states.length > 1) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
      const value = states[0]?.[1].balance;
      if (after && value !== undefined && (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value))) return pendingTradeV1("POOL_FEE_LEDGER_READ_PENDING");
      backing = after && value !== undefined ? BigInt(value as string) : nativeBefore;
    } else {
      const [raw, total] = await Promise.all([
        call(proof.market.poolManager, encodeFunctionData({ abi: READ, functionName: "balanceOf", args: [proof.feeVault, 0n] }), after ? post : undefined),
        read("totalQuoteFeesAccrued", after),
      ]);
      if (!/^0x[0-9a-f]{64}$/i.test(raw) || total !== platform + creator) return pendingTradeV1("POOL_FEE_BACKING_UNPROVEN");
      backing = BigInt(raw);
    }
    return { platform, creator, backing, remainder };
  };
  const [before, after] = await Promise.all([ledger(false), ledger(true)]);
  const expected = ethereumNative30FeeAmountV1(proof, grossNative, before.remainder);
  const platform = expected.amount;
  if (after.remainder !== expected.remainder || after.platform - before.platform !== platform
    || before.backing < before.platform + before.creator || after.backing < after.platform + after.creator
    || after.backing - before.backing !== platform + after.creator - before.creator) return pendingTradeV1("POOL_FEE_BACKING_UNPROVEN");
  const encoded = (state: typeof before) => Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.toString()]));
  return { proofDigest: proof.proofDigest, vault: proof.feeVault, currency: ZERO, recipient: proof.recipient, rateBps: proof.rateBps,
    assessmentBase: proof.assessmentBase, rounding: proof.rounding, grossNativeAmount: grossNative.toString(), nativePoolDelta: nativeDelta.toString(),
    platformAccruedIncrease: platform.toString(), platformAccruedBefore: before.platform.toString(), platformAccruedAfter: after.platform.toString(),
    creatorAccruedBefore: before.creator.toString(), creatorAccruedAfter: after.creator.toString(), creatorAccruedIncrease: (after.creator - before.creator).toString(),
    backingBefore: before.backing.toString(), backingAfter: after.backing.toString(), backingIncrease: (after.backing - before.backing).toString(),
    platformRemainderBefore: before.remainder.toString(), platformRemainderAfter: after.remainder.toString(),
    callbackTraceDigest: canonicalBrowserSha256V2("programmable.immutable-pool-fee-callback-trace.v1", input.callbacks),
    recordTraceDigest: canonicalBrowserSha256V2("programmable.custom-native30-backed-ledger.v1", { before: encoded(before), after: encoded(after) }) };
}
