import "server-only";
import { defineTool } from "../definition.server";
import { readUnifiedLaunches } from "@/lib/server/unified-explore";

export default defineTool("search_hooks", "Find examples of indexed Programmable custom hooks by coin name, ticker or address. Use them as references; catalog membership is not a code audit or permission to copy an unknown contract.", async (input,context)=>{
  const {query,chain}=input as {query:string;chain:"current"|"all"};
  context.signal?.throwIfAborted();
  const result=await readUnifiedLaunches(1,query,{sort:"newest",mode:"custom",chain:chain==="current"?context.chainId:"all"},6);
  const retrievedAt=new Date().toISOString();
  const items=result.items.filter(item=>item.mode==="custom").map(item=>({chainId:item.chainId,name:item.name,symbol:item.symbol,
    tokenAddress:item.tokenAddress,hookAddress:"hookAddress" in item?item.hookAddress:null,
    url:`https://programmable.market/token/${item.tokenAddress}?chain=${item.chainId}`}));
  return {status:result.status,facts:{items,updatedAt:result.updatedAt,source:"indexed launch identities",
    limitations:"These are launch references. Read the actual source and explain any unsupported behavior before building a new hook."},
    sources:items.map(item=>({title:`${item.name||item.symbol||"Custom hook"} · Programmable`,url:item.url,retrievedAt}))};
},()=>true,{type:"object",properties:{query:{type:"string",minLength:1,maxLength:128},chain:{enum:["current","all"]}},required:["query","chain"],additionalProperties:false});
