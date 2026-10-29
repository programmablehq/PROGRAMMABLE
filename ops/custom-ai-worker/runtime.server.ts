import "server-only";
import { createHash } from "node:crypto";
import { getAddress, keccak256, parseAbi, encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AIPool, AIStore } from "../../lib/custom-ai/store.server";
import { customAIChain } from "../../lib/custom-ai/chain.server";
import { currentCustomAIDeployment } from "../../lib/custom-ai/deployment.server";
import { matchesRuntime } from "../../lib/custom-ai/runtime";
import { createOperationJournal, type Operation } from "../../lib/custom-ai/operation-journal.server";
import { prepareObservedFeedUpdate } from "../../lib/custom-ai/feed-update.server";
import { readFeedSource } from "../../lib/custom-ai/feed-adapters/source.server";
import type { FeedSnapshot } from "../../lib/custom-ai/rule-evaluator";
import code from "../../lib/custom-ai/composable-code.json";
import { appendPriceObservation, type PriceObservation } from "./price-history";
import { createScheduler, type PollSource } from "./scheduler";
import { discoverProgramTargets, listProgramTargets, type ProgramTarget } from "./discovery";
import { prepareLiquidityOperation, readPoolObservation } from "./preparations.server";
import { createSignedWorkerAdapter, type PreparedOperation } from "./adapter.server";
import { runWorkerOnce } from "./main";
import type { WorkerNetwork } from "./config";

const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const artifacts=code.contracts as unknown as Record<string,Parameters<typeof matchesRuntime>[1]>;
export type CoinOperationStatus={chainId:1|4663;token:string;checkedAt:number;state:"warming"|"ready"|"queued"|"blocked";
  liquidityRaw:string|null;lastTransactionHash?:string;nextExecutionAt?:number;reason?:string};
