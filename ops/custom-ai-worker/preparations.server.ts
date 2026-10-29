import "server-only";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { customAIChain } from "../../lib/custom-ai/chain.server";
import { matchesRuntime } from "../../lib/custom-ai/runtime";
import { bytesV1 } from "../../lib/server/custom-launch/routed-trade-rpc-v1";
import code from "../../lib/custom-ai/composable-code.json";
import { checkedExecutionPrice, type PriceObservation } from "./price-history";
const artifacts=code.contracts as unknown as Record<string,{abi:Abi;runtimeTemplate:Hex;immutableReferences:Record<string,{start:number;length:number}[]>}>;
type Configuration={factory:Address;creator:Address;launchSalt:Hex;allocator:Address;actionId:Hex;quote:Address;maximumBatch:bigint;
  maximumDeviationBps:number;interval:bigint;maxPriceAge:bigint;minimumObservations:number;minimumHistory:bigint;priceFeed:Address};

export function pendingProgramFunds(value:{programBalance:bigint;allocated:bigint;claimed:bigint;totalCollected:bigint;weight:bigint;totalWeight:bigint;
  ledgerPending:bigint;vaultBalance:bigint;vaultAccounted:bigint;vaultTotalReceived:bigint;creatorReceived:bigint;creatorShareBps:bigint;availableRewards:bigint;routerClaimable:bigint}) {
  if(Object.values(value).some(n=>n<0n)||value.totalWeight===0n||value.weight>value.totalWeight||value.creatorShareBps>10000n
    ||value.vaultBalance<value.vaultAccounted||value.claimed>value.allocated)throw Error("Invalid allocation accounting");
  const incoming=value.vaultBalance-value.vaultAccounted+value.ledgerPending;
  const creatorTotal=(value.vaultTotalReceived+incoming)*value.creatorShareBps/10000n;
  if(creatorTotal<value.creatorReceived)throw Error("Invalid creator accounting");
  const received=value.routerClaimable+value.availableRewards+incoming-(creatorTotal-value.creatorReceived);
  const allocated=(value.totalCollected+received)*value.weight/value.totalWeight;
  if(allocated<value.allocated)throw Error("Invalid router accounting");
  return value.programBalance+allocated-value.claimed;
}

/** Canonical PoolManager storage observation, tied to the agreed block. */
export async function readPoolObservation(chainId:1|4663,poolId:Hex):Promise<PriceObservation> {
  const chain=await customAIChain(chainId);
  const slot=keccak256(encodeAbiParameters([{type:"bytes32"},{type:"uint256"}],[poolId,6n]));
  const value=await chain.call(chain.profile.infrastructure.poolManager.address,"function extsload(bytes32) view returns(bytes32)",[slot]) as Hex;
  const sqrtPriceX96=BigInt(value)&((1n<<160n)-1n);
  if(sqrtPriceX96===0n)throw Error("The canonical pool is not initialized");
  await chain.finish();
  return {blockNumber:chain.block.number,blockHash:chain.block.hash,timestamp:Number(chain.block.timestamp),sqrtPriceX96:sqrtPriceX96.toString()};
}

