import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex } from "viem";
import { aiSwapEventABI, aiRouterSettlementABI, transferABI, verifyAIClaimSettlement, verifyAISwapSettlement, type AIReceiptLog } from "../lib/custom-ai/trade-settlement";
import type { CustomAIPublicToken } from "../lib/custom-ai/public-types";
import type { AITradeSession } from "../lib/custom-ai/trade-types";
const address = (n:number) => `0x${n.toString(16).padStart(40,"0")}` as Address;
const account=address(1),manager=address(2),router=address(3),quote=address(4),coin=address(5),hook=address(6),ledger=address(7),vault=address(8);
const poolId=`0x${"ab".repeat(32)}` as Hex;
const token={tokenAddress:coin,quoteAsset:quote,hookAddress:hook,ledger,rewardVault:vault,poolId} as CustomAIPublicToken;
function transfer(asset:Address,from:Address,to:Address,value:bigint):AIReceiptLog {
  return {address:asset,topics:encodeEventTopics({abi:transferABI,eventName:"Transfer",args:{from,to}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:"uint256"}],[value])};
}
function swap(buy:boolean):AIReceiptLog {
  return {address:hook,topics:encodeEventTopics({abi:aiSwapEventABI,eventName:"CustomAISwap",args:{poolId,router}}) as [Hex,...Hex[]],
    data:encodeAbiParameters([{type:"bool"},{type:"bool"},{type:"uint256"},{type:"uint256"},{type:"uint256"},{type:"uint16"},{type:"uint8"}],
      [buy,true,10000n,50n,250n,250,0])};
}
function settled(buy:boolean,received=buy?20n:9700n):AIReceiptLog {
  return {address:router,topics:encodeEventTopics({abi:aiRouterSettlementABI,eventName:"SwapSettled",args:{payer:account,recipient:account,input:buy?quote:coin}}) as [Hex,...Hex[]],
    data:encodeAbiParameters([{type:"address"},{type:"uint256"},{type:"uint256"}],[buy?coin:quote,buy?10000n:20n,received])};
}
function session(buy:boolean):AITradeSession {
  return {account,intent:buy?"buy":"sell",quote:{input:buy?quote:coin,output:buy?coin:quote,amount:buy?"10000":"20",minimum:buy?"19":"9600"}} as AITradeSession;
}
describe("Custom AI receipt settlement",()=> {
  it("requires exact buy input, minimum token output and both fee buckets",()=> {
    const logs=[swap(true),transfer(quote,account,manager,10000n),transfer(coin,manager,account,20n),settled(true)];
    expect(verifyAISwapSettlement(logs,session(true),token,router)).toEqual({paid:"10000",received:"20",platform:"50",additional:"250"});
    expect(()=>verifyAISwapSettlement(logs.slice(0,3),session(true),token,router)).toThrow("router settlement");
    expect(()=>verifyAISwapSettlement([...logs,logs[0]],session(true),token,router)).toThrow("swap settlement");
  });
  it("matches sell proceeds after the fee deductions",()=> {
    const logs=[swap(false),transfer(coin,account,manager,20n),transfer(quote,manager,account,9700n),settled(false)];
    expect(verifyAISwapSettlement(logs,session(false),token,router).received).toBe("9700");
    logs[3]=settled(false,9800n);
    expect(()=>verifyAISwapSettlement(logs,session(false),token,router)).toThrow("transfer settlement");
  });
  it("accepts a platform claim only when the fixed treasury actually receives it",()=> {
    const recipient="0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
    const abi=parseAbi(["event FeesClaimed(address indexed recipient,bool indexed platform,uint256 amount)"]);
    const event:AIReceiptLog={address:ledger,topics:encodeEventTopics({abi,eventName:"FeesClaimed",args:{recipient,platform:true}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:"uint256"}],[50n])};
    const logs=[event,transfer(quote,manager,recipient,50n)];
    expect(verifyAIClaimSettlement(logs,"claim-platform",token,account,account)).toEqual({recipient,amount:"50"});
    expect(()=>verifyAIClaimSettlement([{...event,address:quote}],"claim-platform",token,account,account)).toThrow("claim settlement");
    expect(verifyAIClaimSettlement([event],"claim-platform",token,account,account).amount).toBe("50");
  });
  it("matches creator payouts to the bound creator instead of the transaction caller",()=> {
    const creator=address(9),abi=parseAbi(["event Claimed(address indexed beneficiary,bool creator,uint256 amount)"]);
    const event:AIReceiptLog={address:vault,topics:encodeEventTopics({abi,eventName:"Claimed",args:{beneficiary:creator}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:"bool"},{type:"uint256"}],[true,250n])};
    expect(verifyAIClaimSettlement([event,transfer(quote,vault,creator,250n)],"claim-creator",token,account,creator)).toEqual({recipient:creator,amount:"250"});
    expect(()=>verifyAIClaimSettlement([event,transfer(quote,vault,creator,250n)],"claim-reward",token,account,creator)).toThrow("claim settlement");
  });
});
