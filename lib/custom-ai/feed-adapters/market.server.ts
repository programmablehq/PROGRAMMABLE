import "server-only";
import { parseUnits } from "viem";
import type { FeedSnapshot } from "../rule-evaluator";
export type MarketFeedDefinition={id:string;sourceVersion:"programmable-market-usd6-v1";kind:"market";unit:"micro-USD";chainId:1|4663;token:string;
  metric:"priceUsd"|"marketCapUsd"|"volume24hUsd";maxAgeSeconds:number};
export function normalizeMarketObservation(raw:unknown,definition:MarketFeedDefinition,now:number,previous?:FeedSnapshot):FeedSnapshot{
  const result=raw as {items?:{tokenAddress?:string;market?:Record<string,unknown>}[]};
  const items=result?.items;
  if(!Array.isArray(items)||items.length!==1||items[0].tokenAddress?.toLowerCase()!==definition.token.toLowerCase())throw Error("Market identity does not match the feed");
  const market=items[0].market,value=market?.[definition.metric],observedAt=Math.floor(Date.parse(String(market?.observedAt))/1000);
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>=1e18||!Number.isSafeInteger(observedAt)||observedAt>now||now-observedAt>definition.maxAgeSeconds)throw Error("Market observation is unavailable or stale");
  const scaled=parseUnits(value.toFixed(6),6).toString();
  if(previous&&(previous.feedId!==definition.id||previous.sourceVersion!==definition.sourceVersion||observedAt<previous.observedAt))throw Error("Market source version or time changed");
  if(previous&&observedAt===previous.observedAt){if(previous.value!==scaled)throw Error("Market observation conflicts with its recorded value");return previous;}
  const changed=Boolean(previous&&previous.value!==scaled);
  return {feedId:definition.id,sourceVersion:definition.sourceVersion,value:scaled,previousValue:changed?previous!.value:previous?.previousValue??scaled,
    sequence:String(BigInt(previous?.sequence??"0")+1n),transitionSequence:String(BigInt(previous?.transitionSequence??"0")+(changed?1n:0n)),
    changedAt:changed?observedAt:previous?.changedAt??0,observedAt,validUntil:observedAt+definition.maxAgeSeconds,fresh:true};
}
export async function readMarketObservation(definition:MarketFeedDefinition,previous?:FeedSnapshot,signal?:AbortSignal){
  const chain=definition.chainId===1?"ethereum":"robinhood";
  if(!/^0x[0-9a-f]{40}$/i.test(definition.token))throw Error("Invalid market feed token");
  const url=`https://programmable.market/api/explore/${chain}/presentation?token=${definition.token.toLowerCase()}`;
  const response=await fetch(url,{redirect:"error",signal:AbortSignal.any([AbortSignal.timeout(8000),...(signal?[signal]:[])])});
  if(!response.ok){await response.body?.cancel();throw Error("Market feed is unavailable");}
  const reader=response.body?.getReader();if(!reader)throw Error("Market feed is empty");let text="";
  try{while(true){const{done,value}=await reader.read();if(done)break;text+=new TextDecoder().decode(value);if(text.length>64000)throw Error("Market feed exceeds the response bound");}}finally{await reader.cancel().catch(()=>undefined);}
  return normalizeMarketObservation(JSON.parse(text),definition,Math.floor(Date.now()/1000),previous);
}
