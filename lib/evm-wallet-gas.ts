import type { Address, Hex } from "viem";
import { readHyperEvmWalletFees } from "./hyperevm-wallet-gas";

export async function readEvmCustomWalletFees(input:{chainId:999|99901;account:Address;request:(input:{method:string;params?:unknown[]})=>Promise<unknown>}):Promise<{maxFeePerGas:Hex;maxPriorityFeePerGas:Hex}> {
  if(input.chainId===999)return readHyperEvmWalletFees(input);
  if(BigInt(String(await input.request({method:"eth_chainId"})))!==99901n)throw Error("Switch your wallet to Elysium and try again.");
  const value=await input.request({method:"eth_gasPrice"});
  if(typeof value!=="string"||!/^0x[0-9a-f]+$/i.test(value)||BigInt(value)<=0n||BigInt(value)>=2n**128n)throw Error("Elysium gas pricing is temporarily unavailable. Try again.");
  return {maxFeePerGas:`0x${(BigInt(value)*2n).toString(16)}`,maxPriorityFeePerGas:"0x0"};
}
