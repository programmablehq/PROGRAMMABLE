import "server-only";
import { decodeFunctionResult, encodeFunctionData, parseAbi, toHex, type Abi, type Address, type Hex } from "viem";
import { foundationMainnetRpcs } from "@/lib/server/module-foundation/rpc";
import { foundationChainProfile } from "@/lib/module-foundation/chains";
import { agreedTradeRpcV1, bytesV1, productionTradeRpcsV1, quantityV1, readTradeCheckpointV1,
  tradeBlockV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import { CustomAIError } from "./types";

export async function customAIChain(chainId: 1 | 4663, supplied?: readonly [TradeRpcV1, TradeRpcV1]) {
  const profile = foundationChainProfile(chainId);
  const rpcs = supplied ?? (chainId === 1 ? foundationMainnetRpcs() : productionTradeRpcsV1());
  const agreed = agreedTradeRpcV1(rpcs);
  if (await agreed("eth_chainId", [], value => quantityV1(value).toString()) !== String(chainId)) throw new CustomAIError("chain", "The network could not be verified.", 503);
  const block = await readTradeCheckpointV1(rpcs, profile.preparationLag);
  const reference = { blockHash: block.hash, requireCanonical: true };
  const assertFresh = () => {
    const age = BigInt(Math.floor(Date.now() / 1000)) - BigInt(block.timestamp);
    if (age < -5n || age > 90n) throw new CustomAIError("chain", "The network is catching up. Try again shortly.", 503);
  };
  assertFresh();
  return {
    chainId, profile, block, rpcs, agreed, reference,
    code: (address: Address) => agreed("eth_getCode", [address, reference], bytesV1),
    async call(address: Address, signature: string, args: readonly unknown[] = []) {
      const abi = parseAbi([signature]) as Abi;
      const functionName = signature.match(/^function ([A-Za-z0-9_]+)/)?.[1];
      if (!functionName) throw Error("Invalid internal contract read.");
      const data = encodeFunctionData({ abi, functionName, args });
      return decodeFunctionResult({ abi, functionName, data: await agreed("eth_call", [{ to: address, data }, reference], bytesV1) });
    },
    async finish() {
      assertFresh();
      const final = await agreed("eth_getBlockByNumber", [toHex(BigInt(block.number)), false], tradeBlockV1);
      if (final.hash !== block.hash) throw new CustomAIError("chain", "The network changed during preparation. Try again.", 503);
    },
  };
}
export type CustomAIChain = Awaited<ReturnType<typeof customAIChain>>;
export const asAddress = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{40}$/i.test(value)) throw Error("Invalid contract address.");
  return value as Address;
};
export const asHash = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) throw Error("Invalid contract hash.");
  return value as Hex;
};
