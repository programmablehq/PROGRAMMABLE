import { getAddress, keccak256, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { ImmutablePoolFeeMarketV1 } from "./immutable-pool-fee-runtime-custom-launch-plan-v1";

// Exact deployed source from lottery-robinhood commit 4c18cbea. This is an
// immutable runtime classification, never a token name or submitter fee claim.
export const IRL_POOL_FEE_DEPLOYMENT_V1 = Object.freeze({
  hook: { address: getAddress("0xAb64c6Eb29a6bb8488cb1fcAB1ca11C5e28bC0cc"), runtimeCodeHash: "0xd5db5f13d75dfc07681e6b747c28e60eee7dc1a23c302bfe37b9841e80615b76" as Hex },
  token: { address: getAddress("0xf7a2F5554C57C216F1831AA5C8ed3C46727eFE2B"), runtimeCodeHash: "0x248998d63b875037eb003ba083f3dc190e487fbd5e90f35e4cd8ee73909c14fc" as Hex },
  wrappedEth: { address: getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"), runtimeCodeHash: "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353" as Hex },
  poolManager: getAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951"),
  recipient: getAddress("0xD88539d3c4C460136a733A3Fd60cf6BF269079da"),
});
export const IRL_POOL_FEE_PROOF_SCHEMA_V1 = "programmable.irl-pool-fee-runtime-proof.v1" as const;
const issued = new WeakSet<object>();
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function body(market: ImmutablePoolFeeMarketV1) {
  const deployment = IRL_POOL_FEE_DEPLOYMENT_V1;
  if (market.chainId !== "4663" || !same(market.poolManager, deployment.poolManager)
    || !same(market.currency0, deployment.wrappedEth.address) || !same(market.currency1, deployment.token.address)
    || !same(market.hooks, deployment.hook.address) || market.fee !== 3000 || market.tickSpacing !== 60) return null;
  return { schemaVersion: IRL_POOL_FEE_PROOF_SCHEMA_V1, recipeId: "irl-4c18cbea" as const,
    market: { ...market, poolManager: getAddress(market.poolManager), currency0: getAddress(market.currency0),
      currency1: getAddress(market.currency1), hooks: getAddress(market.hooks) },
    feeVault: deployment.hook.address, recipient: deployment.recipient, rateBps: 30 as const,
    runtimeBindings: [deployment.hook, deployment.token, deployment.wrappedEth] };
}
function issue(value: NonNullable<ReturnType<typeof body>>) {
  const proof = Object.freeze({ ...value, proofDigest: canonicalBrowserSha256V2(IRL_POOL_FEE_PROOF_SCHEMA_V1, value) });
  issued.add(proof); return proof;
}
export type IrlPoolFeeProofV1 = ReturnType<typeof issue>;
export function proveIrlPoolFeeV1(market: ImmutablePoolFeeMarketV1, codes: Readonly<Record<string, Hex>>): IrlPoolFeeProofV1 | null {
  const value = body(market);
  return value && value.runtimeBindings.every(pin => codes[pin.address.toLowerCase()]
    && keccak256(codes[pin.address.toLowerCase()]!) === pin.runtimeCodeHash) ? issue(value) : null;
}
export function rebuildIrlPoolFeeV1(value: unknown, market: ImmutablePoolFeeMarketV1): IrlPoolFeeProofV1 {
  const expected = body(market);
  if (!expected) throw new TypeError("The IRL market differs from its reviewed runtime.");
  const proof = issue(expected);
  if (canonicalBrowserJsonV2(value) !== canonicalBrowserJsonV2(proof)) throw new TypeError("The IRL fee runtime proof differs.");
  return proof;
}
export function assertIrlPoolFeeV1(proof: IrlPoolFeeProofV1, market: ImmutablePoolFeeMarketV1) {
  if (!issued.has(proof)) throw new TypeError("The IRL fee proof was not independently reconstructed.");
  rebuildIrlPoolFeeV1(proof, market);
}
/** Preserve both floors in the reviewed hook's actual integer arithmetic. */
export function irlPoolFeeAmountsV1(gross: bigint, launchBoost: boolean) {
  const totalRate = launchBoost ? 1000n : 400n;
  const ecosystemFee = gross * totalRate / 10_000n;
  return { ecosystemFee, platformFee: ecosystemFee * 30n / totalRate };
}
export function validateIrlFeeAccrualV1(value: unknown, proof: IrlPoolFeeProofV1, request: { amountIn: string; zeroForOne: boolean }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("The IRL fee effect is missing.");
  const row = value as Record<string, unknown>;
  const amount = (key: string) => {
    const value = row[key];
    if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new TypeError("The IRL fee amount is invalid.");
    return BigInt(value);
  };
  const gross = amount("grossNativeAmount"), fee = irlPoolFeeAmountsV1(gross, row.launchBoost === true);
  if (row.proofDigest !== proof.proofDigest || row.recipient !== proof.recipient || row.vault !== proof.feeVault
    || typeof row.launchBoost !== "boolean" || gross === 0n || (request.zeroForOne && gross !== BigInt(request.amountIn))
    || amount("ecosystemFee") !== fee.ecosystemFee || amount("platformFee") !== fee.platformFee
    || amount("paid") + amount("potAfter") - amount("potBefore") !== fee.platformFee
    || amount("backingAfter") < amount("potAfter")
    || typeof row.traceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.traceDigest)) {
    throw new TypeError("The exact IRL swap must pay or back its existing platform fee.");
  }
}
