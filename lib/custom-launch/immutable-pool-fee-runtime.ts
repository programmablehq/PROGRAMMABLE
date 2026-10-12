import type { Hex } from "viem";
import {
  IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V1,
  assertIssuedImmutablePoolFeeRuntimeProofV1,
  immutablePoolFeeRequiredAddressesV1,
  proveImmutablePoolFeeRuntimeV1,
  rebuildImmutablePoolFeeRuntimeProofV1,
  type ImmutablePoolFeeMarketV1,
  type ImmutablePoolFeeRuntimeProofV1,
} from "./immutable-pool-fee-runtime-custom-launch-plan-v1";
import {
  IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2,
  assertIssuedImmutablePoolFeeRuntimeProofV2,
  immutablePoolFeeRequiredAddressesV2,
  proveImmutablePoolFeeRuntimeV2,
  rebuildImmutablePoolFeeRuntimeProofV2,
  type ImmutablePoolFeeRuntimeProofV2,
} from "./immutable-pool-fee-runtime-custom-launch-plan-v2";

import {
  IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V3, assertIssuedImmutablePoolFeeRuntimeProofV3,
  immutablePoolFeeRequiredAddressesV3, proveImmutablePoolFeeRuntimeV3,
  rebuildImmutablePoolFeeRuntimeProofV3, type ImmutablePoolFeeRuntimeProofV3,
} from "./immutable-pool-fee-runtime-custom-launch-plan-v3";

export type ImmutablePoolFeeRuntimeProof = ImmutablePoolFeeRuntimeProofV1 | ImmutablePoolFeeRuntimeProofV2 | ImmutablePoolFeeRuntimeProofV3;

/** Each proof version retains its exact source bytes, rate and digest domain. */
export function immutablePoolFeeRequiredAddresses(market: ImmutablePoolFeeMarketV1, runtime: Hex) {
  return immutablePoolFeeRequiredAddressesV3(market, runtime) ?? immutablePoolFeeRequiredAddressesV2(market, runtime) ?? immutablePoolFeeRequiredAddressesV1(market, runtime);
}

export function proveImmutablePoolFeeRuntime(market: ImmutablePoolFeeMarketV1, codes: Readonly<Record<string, Hex>>) {
  return proveImmutablePoolFeeRuntimeV3(market, codes) ?? proveImmutablePoolFeeRuntimeV2(market, codes) ?? proveImmutablePoolFeeRuntimeV1(market, codes);
}

export function assertIssuedImmutablePoolFeeRuntimeProof(proof: ImmutablePoolFeeRuntimeProof, market: ImmutablePoolFeeMarketV1) {
  if (proof.schemaVersion === IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V3) return assertIssuedImmutablePoolFeeRuntimeProofV3(proof, market);
  if (proof.schemaVersion === IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2) return assertIssuedImmutablePoolFeeRuntimeProofV2(proof, market);
  return assertIssuedImmutablePoolFeeRuntimeProofV1(proof, market);
}

export function rebuildImmutablePoolFeeRuntimeProof(value: unknown, market: ImmutablePoolFeeMarketV1): ImmutablePoolFeeRuntimeProof {
  const schema = value && typeof value === "object" && "schemaVersion" in value ? value.schemaVersion : null;
  if (schema === IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V3) return rebuildImmutablePoolFeeRuntimeProofV3(value, market);
  if (schema === IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2) return rebuildImmutablePoolFeeRuntimeProofV2(value, market);
  if (schema === IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V1) return rebuildImmutablePoolFeeRuntimeProofV1(value, market);
  throw new TypeError("Unknown immutable pool fee proof version");
}
