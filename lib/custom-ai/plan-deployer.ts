import { keccak256, type Address, type Hex } from "viem";

/** Same deterministic proxy used by the reviewed Atomic V2 deployment tool.
 * This is an intended dependency, not a live code observation or permission.
 * The Plan declares it for independent backend runtime/transaction checks. */
const runtime="0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3" as Hex;
export const ROBINHOOD_PLAN_DEPLOYER=Object.freeze({
  address:"0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address,
  runtimeCodeHash:keccak256(runtime),
  transport:"salt-prefix-create2-v1" as const,
});
