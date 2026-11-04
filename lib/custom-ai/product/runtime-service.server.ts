import "server-only";
import {getAddress} from "viem";
import {requireFreshCustomAIAuthority,type AIAuthority} from "../auth.server";
import type {createCustomAIBackendLaunchBridge} from "../backend-launch.server";
import type {createProductionDependencyRpcs} from "../dependency-rpc.server";
import type {AIStore} from "../store.server";
import {CustomAIError} from "../types";
import {readProductRuntimeSource} from "./runtime-source.server";
import {productRuntimeAnchor} from "./runtime-anchor.server";
import {observeProductRuntime} from "./runtime-observer.server";
import type {ProductRuntime} from "./runtime";
import {sharedProductRead,type SharedProductRead} from "./shared-read.server";

/** Account-scoped, requested snapshots. No polling, reindexing or signing. */
export function createProductRuntimeReader(deps:{store:()=>AIStore;bridge:()=>Pick<ReturnType<typeof createCustomAIBackendLaunchBridge>,"resource">;
  rpcs:ReturnType<typeof createProductionDependencyRpcs>;now?:()=>number}){
  const now=deps.now??Date.now;
  type Cell={until:number;account?:string;value?:ProductRuntime;pending?:SharedProductRead<ProductRuntime>;error?:CustomAIError};
  const cache=new Map<string,Cell>();
  const currentCell=(key:string)=>{
    const cell=cache.get(key);
    if(cell&&(cell.pending?.aborted||!cell.pending&&cell.until<=now())){cache.delete(key);return undefined;}
    return cell;
  };
  const makeRoom=()=>{
    while(cache.size>=128){const oldest=[...cache].find(([,entry])=>!entry.pending);if(!oldest)throw new CustomAIError("product-runtime-busy","Contract checks are busy. Try again shortly.",429,2000);cache.delete(oldest[0]);}
  };
  return async(request:Request,authority:AIAuthority,id:string):Promise<ProductRuntime>=>{
    const current=requireFreshCustomAIAuthority(request,authority);
    request.signal.throwIfAborted();
    if(request.method!=="GET"||!/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(id))throw new CustomAIError("product-runtime-input","Open the original saved product.",400);
    const key=JSON.stringify([current.owner,id]);
    let cell=currentCell(key);
    if(!cell){
      makeRoom();
      // Keep authenticated transport on the exact request that obtained its
      // authority. Only public onchain observations can outlive a caller.
      const source=await readProductRuntimeSource(deps.store(),current.owner,id);
      const account=getAddress(source.controller);
      requireFreshCustomAIAuthority(request,authority);
      if(!current.principal.wallets.some(wallet=>getAddress(wallet)===account))throw new CustomAIError("wallet","Reconnect the wallet that launched this product.",403);
      let anchor:ReturnType<typeof productRuntimeAnchor>;
      try{
        const reply=await deps.bridge().resource(request,authority,{chainId:source.chainId,account:source.controller,resourceId:source.resourceId});
        requireFreshCustomAIAuthority(request,authority);
        anchor=productRuntimeAnchor(reply,source);
      }catch(error){
        request.signal.throwIfAborted();
        const failure=error instanceof CustomAIError?error:new CustomAIError("product-runtime-unconfirmed","The deployed contracts could not be confirmed yet. Your product is saved.",503);
        if(!currentCell(key)){makeRoom();cache.set(key,{account,error:failure,until:now()+([401,403,409].includes(failure.status)?0:15_000)});}
        throw failure;
      }
      cell=currentCell(key);
      if(!cell){
        makeRoom();const entry:Cell={until:0,account};cache.set(key,entry);cell=entry;
        entry.pending=sharedProductRead(async(signal)=>{try{
          signal.throwIfAborted();
          const result=await observeProductRuntime(source,anchor,deps.rpcs(source.chainId),{signal,now});
          entry.value=result;entry.until=now()+60_000;return result;
        }catch(error){
          if(signal.aborted){if(cache.get(key)===entry)cache.delete(key);throw error;}
          entry.error=error instanceof CustomAIError?error:new CustomAIError("product-runtime-unconfirmed","The deployed contracts could not be confirmed yet. Your product is saved.",503);
          entry.until=now()+([401,403].includes(entry.error.status)?0:15_000);throw entry.error;
        }finally{delete entry.pending;}},30_000);
      }
    }
    if(cell.account&&!current.principal.wallets.some(wallet=>getAddress(wallet)===cell.account))throw new CustomAIError("wallet","Reconnect the wallet that launched this product.",403);
    if(cell.error)throw cell.error;
    const result=cell.pending?await cell.pending.wait(request.signal):cell.value!;
    requireFreshCustomAIAuthority(request,authority);
    if(!current.principal.wallets.some(wallet=>getAddress(wallet)===cell.account))throw new CustomAIError("wallet","Reconnect the wallet that launched this product.",403);
    return structuredClone(result);
  };
}
