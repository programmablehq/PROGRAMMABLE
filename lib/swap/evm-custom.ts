import { Actions, URVersion, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { HYPEREVM_CUSTOM_ROOTS_V1 } from "@/lib/custom-launch/hyperevm-release-v1";
import { BASE_CUSTOM_ROOTS_V1 } from "@/lib/custom-launch/base-release-v1";
import type { EvmCustomChainId } from "@/lib/evm-custom-chains";
import { customV4PoolId, type CustomV4PoolKey } from "./custom-v4";

export const EVM_SWAP_SCHEMA = "programmable.evm-custom-swap.v1";
export const NATIVE = "0x0000000000000000000000000000000000000000" as Address;
export const EVM_SWAP_PROTOCOLS = {
  999: { ...HYPEREVM_CUSTOM_ROOTS_V1, permit2:"0x000000000022D473030F116dDEE9F6B43aC78BA3", poolManagerHash:"0x7846a5013818d482274dd4895ff7a7190967ec6a4936fa071f3fbd48a7d2d5be", universalRouterHash:"0x0710561487244e5d288bd93fe4c055a4a33fd486a07e8b4c982124c57c6d3224", permit2Hash:"0x10f4ff92b79ad2dca1393ef990940a13e25fb56afd1ff4a6e15853b069020da0", routerHash:"0x46b8df86a30338c9ad41b19c96194970fcc3ea3d2f4062f2353a6ae90fcccbdc" },
  8453: { ...BASE_CUSTOM_ROOTS_V1, permit2:"0x000000000022D473030F116dDEE9F6B43aC78BA3", poolManagerHash:"0x83b2af6e9f3158defc2811cbcb0db71ecf8b2ba2abea39c39e370ac5c6f43eb6", universalRouterHash:"0x816c75fe7f6ccf8fe8b14825091e8dff301fe7ffd4b962f89b2981a747facc08", permit2Hash:"0xa67739abc3ede9dbdc0491636c67d6a14ac07fab9030c3f509b1eb7b11dff8ed", routerHash:"" },
} as const;
export const EVM_TOKEN_ABI = parseAbi(["function balanceOf(address) view returns(uint256)","function allowance(address,address) view returns(uint256)","function approve(address,uint256) returns(bool)","function decimals() view returns(uint8)"]);
export const EVM_PERMIT2_ABI = parseAbi(["function allowance(address,address,address) view returns(uint160,uint48,uint48)","function approve(address,address,uint160,uint48)"]);
const ROUTER_ABI = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const address = /^0x[0-9a-f]{40}$/i, hash = /^0x[0-9a-f]{64}$/i, decimal=/^(0|[1-9][0-9]{0,77})$/;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export interface EvmCustomSwapRequest { chainId:EvmCustomChainId;token:Address;owner:Address;buy:boolean;amountIn:string;slippageBps:number;deadline:string }
export interface EvmCustomSwapDescriptor {chainId:EvmCustomChainId;token:Address;creator:Address;poolId:Hex;poolKey:CustomV4PoolKey;launchId:Hex;launchTransaction:Hex;stampHash:Hex;tokenDecimals:number;quoteDecimals:number;quoteSymbol:string;quoteAsset:Address}
export interface EvmCustomSwapTransaction {kind:"swap"|"token-approval"|"permit2-approval";from:Address;to:Address;data:Hex;value:string;gasLimit:string}
export interface EvmCustomSwapPreparation {schemaVersion:typeof EVM_SWAP_SCHEMA;status:"ready"|"approval-required";request:EvmCustomSwapRequest;descriptor:EvmCustomSwapDescriptor;
 quote:{amountOut:string;minimumOut:string;blockNumber:string;blockHash:Hex;validUntil:number};transaction:EvmCustomSwapTransaction;preparationDigest:`sha256:${string}`}
export function parseEvmCustomSwapRequest(value:unknown):EvmCustomSwapRequest {
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid swap request");const v=value as EvmCustomSwapRequest;
 if(Object.keys(v).sort().join()!=="amountIn,buy,chainId,deadline,owner,slippageBps,token" || ![8453,999].includes(v.chainId) || typeof v.token!=="string" || typeof v.owner!=="string" || !address.test(v.token) || !address.test(v.owner)
  || same(v.owner,NATIVE)||same(v.token,NATIVE)||typeof v.buy!=="boolean"||typeof v.amountIn!=="string"||!decimal.test(v.amountIn)||BigInt(v.amountIn)<=0n||BigInt(v.amountIn)>=(1n<<128n)
  ||!Number.isInteger(v.slippageBps)||v.slippageBps<1||v.slippageBps>500||typeof v.deadline!=="string"||!decimal.test(v.deadline))throw Error("Invalid swap request");
 return {...v,token:getAddress(v.token),owner:getAddress(v.owner)};
}
export function validateEvmCustomSwapDescriptor(d:EvmCustomSwapDescriptor):void {
 if(!d || Object.keys(d).sort().join()!=="chainId,creator,launchId,launchTransaction,poolId,poolKey,quoteAsset,quoteDecimals,quoteSymbol,stampHash,token,tokenDecimals"
 || ![8453,999].includes(d.chainId) || ![d.token,d.creator,d.quoteAsset].every(v=>typeof v==="string"&&address.test(v))
 || ![d.poolId,d.launchId,d.launchTransaction,d.stampHash].every(v=>typeof v==="string"&&hash.test(v))
 || ![d.tokenDecimals,d.quoteDecimals].every(v=>Number.isInteger(v)&&v>=0&&v<=36) || typeof d.quoteSymbol!=="string" || d.quoteSymbol.length>20
 || !d.poolKey || Object.keys(d.poolKey).sort().join()!=="currency0,currency1,fee,hooks,tickSpacing"
 || ![d.poolKey.currency0,d.poolKey.currency1,d.poolKey.hooks].every(v=>typeof v==="string"&&address.test(v))
 || same(d.token,NATIVE) || same(d.token,d.quoteAsset) || !same(customV4PoolId(d.poolKey),d.poolId)) throw Error("Invalid swap market");
}
export function buildEvmCustomSwap(descriptor:EvmCustomSwapDescriptor,request:EvmCustomSwapRequest,minimumOut:string):EvmCustomSwapTransaction {
 validateEvmCustomSwapDescriptor(descriptor);
 const protocol=EVM_SWAP_PROTOCOLS[request.chainId];
 if(!protocol||descriptor.chainId!==request.chainId||!same(request.token,descriptor.token)||!hash.test(descriptor.poolId)||!same(customV4PoolId(descriptor.poolKey),descriptor.poolId)
  ||![descriptor.poolKey.currency0,descriptor.poolKey.currency1].some(a=>same(a,request.token))||!decimal.test(minimumOut))throw Error("Swap market binding changed");
 const quoteAsset=same(descriptor.poolKey.currency0,request.token)?descriptor.poolKey.currency1:descriptor.poolKey.currency0;
 const input=request.buy?quoteAsset:request.token,output=request.buy?request.token:quoteAsset;
 if(!same(quoteAsset,descriptor.quoteAsset))throw Error("Quote asset changed");
 const planner=new V4Planner();const recent=request.chainId===999;
 const version=recent?URVersion.V2_1_1:URVersion.V2_0;
 planner.addAction(Actions.SWAP_EXACT_IN_SINGLE,[{poolKey:descriptor.poolKey,zeroForOne:same(input,descriptor.poolKey.currency0),amountIn:request.amountIn,amountOutMinimum:minimumOut,...(recent?{minHopPriceX36:"0"}:{}),hookData:"0x"}],version);
 planner.addAction(Actions.SETTLE_ALL,[input,request.amountIn],version);
 planner.addAction(Actions.TAKE_ALL,[output,minimumOut],version);
 const route=new RoutePlanner();const routerVersion=recent?UniversalRouterVersion.V2_1_1:UniversalRouterVersion.V2_0;
 route.addCommand(CommandType.V4_SWAP,[planner.finalize()],false,routerVersion);
 if(same(input,NATIVE))route.addCommand(CommandType.SWEEP,[NATIVE,"0x0000000000000000000000000000000000000001",0],false,routerVersion);
 return {kind:"swap",from:request.owner,to:getAddress(protocol.universalRouter),data:encodeFunctionData({abi:ROUTER_ABI,functionName:"execute",args:[route.commands as Hex,route.inputs as Hex[],BigInt(request.deadline)]}),value:same(input,NATIVE)?request.amountIn:"0",gasLimit:"1"};
}
export function buildEvmCustomApproval(request:EvmCustomSwapRequest,descriptor:EvmCustomSwapDescriptor,kind:"token-approval"|"permit2-approval"):EvmCustomSwapTransaction {
 validateEvmCustomSwapDescriptor(descriptor);
 if(descriptor.chainId!==request.chainId||!same(descriptor.token,request.token))throw Error("Approval market changed");
 const token=request.buy?descriptor.quoteAsset:request.token;
 if(same(token,NATIVE)||!["token-approval","permit2-approval"].includes(kind))throw Error("Invalid token approval");const p=EVM_SWAP_PROTOCOLS[request.chainId];
 return {kind,from:request.owner,to:getAddress(kind==="token-approval"?token:p.permit2),value:"0",gasLimit:"1",data:kind==="token-approval"?
  encodeFunctionData({abi:EVM_TOKEN_ABI,functionName:"approve",args:[getAddress(p.permit2),BigInt(request.amountIn)]}):encodeFunctionData({abi:EVM_PERMIT2_ABI,functionName:"approve",args:[token,getAddress(p.universalRouter),BigInt(request.amountIn),Number(request.deadline)]})};
}
export const evmCustomPreparationDigest=(value:Omit<EvmCustomSwapPreparation,"preparationDigest">)=>canonicalBrowserSha256V2(EVM_SWAP_SCHEMA,value);
export function validateEvmCustomSwapPreparation(value:unknown,expected:Pick<EvmCustomSwapRequest,"chainId"|"owner"|"token">):EvmCustomSwapPreparation {
 if(!value||typeof value!=="object")throw Error("Invalid swap preparation");const p=value as EvmCustomSwapPreparation,r=parseEvmCustomSwapRequest(p.request),now=Math.floor(Date.now()/1000);
 if(Object.keys(p).sort().join()!=="descriptor,preparationDigest,quote,request,schemaVersion,status,transaction"||Object.keys(p.quote??{}).sort().join()!=="amountOut,blockHash,blockNumber,minimumOut,validUntil"||p.schemaVersion!==EVM_SWAP_SCHEMA||r.chainId!==expected.chainId||!same(r.token,expected.token)||!same(r.owner,expected.owner)||r.deadline.length>11||BigInt(r.deadline)<=BigInt(now)||BigInt(r.deadline)>BigInt(now+1200)
  ||!p.quote||!decimal.test(p.quote.amountOut)||!decimal.test(p.quote.minimumOut)||BigInt(p.quote.minimumOut)<=0n||BigInt(p.quote.minimumOut)!==BigInt(p.quote.amountOut)*BigInt(10000-r.slippageBps)/10000n
  ||!hash.test(p.quote.blockHash)||!decimal.test(p.quote.blockNumber)||!Number.isSafeInteger(p.quote.validUntil)||p.quote.validUntil<=now||p.quote.validUntil>now+40
  ||!p.transaction||!decimal.test(p.transaction.gasLimit)||BigInt(p.transaction.gasLimit)>20000000n||BigInt(p.transaction.gasLimit)<21000n)throw Error("Swap quote expired or changed");
 const tx=p.transaction.kind==="swap"?buildEvmCustomSwap(p.descriptor,r,p.quote.minimumOut):buildEvmCustomApproval(r,p.descriptor,p.transaction.kind);
 if(p.status!==(tx.kind==="swap"?"ready":"approval-required")||canonicalBrowserJsonV2({...tx,gasLimit:p.transaction.gasLimit})!==canonicalBrowserJsonV2(p.transaction))throw Error("Swap transaction changed");
 const {preparationDigest,...body}=p;if(preparationDigest!==evmCustomPreparationDigest(body))throw Error("Swap preparation changed");return p;
}

export const EVM_FEE_CLAIM_SCHEMA="programmable.evm-custom-fee-claim.v1";
export const EVM_FEE_VAULT_ABI=parseAbi(["function kernel() view returns(address)","function poolManager() view returns(address)","function creatorRecipient() view returns(address)","function PLATFORM_RECIPIENT() view returns(address)","function creatorAccrued() view returns(uint256)","function platformAccrued() view returns(uint256)","function claimCreator() returns(uint256)","function claimPlatform() returns(uint256)"]);
export interface EvmFeeClaimPreparation {
 schemaVersion:typeof EVM_FEE_CLAIM_SCHEMA;request:{chainId:999;token:Address;owner:Address;vaultKind:"fees"|"opening";recipientKind:"creator"|"platform"};
 descriptor:EvmCustomSwapDescriptor;vault:Address;recipient:Address;amount:string;validUntil:number;
 transaction:{from:Address;to:Address;data:Hex;value:"0";gasLimit:string};preparationDigest:`sha256:${string}`;
}
export function validateEvmFeeClaimPreparation(value:unknown,expected:{chainId:number;owner:Address;token:Address}):EvmFeeClaimPreparation {
 const p=value as EvmFeeClaimPreparation;if(!p||p.schemaVersion!==EVM_FEE_CLAIM_SCHEMA||!p.request||p.request.chainId!==999||expected.chainId!==999||!same(p.request.owner,expected.owner)||!same(p.request.token,expected.token)
 ||!["fees","opening"].includes(p.request.vaultKind)||!["creator","platform"].includes(p.request.recipientKind)||!address.test(p.vault)||!address.test(p.recipient)||!decimal.test(p.amount)||BigInt(p.amount)<=0n||!Number.isSafeInteger(p.validUntil)||p.validUntil<=Date.now()/1000||p.validUntil>Date.now()/1000+45)throw Error("Fee claim expired or changed");
 validateEvmCustomSwapDescriptor(p.descriptor);
 const expectedData=encodeFunctionData({abi:EVM_FEE_VAULT_ABI,functionName:p.request.recipientKind==="creator"?"claimCreator":"claimPlatform"});
 if(!same(p.request.token,p.descriptor.token)||p.transaction.from!==p.request.owner||p.transaction.to!==p.vault||p.transaction.value!=="0"||p.transaction.data!==expectedData||!decimal.test(p.transaction.gasLimit)||BigInt(p.transaction.gasLimit)<21000n||BigInt(p.transaction.gasLimit)>1000000n)throw Error("Fee claim transaction changed");
 const {preparationDigest,...body}=p;if(preparationDigest!==canonicalBrowserSha256V2(EVM_FEE_CLAIM_SCHEMA,body))throw Error("Fee claim changed");return p;
}
