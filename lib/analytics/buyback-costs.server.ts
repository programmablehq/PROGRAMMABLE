import "server-only";
import { unstable_cache } from "next/cache";
import { codexQuery } from "@/lib/server/codex-market";
import { completeBuybackCosts, decodeRelayBuybackInput, unpricedBuybacks, type UnpricedBuyback } from "./buyback-costs";
import type { QueryResult } from "./model";

const readCosts = unstable_cache(async (requests: UnpricedBuyback[]) => {
  const inputs = await Promise.all(requests.map(async request=>{
    const response = await fetch("https://rpc.mainnet.chain.robinhood.com", {
      method:"POST", headers:{ "content-type":"application/json" },
      body:JSON.stringify({ jsonrpc:"2.0", id:1, method:"eth_getTransactionReceipt", params:[request.hash] }),
      signal:AbortSignal.timeout(8000), redirect:"error",
    });
    if (!response.ok) throw Error("Buyback receipt unavailable");
    const text=await response.text();
    if (text.length > 2_000_000) throw Error("Buyback receipt too large");
    const input=decodeRelayBuybackInput(request,JSON.parse(text).result);
    if (!input) throw Error("Buyback input not established");
    return input;
  }));
  const query=`query BuybackInputPrices { ${inputs.map((r,i)=>`p${i}: getTokenPrices(inputs:[{address:"${r.address}",networkId:${r.networkId},timestamp:${r.timestamp}}]) { address networkId timestamp priceUsd }`).join(" ")} }`;
  return { inputs, prices:await codexQuery(query,{}) };
},["analytics-relay-buyback-input-costs-v1"],{ revalidate:86400, tags:["programmable-analytics"] });

export async function fillBuybackCosts(result: QueryResult): Promise<QueryResult> {
  if (Number(result.rows[0]?.unpriced_buybacks) === 0) return result;
  const requests=unpricedBuybacks(result);
  if (!requests.length) throw Error("Buyback purchase costs unavailable");
  const {inputs,prices}=await readCosts(requests);
  const completed=completeBuybackCosts(result,inputs,prices);
  if (completed === result) throw Error("Buyback historical prices unavailable");
  return completed;
}
