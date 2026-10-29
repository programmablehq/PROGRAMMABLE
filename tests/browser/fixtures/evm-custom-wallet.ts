import {useState} from "react";
import {validateEvmCustomSwapPreparation,validateEvmFeeClaimPreparation,EVM_SWAP_SCHEMA} from "../../../lib/swap/evm-custom";
export function useWallet(){const [connected,setConnected]=useState(true);return {wallet:connected?{account:"0x2222222222222222222222222222222222222222" as const}:null,openWallet:()=>setConnected(true),sendEvmCustomSwapWalletAction:async(input:Parameters<typeof validateEvmCustomSwapPreparation>[0])=>{
 const p=input as {schemaVersion:string;request:{chainId:999;token:`0x${string}`;owner:`0x${string}`}};
 const expected={chainId:999 as const,token:p.request.token,owner:"0x2222222222222222222222222222222222222222" as const};
 if(p.schemaVersion===EVM_SWAP_SCHEMA)validateEvmCustomSwapPreparation(input,expected);else validateEvmFeeClaimPreparation(input,expected);
 return `0x${"12".repeat(32)}` as const;
}};}
