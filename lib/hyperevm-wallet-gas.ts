import type { Address, Hex } from "viem";

type Request = (input: { method: string; params?: unknown[] }) => Promise<unknown>;

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new Error("HyperEVM gas pricing is temporarily unavailable. Try again.");
  }
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed >= 2n ** 128n) {
    throw new Error("HyperEVM gas pricing is temporarily unavailable. Try again.");
  }
  return parsed;
}

/** HyperEVM prices big and small blocks separately; priority fees are burned. */
export async function readHyperEvmWalletFees({ account, request }: {
  account: Address;
  request: Request;
}): Promise<{ maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }> {
  if (await request({ method: "eth_chainId" }) !== "0x3e7") {
    throw new Error("Switch your wallet to HyperEVM and try again.");
  }
  const bigBlocks = await request({ method: "eth_usingBigBlocks", params: [account] });
  if (typeof bigBlocks !== "boolean") {
    throw new Error("Your HyperEVM block mode could not be checked. Try again.");
  }
  const baseFee = quantity(await request({
    method: bigBlocks ? "eth_bigBlockGasPrice" : "eth_gasPrice",
  }));
  return { maxFeePerGas: `0x${(baseFee * 2n).toString(16)}`, maxPriorityFeePerGas: "0x0" };
}
