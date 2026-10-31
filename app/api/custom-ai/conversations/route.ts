import { getAddress } from "viem";
import { authorizeCustomAI } from "@/lib/custom-ai/auth.server";
import { productionAIStore } from "@/lib/custom-ai/store.server";
import { aiError, aiHeaders } from "@/lib/custom-ai/http.server";
import { readPreviewBody } from "@/lib/custom-ai/access.server";
import { CustomAIError } from "@/lib/custom-ai/types";
import { LEGACY_CONVERSATION } from "@/lib/custom-ai/conversation";
export const runtime="nodejs";
async function context(request:Request,value:unknown){
  const authority=await authorizeCustomAI(request);
  if(authority.kind!=="account")throw new CustomAIError("auth","Connect your wallet to see your chats.",401);
  if(typeof value!=="string"||!/^0x[0-9a-f]{40}$/i.test(value))throw new CustomAIError("wallet","Select your connected wallet.");
  const account=getAddress(value);
  if(!authority.principal.wallets.some(w=>getAddress(w)===account))throw new CustomAIError("wallet","Select your connected wallet.",403);
  return {owner:authority.owner,account,store:productionAIStore()};
}
export async function GET(request:Request){
  try{
    const query=new URL(request.url).searchParams,{owner,account,store}=await context(request,query.get("account"));
    await store.consume(owner,"conversation-list",120);
    const id=query.get("id");
    if(id){const chat=await store.conversations.read(owner,account,id);if(!chat)throw new CustomAIError("missing","That chat was not found.",404);return Response.json(chat,{headers:aiHeaders});}
    const page=await store.conversations.list(owner,account,{search:query.get("q")??"",archived:query.get("archived")==="true",cursor:query.get("cursor")??undefined});
    return Response.json(page,{headers:aiHeaders});
  }catch(error){return aiError(error);}
}
export async function POST(request:Request){
  try{
    const input=await readPreviewBody(request) as {account:string;action:string;id:string;revision:number;title?:string;archived?:boolean};
    if(!input||typeof input!=="object")throw new CustomAIError("input","Choose a chat action.");
    const {owner,account,store}=await context(request,input.account);
    await store.consume(owner,"conversation-write",120);
    const result=input.action==="bootstrap"?await store.conversations.create(owner,account,LEGACY_CONVERSATION)
      :input.action==="create"?await store.conversations.create(owner,account,input.id)
      :input.action==="update"?await store.conversations.update(owner,account,input.id,input.revision,{title:input.title,archived:input.archived})
      :undefined;
    if(!result)throw new CustomAIError("input","Choose a chat action.");
    return Response.json(result,{headers:aiHeaders});
  }catch(error){return aiError(error);}
}
