import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { encodeLaunchValue } from "@/lib/custom-ai/wallet";
import { advanceAITrade, createAITrade, dispatchAITrade, loadAITrade, saveAITrade } from "@/lib/custom-ai/trade.server";
import { readAIMarketBalances } from "@/lib/custom-ai/market.server";
import type { AITradeIntent } from "@/lib/custom-ai/trade-types";

export const runtime="nodejs";
export const maxDuration=120;
const errorResponse=(error:unknown)=>aiError(error instanceof CustomAIError?error:new CustomAIError("unavailable","The network check could not finish. Your saved transaction is unchanged.",503));
export async function GET(request:Request) {
  try {
    const authority=await authorizeCustomAI(request);
    if (authority.kind!=="account") throw new CustomAIError("auth","Connect your wallet to continue.",401);
    const params=new URL(request.url).searchParams,account=getAddress(params.get("account")??"");
    if (!authority.principal.wallets.some(value=>getAddress(value)===account)) throw new CustomAIError("wallet","Reconnect the selected wallet.",403);
    const store=productionAIStore();
    await store.consume(authority.owner,"trade-read",180);
    if (params.get("balances")==="true") {
      const chainId=Number(params.get("chain"));
      if (chainId!==1 && chainId!==4663) throw new CustomAIError("chain","Choose a supported chain.");
      return Response.json(await readAIMarketBalances(chainId,getAddress(params.get("token")??""),account),{headers:aiHeaders});
    }
    const id=await store.activeLaunch(authority.owner,account,"trade");
    return new Response(encodeLaunchValue(id?await loadAITrade(store,authority.owner,id):null),{headers:{...aiHeaders,"Content-Type":"application/json"}});
  } catch(error) {return errorResponse(error);}
}
export async function POST(request:Request) {
  try {
    const authority=await authorizeCustomAI(request);
    if (authority.kind!=="account") throw new CustomAIError("auth","Connect your wallet to continue.",401);
    const input=await readPreviewBody(request) as {action:string;id:string;stepId?:string;hash?:string;account:string;chainId:number;token:string;intent:AITradeIntent;amount:string;slippageBps:number};
    if (!input || !/^[a-zA-Z0-9-]{16,64}$/.test(input.id) || !["create","next","retry","dispatch","submitted","rejected"].includes(input.action)) throw new CustomAIError("input","Invalid trade request.");
    const store=productionAIStore();
    await store.consume(authority.owner,"trade",240);
    let saved=input.action==="create"?await createAITrade(store,authority.owner,authority.principal.wallets,input):await loadAITrade(store,authority.owner,input.id);
    if (!authority.principal.wallets.some(value=>getAddress(value)===saved.session.account)) throw new CustomAIError("wallet","Reconnect the wallet used for this trade.",403);
    if (input.action==="retry") {
      if (saved.session.state!=="failed" || saved.session.steps.at(-1)?.state!=="failed") throw new CustomAIError("step","Check the saved transaction before trying again.",409);
      saved.session.state="preparing";saved=await saveAITrade(store,authority.owner,saved);
    }
    if (["create","next","retry"].includes(input.action)) saved=await advanceAITrade(store,authority.owner,saved);
    else if (input.action==="dispatch") saved=await dispatchAITrade(store,authority.owner,saved,input.stepId??"");
    else {
      const step=saved.session.steps.at(-1);
      if (!step || step.id!==input.stepId || !["dispatching","submitted"].includes(step.state)) throw new CustomAIError("step","Refresh the saved transaction before continuing.",409);
      if (input.action==="submitted") {
        if (!/^0x[0-9a-f]{64}$/i.test(input.hash??"") || step.hash && step.hash.toLowerCase()!==input.hash?.toLowerCase()) throw new CustomAIError("hash","The transaction hash differs from this saved trade.",409);
        step.hash=input.hash!.toLowerCase() as `0x${string}`;step.state="submitted";
      } else {
        if (step.hash || step.state!=="dispatching") throw new CustomAIError("sent","This transaction was already sent. Check its status.",409);
        step.state="prepared";step.walletRejected=true;saved.session.state="ready";
      }
      saved=await saveAITrade(store,authority.owner,saved);
    }
    return new Response(encodeLaunchValue(saved),{headers:{...aiHeaders,"Content-Type":"application/json"}});
  } catch(error) {return errorResponse(error);}
}