type Prepared={call:PreparedOperation;expiresAt:number;chainId:1|4663;bundleHash:string};
export function createWorkerRuntime(pool:AIPool,store:AIStore,networks:WorkerNetwork[],env:Readonly<Record<string,string|undefined>>=process.env) {
  const journal=createOperationJournal(pool),scheduler=createScheduler(pool);
  const key=(name:string)=>{const value=env[name];if(!value||!/^0x[0-9a-f]{64}$/i.test(value))throw Error("Worker signing credential is unavailable");return value as Hex;};
  const save=async(kind:string,id:string,value:unknown)=>{const prior=await store.readObject("system",kind,id);await store.saveObject("system",kind,id,value,prior?.revision??0);};
  async function queue(kind:Operation["kind"],chainId:1|4663,eventId:string,prepared:Omit<Prepared,"chainId"|"bundleHash">){
    const op=await journal.enqueue({kind,chainId,eventId,target:prepared.call.to,dueAt:Date.now()});
    if(op&&!op.rawTransaction&&!['confirmed','skipped','failed','attention'].includes(op.state))await save("worker-prepared",op.id,{...prepared,chainId,bundleHash:code.bundleHash});
  }
  async function validate(network:WorkerNetwork){
    const chain=await customAIChain(network.chainId);
    if(!matchesRuntime(await chain.code(network.programFactory),artifacts.CustomAIProgramFactoryV1))throw Error("Worker program factory is not source verified");
    if(String(await chain.call(network.programFactory,"function core() view returns(address)")).toLowerCase()!==currentCustomAIDeployment(network.chainId)?.factory.address.toLowerCase())throw Error("Worker core binding differs");
    const prices=getAddress(String(await chain.call(network.programFactory,"function prices() view returns(address)")));
    if(!matchesRuntime(await chain.code(prices),artifacts.CustomAIExecutionPriceFeedV1)||String(await chain.call(prices,"function signer() view returns(address)")).toLowerCase()!==privateKeyToAccount(key(network.priceKeyEnv)).address.toLowerCase())throw Error("Worker price reporter differs");
    const signer=privateKeyToAccount(key(network.signerKeyEnv)).address;
    const balance=BigInt(await chain.agreed("eth_getBalance",[signer,chain.reference],v=>String(v)));
    const used=await store.readObject<{reserved:string}>("system","worker-budget",`worker-${network.chainId}-${Math.floor(Date.now()/86400000)}`);
    const funded=balance>=network.transactionLimitWei&&BigInt(used?.value.reserved??"0")+network.transactionLimitWei<=network.dailyLimitWei;
    let feedsReady=true;
    for(const f of network.feeds){
      const runtime=await chain.code(f.binding.address);
      if(keccak256(runtime)!==f.binding.runtimeHash)throw Error("Worker data feed changed");
      const snapshot=await chain.call(f.binding.address,"function latestSnapshot() view returns(uint64,uint64,int256,int256,uint64,uint64,uint64,bool)") as readonly unknown[];
      feedsReady&&=snapshot[7]===true;
    }
    await chain.finish();
    return {funded,feedsReady,blockHash:chain.block.hash};
  }
  const feedKey=(version:string,id:string)=>hash(`${version}:${id}`);
  async function pollSources(){
    const unique=new Map(networks.flatMap(n=>n.feeds.map(f=>[feedKey(f.binding.sourceVersion,f.binding.id),f] as const)));
    const sources:PollSource[]=[...unique].map(([id,feed])=>({id:`source:${id}`,intervalMs:Math.max(15000,Math.min(300000,feed.definition.maxAgeSeconds*500)),run:async()=>{
      const prior=await store.readObject<FeedSnapshot>("system","feed-cache",id);
      const observation=await readFeedSource(feed.definition,prior?.value);
      await save("feed-cache",id,observation);
    }}));
    await scheduler.run(sources,4);
    for(const n of networks)for(const f of n.feeds){
      const cached=(await store.readObject<FeedSnapshot>("system","feed-cache",feedKey(f.binding.sourceVersion,f.binding.id)))?.value;
      if(!cached||cached.validUntil*1000<=Date.now())continue;
      await scheduler.run([{id:`feed:${n.chainId}:${f.binding.id}`,intervalMs:60000,run:async()=>{
        const prepared=await prepareObservedFeedUpdate({feed:f.binding,chainId:n.chainId,signingKey:key(f.signerKeyEnv),readObservation:async previous=>{
          if(previous&&cached.observedAt===previous.observedAt&&cached.value!==previous.value)throw Error("The source conflicts with its original observation");
          return cached;
        }});
        if(prepared)await queue("feed",n.chainId,`source:${f.binding.id}:${cached.observedAt}`,{call:prepared.transaction,expiresAt:cached.validUntil*1000});
      }}],1);
    }
  }
  async function pollProgram(network:WorkerNetwork,target:ProgramTarget){
    const statusId=hash(`${target.chainId}:${target.token.toLowerCase()}`);
    const previous=(await store.readObject<CoinOperationStatus>("system","coin-operation",statusId))?.value;
    const status:CoinOperationStatus={...previous,chainId:target.chainId,token:target.token,checkedAt:Date.now(),state:"warming",liquidityRaw:previous?.liquidityRaw??null,reason:undefined,nextExecutionAt:undefined};
    try{
      const chain=await customAIChain(network.chainId);
      const core=currentCustomAIDeployment(network.chainId)!;
      const result=await chain.call(core.factory.address,"function launchOf(address,bytes32) view returns(bytes32,bytes32,address,address,address,address,address,uint128,uint128,uint128,uint256)",[target.creator,target.launchSalt]) as readonly unknown[];
      if(String(result[2]).toLowerCase()!==target.token.toLowerCase()||target.bundleHash!==code.bundleHash)throw Error("Confirmed launch binding changed");
      const poolId=String(result[1]) as Hex;
      const historyId=hash(`${network.chainId}:${poolId}`);
      await scheduler.run([{id:`price:${network.chainId}:${poolId}`,intervalMs:30000,run:async()=>{
        const previous=await store.readObject<{observations:PriceObservation[]}>("system","price-history",historyId);
        const observation=await readPoolObservation(network.chainId,poolId);
        await save("price-history",historyId,{observations:appendPriceObservation(previous?.value.observations??[],observation)});
      }}],1);
      const history=(await store.readObject<{observations:PriceObservation[]}>("system","price-history",historyId))?.value.observations??[];
      status.liquidityRaw="0";
      for(let i=0;i<target.programs.length;i++){
        if(target.binding.spec.actions[i]?.kind!=="liquidity")continue;
        const program=target.programs[i];
        if(!matchesRuntime(await chain.code(program),artifacts.CustomAILiquidityProgramV1))throw Error("Program runtime differs");
        status.liquidityRaw=(BigInt(status.liquidityRaw??"0")+BigInt(String(await chain.call(program,"function liquidity() view returns(uint128)")))).toString();
        status.nextExecutionAt=Number(await chain.call(program,"function nextExecution() view returns(uint256)"))*1000;
        if(history.length<target.binding.spec.actions[i].minimumObservations)continue;
        try{
          const prepared=await prepareLiquidityOperation({chainId:network.chainId,program,history:{chainId:network.chainId,poolId,observations:history},priceSigningKey:key(network.priceKeyEnv)});
          await queue("execute",network.chainId,`liquidity:${prepared.executionId}`,{call:prepared,expiresAt:Date.now()+20000});
          status.state="queued";
        }catch(error){
          const message=error instanceof Error?error.message:"";
          if(/price observation|price history/.test(message)){if(status.state!=="queued")status.state="warming";}
          else if(/already settled|not due|does not permit|earned fee/.test(message)){if(status.state!=="queued")status.state="ready";}
          else throw error;
        }
      }
      await chain.finish();
      const db=await pool.connect();try{
        const row=(await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='operation' AND value->>'state'='confirmed' AND lower(value->>'target')=ANY($1::text[]) AND value->>'chainId'=$2 ORDER BY updated_at DESC LIMIT 1",[target.programs.map(p=>p.toLowerCase()),String(target.chainId)])).rows[0];
        const operation=row?.value as Operation|undefined;if(operation?.transactionHash)status.lastTransactionHash=operation.transactionHash;
      }finally{db.release();}
    }catch{status.state="blocked";status.liquidityRaw=previous?.liquidityRaw??null;status.reason="The execution service could not verify the latest pool or program state.";}
    await save("coin-operation",statusId,status);
  }
  return {async tick(){
    if(env.CUSTOM_AI_WORKER_ACTIVE!=="true")throw Error("The worker has not been activated");
    const checks=new Map<1|4663,Awaited<ReturnType<typeof validate>>>();
    for(const network of networks)checks.set(network.chainId,await validate(network));
    await discoverProgramTargets(pool);
    await pollSources();
    const cursorId=hash("worker-target-page"),cursor=await store.readObject<{after:string}>("system","worker-cursor",cursorId);
    const page=await listProgramTargets(pool,cursor?.value.after??"",8);
    await scheduler.run(page.items.map(target=>({id:`program:${target.chainId}:${target.token}`,intervalMs:30000,run:async()=>{
      const network=networks.find(n=>n.chainId===target.chainId);if(network)await pollProgram(network,target);
    }})),8,4);
    await save("worker-cursor",cursorId,{after:page.next});
    const due=await journal.due(8);
    const authorities=await Promise.all(due.map(async op=>({op,prepared:(await store.readObject<Prepared>("system","worker-prepared",op.id))?.value})));
    const adapters=networks.map(n=>{
      const targets=new Map<string,Set<string>>();
      const update=encodeFunctionData({abi:parseAbi(["function update(uint64,int256,uint64,uint64,bytes)"]),functionName:"update",args:[1n,0n,1n,2n,"0x"]}).slice(0,10);
      const execute=encodeFunctionData({abi:parseAbi(["function execute(bytes32,uint256,uint128,uint64,bytes)"]),functionName:"execute",args:[`0x${"0".repeat(64)}`,0n,0n,0n,"0x"]}).slice(0,10);
      for(const {op,prepared}of authorities)if(op.chainId===n.chainId&&prepared?.bundleHash===code.bundleHash&&prepared.chainId===n.chainId
        &&prepared.call.to.toLowerCase()===op.target.toLowerCase()&&prepared.call.data.slice(0,10)===(op.kind==="feed"?update:execute))targets.set(op.target.toLowerCase(),new Set([prepared.call.data.slice(0,10)]));
      const rpcUrls=n.rpcEnvs.map(e=>{const url=env[e];if(!url||new URL(url).protocol!=="https:")throw Error("Worker RPC is unavailable");return url;}) as [string,string];
      return createSignedWorkerAdapter({chainId:n.chainId,rpcUrls,signingKey:key(n.signerKeyEnv),targets,dailyLimitWei:n.dailyLimitWei,transactionLimitWei:n.transactionLimitWei,
        prepare:async(op)=>{const p=(await store.readObject<Prepared>("system","worker-prepared",op.id))?.value;
          if(p&&p.expiresAt<=Date.now()&&op.kind==="feed")return null;
          if(!p||p.expiresAt<=Date.now())throw Error("The operation needs a fresh prepared call");return p.call;},
        readOnly:async()=>{throw Error("The runtime only dispatches prepared financial calls");},
        health:async()=>{const check=checks.get(n.chainId)!;const capacityReady=page.total<=8;const observation=(ready:boolean)=>({status:ready?"ready" as const:"blocked" as const,checkedAt:Date.now(),validUntil:Date.now()+120000,evidenceHash:hash(`${code.bundleHash}:${n.chainId}:${check.blockHash}:${ready}:${page.total}`)});return {feeds:observation(check.funded&&check.feedsReady),prices:observation(check.funded&&capacityReady),programs:observation(check.funded&&capacityReady)};},
      });
    });
    return {...await runWorkerOnce(pool,adapters),watchedPrograms:page.total,programCapacity:8};
  }};
}
