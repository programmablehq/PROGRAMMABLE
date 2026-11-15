import {encodeFunctionData,parseAbi,type Address,type Hex} from "viem";
import {successfulTradeFramesV1,pendingTradeV1,type TradeTraceV1} from "./routed-trade-rpc-v1";

const abi=parseAbi(["function totalPlatformRecorded() view returns(uint256)","function totalPlatformPaid() view returns(uint256)"]);
/** Exact source/runtime checks happen before this balance/trace proof. A paid fee
 * is proved as both a cumulative counter change and a successful native transfer. */
export async function proveAutomaticPlatformFeeAccrualV1(input:{vault:Address;poolManager:Address;recipient:Address;expected:bigint;
  trace:TradeTraceV1;post:Record<string,Record<string,unknown>>;
  call(to:Address,data:Hex,overrides?:Record<string,Record<string,unknown>>):Promise<Hex>}) {
  const read=async(name:"totalPlatformRecorded"|"totalPlatformPaid",after:boolean)=>{
    const value=await input.call(input.vault,encodeFunctionData({abi,functionName:name}),after?input.post:undefined);
    if(!/^0x[0-9a-f]{64}$/iu.test(value))return pendingTradeV1("AUTOMATIC_FEE_COUNTER_PENDING");
    return BigInt(value);
  };
  const [recordedBefore,recordedAfter,paidBefore,paidAfter]=await Promise.all([
    read("totalPlatformRecorded",false),read("totalPlatformRecorded",true),read("totalPlatformPaid",false),read("totalPlatformPaid",true)]);
  const frames=successfulTradeFramesV1(input.trace);
  const payments=frames.filter(f=>f.type==="CALL"&&f.from.toLowerCase()===input.poolManager.toLowerCase()&&f.to?.toLowerCase()===input.recipient.toLowerCase()
    &&f.input==="0x"&&BigInt(f.value)>0n);
  if(recordedAfter-recordedBefore!==input.expected||paidAfter-paidBefore!==input.expected
    ||payments.length!==1||BigInt(payments[0]!.value)!==input.expected)
    return pendingTradeV1("AUTOMATIC_FEE_PAYOUT_UNPROVEN");
  return input.expected;
}
