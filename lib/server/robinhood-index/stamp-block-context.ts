import type { Hex, PublicClient } from "viem";

/** Solidity NUMBER can differ from the RPC L2 height. Read its exact value in
 * the EVM at the same canonical inclusion hash as the stamp. No deployment. */
export async function readStampEvmBlockNumber(client: PublicClient, blockHash: Hex): Promise<bigint> {
  const value = await client.request({ method: "eth_call", params: [
    { data: "0x4360005260206000f3", gas: "0x186a0" },
    { blockHash, requireCanonical: true },
  ] } as never);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Projection EVM block-number read is invalid");
  }
  return BigInt(value);
}
