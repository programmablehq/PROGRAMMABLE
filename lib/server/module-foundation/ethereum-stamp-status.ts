import { keccak256, parseAbi, type Address } from "viem";
import { CANONICAL_LAUNCH_STAMP_V1, CANONICAL_LAUNCH_STAMP_24H_V1 } from "@/lib/tokens";
import type { foundationMainnetReadClient } from "./rpc";

type StampClient = Pick<ReturnType<typeof foundationMainnetReadClient>, "getCode" | "readContract">;
const stampAbi = parseAbi(["function launchIdByToken(address token) view returns (bytes32)"]);

/** Diagnose an absent index entry at the same finalized checkpoint on both providers.
 * This never supplies launch authority or treats an RPC failure as a missing stamp. */
export async function readEthereumMissingIndexReason(input: {
  clients: readonly [StampClient, StampClient]; token: Address; blockNumber: bigint;
}): Promise<"MODULE_INDEX_PENDING" | "MODULE_STAMP_MISSING"> {
  const { clients, token, blockNumber } = input;
  const codes = await Promise.all(clients.map(client => client.getCode({ address: token, blockNumber })));
  if (codes[0] !== codes[1]) throw new Error("Ethereum token providers disagree.");
  // The token may still be waiting for its launch transaction to finalize.
  if (!codes[0] || codes[0] === "0x") return "MODULE_INDEX_PENDING";
  const routers = [CANONICAL_LAUNCH_STAMP_V1, CANONICAL_LAUNCH_STAMP_24H_V1]
    .filter(router => BigInt(router.routerStartBlock) <= blockNumber);
  if (!routers.length) return "MODULE_INDEX_PENDING";
  const proofs = await Promise.all(clients.map(client => Promise.all(routers.map(async router => {
    const code = await client.getCode({ address: router.routerAddress, blockNumber });
    if (!code || keccak256(code) !== router.routerRuntimeCodeHash) throw new Error("The launch stamp router could not be verified.");
    return client.readContract({ address: router.routerAddress, abi: stampAbi,
      functionName: "launchIdByToken", args: [token], blockNumber });
  }))));
  if (proofs[0].some((id, index) => id !== proofs[1][index])) throw new Error("Ethereum stamp providers disagree.");
  return proofs[0].some(id => BigInt(id) !== 0n) ? "MODULE_INDEX_PENDING" : "MODULE_STAMP_MISSING";
}