/** Only prepares a bounded call; the durable journal owns signing and broadcasting. */
export async function prepareLiquidityOperation(input:{chainId:1|4663;program:Address;history:{chainId:number;poolId:Hex;observations:PriceObservation[]};priceSigningKey:Hex}) {
  const chain=await customAIChain(input.chainId),artifact=artifacts.CustomAILiquidityProgramV1;
  if(!matchesRuntime(await chain.code(input.program),artifact))throw Error("Unrecognized liquidity program");
  const call=async(name:string,args:unknown[]=[])=>decodeFunctionResult({abi:artifact.abi,functionName:name,
    data:await chain.agreed("eth_call",[{to:input.program,data:encodeFunctionData({abi:artifact.abi,functionName:name,args})},chain.reference],bytesV1)});
  const c=await call("config") as unknown as Configuration|readonly unknown[];
  // Solidity's public struct getter returns an ordered tuple.
  const p=(Array.isArray(c)?Object.fromEntries(["factory","creator","launchSalt","allocator","actionId","quote","maximumBatch","maximumDeviationBps","interval","maxPriceAge","minimumObservations","minimumHistory","priceFeed"].map((k,i)=>[k,c[i]])):c) as Configuration;
  const launchAbi=parseAbi(["function launchOf(address,bytes32) view returns((bytes32 planHash,bytes32 poolId,address token,address hook,address ledger,address rewardVault,address liquidityVault,uint128 liquidity,uint128 tokenPrincipal,uint128 tokenRounding,uint256 initialBuyTokens))"]);
  const launch=decodeFunctionResult({abi:launchAbi,functionName:"launchOf",data:await chain.agreed("eth_call",[{to:p.factory,data:encodeFunctionData({abi:launchAbi,functionName:"launchOf",args:[p.creator,p.launchSalt]})},chain.reference],bytesV1)});
  if(launch.token==="0x0000000000000000000000000000000000000000"||input.history.chainId!==input.chainId||input.history.poolId!==launch.poolId)throw Error("Missing history for the bound canonical pool");
  const rule=await chain.call(launch.hook,"function feeModule() view returns(address)") as Address;
  const launched=await chain.call(launch.hook,"function launchTimestamp() view returns(uint64)") as bigint;
  const [active,eventId,validUntil]=await chain.call(rule,"function actionState(bytes32,uint64) view returns(bool,bytes32,uint64)",[p.actionId,launched]) as [boolean,Hex,bigint];
  if(!active||validUntil<BigInt(chain.block.timestamp))throw Error("The event does not permit this action");
  const configurationHash=await call("configurationHash") as Hex;
  const executionId=keccak256(encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[configurationHash,eventId]));
  const [done,nextExecution,balance,allocated,claimed,signer]=await Promise.all([
    call("executed",[executionId]),call("nextExecution"),chain.call(p.quote,"function balanceOf(address) view returns(uint256)",[input.program]),
    chain.call(p.allocator,"function allocated(bytes32) view returns(uint256)",[p.actionId]),chain.call(p.allocator,"function claimed(bytes32) view returns(uint256)",[p.actionId]),
    chain.call(p.priceFeed,"function signer() view returns(address)"),
  ]);
  if(done||BigInt(String(nextExecution))>BigInt(chain.block.timestamp))throw Error("This action is already settled or not due");
  const readUint=(target:Address,name:string)=>chain.call(target,`function ${name}() view returns(uint256)`) as Promise<bigint>;
  const [ledgerReceived,ledgerClaimed,vaultBalance,vaultAccounted,vaultTotalReceived,creatorReceived,creatorShareBps,availableRewards,routerClaimable,totalCollected,totalWeight]=await Promise.all([
    readUint(launch.ledger,"additionalReceived"),readUint(launch.ledger,"additionalClaimed"),
    chain.call(p.quote,"function balanceOf(address) view returns(uint256)",[launch.rewardVault]) as Promise<bigint>,readUint(launch.rewardVault,"accountedBalance"),readUint(launch.rewardVault,"totalReceived"),
    readUint(launch.rewardVault,"creatorReceived"),chain.call(launch.rewardVault,"function creatorShareBps() view returns(uint16)") as Promise<number>,readUint(launch.rewardVault,"availableRewards"),
    chain.call(launch.rewardVault,"function claimable(address) view returns(uint256)",[p.allocator]) as Promise<bigint>,readUint(p.allocator,"totalCollected"),readUint(p.allocator,"totalWeight"),
  ]);
  let weight=0n;
  for(let i=0;i<4;i++){
    try{const [id,,w]=await chain.call(p.allocator,"function destinations(uint256) view returns(bytes32,address,uint16)",[BigInt(i)]) as [Hex,Address,number];if(id===p.actionId){weight=BigInt(w);break;}}
    catch{break;}
  }
  if(!weight)throw Error("The action is not a registered allocation destination");
  const available=pendingProgramFunds({programBalance:BigInt(String(balance)),allocated:BigInt(String(allocated)),claimed:BigInt(String(claimed)),totalCollected,weight,totalWeight,
    ledgerPending:ledgerReceived-ledgerClaimed,vaultBalance,vaultAccounted,vaultTotalReceived,creatorReceived,creatorShareBps:BigInt(creatorShareBps),availableRewards,routerClaimable});
  const amount=available<BigInt(p.maximumBatch)?available:BigInt(p.maximumBatch);
  if(amount<2n)throw Error("Collect the earned fee allocation before compounding");
  const confirmedHistory=input.history.observations.filter(item=>BigInt(item.blockNumber)<BigInt(chain.block.number));
  const reference=checkedExecutionPrice(confirmedHistory,{minimumObservations:Number(p.minimumObservations),minimumHistorySeconds:Number(p.minimumHistory),maxAgeSeconds:Number(p.maxPriceAge),deviationBps:Number(p.maximumDeviationBps)},Number(chain.block.timestamp));
  if(BigInt(reference.blockNumber)>=BigInt(chain.block.number))throw Error("Wait for the price observation block to finalize");
  const account=privateKeyToAccount(input.priceSigningKey);
  if(account.address.toLowerCase()!==String(signer).toLowerCase())throw Error("Incorrect execution price reporter");
  const quote={program:input.program,poolId:launch.poolId,executionId,amount,sqrtPriceX96:BigInt(reference.sqrtPriceX96),observedAt:BigInt(reference.observedAt),
    validUntil:BigInt(reference.observedAt)+BigInt(p.maxPriceAge),blockNumber:BigInt(reference.blockNumber),blockHash:reference.blockHash as Hex,
    observations:reference.observations,historySeconds:BigInt(reference.historySeconds)};
  await chain.finish();
  const signature=await account.signTypedData({domain:{name:"Programmable execution price",version:"1",chainId:input.chainId,verifyingContract:p.priceFeed},primaryType:"ExecutionPrice",
    types:{ExecutionPrice:[{name:"program",type:"address"},{name:"poolId",type:"bytes32"},{name:"executionId",type:"bytes32"},{name:"amount",type:"uint256"},{name:"sqrtPriceX96",type:"uint160"},{name:"observedAt",type:"uint64"},{name:"validUntil",type:"uint64"},{name:"blockNumber",type:"uint64"},{name:"blockHash",type:"bytes32"},{name:"observations",type:"uint32"},{name:"historySeconds",type:"uint64"}]},message:quote});
  const priceProof=encodeAbiParameters(parseAbiParameters("(address program,bytes32 poolId,bytes32 executionId,uint256 amount,uint160 sqrtPriceX96,uint64 observedAt,uint64 validUntil,uint64 blockNumber,bytes32 blockHash,uint32 observations,uint64 historySeconds),bytes"),[quote,signature]);
  return {executionId,to:input.program,data:encodeFunctionData({abi:artifact.abi,functionName:"execute",args:[executionId,amount,0n,quote.validUntil,priceProof]})};
}
