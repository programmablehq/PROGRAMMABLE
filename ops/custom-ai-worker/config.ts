import { getAddress, type Address } from "viem";
import type { RuleFeedBinding } from "../../lib/custom-ai/rule-compiler.server";
import type { FeedDefinition } from "../../lib/custom-ai/feed-adapters/source.server";
import manifest from "../../lib/custom-ai/composable-manifest.json";

export type WorkerNetwork = { chainId:1|4663; programFactory:Address; signerKeyEnv:string; priceKeyEnv:string;
  rpcEnvs:[string,string]; transactionLimitWei:bigint; dailyLimitWei:bigint;
  feeds:{binding:RuleFeedBinding;definition:FeedDefinition;signerKeyEnv:string}[] };
export function parseWorkerConfig(raw:string):WorkerNetwork[] {
  if(raw.length>128000)throw Error("Worker configuration is too large");
  const v=JSON.parse(raw);
  if(v?.version!==1||v.bundleHash!==manifest.bundleHash||!Array.isArray(v.networks)||!v.networks.length||v.networks.length>2)throw Error("Worker configuration does not match this release");
  const env=(x:unknown)=>{if(typeof x!=="string"||!/^CUSTOM_AI_[A-Z0-9_]{1,70}$/.test(x))throw Error("Invalid worker credential reference");return x;};
  const result:WorkerNetwork[]=v.networks.map((n:Record<string,unknown>)=>{
    if(![1,4663].includes(Number(n.chainId))||!Array.isArray(n.rpcEnvs)||n.rpcEnvs.length!==2||!Array.isArray(n.feeds)||n.feeds.length>4)throw Error("Invalid worker network");
    const budget=(x:unknown)=>{if(typeof x!=="string"||!/^\d{1,30}$/.test(x)||BigInt(x)<=0n)throw Error("An explicit positive worker budget is required");return BigInt(x);};
    const transactionLimitWei=budget(n.transactionLimitWei),dailyLimitWei=budget(n.dailyLimitWei);
    if(transactionLimitWei>dailyLimitWei)throw Error("Transaction budget exceeds daily budget");
    const feeds=(n.feeds as WorkerNetwork["feeds"]).map(f=>{
      const d=f.definition,b=f.binding;
      if(!d||!b||!/^[-a-z0-9]{1,64}$/.test(b.id)||b.id!==d.id||b.sourceVersion!==d.sourceVersion||!/^0x[0-9a-f]{64}$/i.test(b.runtimeHash)||!/^0x[0-9a-f]+$/i.test(b.runtimeCode)
        ||!/^\d{1,30}$/.test(b.minimum)||!/^\d{1,30}$/.test(b.maximum)||BigInt(b.minimum)>BigInt(b.maximum)
        ||d.maxAgeSeconds!==b.maxAge||!Number.isSafeInteger(b.maxAge)||b.maxAge<60||b.maxAge>3600)throw Error("Invalid worker data source");
      if(d.kind==="market"){
        if(d.sourceVersion!=="programmable-market-usd6-v1"||d.unit!=="micro-USD"||![1,4663].includes(d.chainId)||!/^0x[0-9a-f]{40}$/i.test(d.token)||!["priceUsd","marketCapUsd","volume24hUsd"].includes(d.metric))throw Error("Invalid market data source");
      }else{
        if(d.kind!=="model"||d.unit!=="mm"||!Number.isFinite(d.latitude)||Math.abs(d.latitude)>90||!Number.isFinite(d.longitude)||Math.abs(d.longitude)>180)throw Error("Invalid weather data source");
        const url=new URL(d.endpoint);
        if(url.origin!=="https://customer-api.open-meteo.com"||url.pathname!=="/v1/forecast"||url.search||url.hash)throw Error("Production weather requires the configured commercial source");
      }
      return {binding:{...b,address:getAddress(b.address)},definition:d,signerKeyEnv:env(f.signerKeyEnv)};
    });
    return {chainId:Number(n.chainId) as 1|4663,programFactory:getAddress(String(n.programFactory)),signerKeyEnv:env(n.signerKeyEnv),priceKeyEnv:env(n.priceKeyEnv),
      rpcEnvs:n.rpcEnvs.map(env) as [string,string],transactionLimitWei,dailyLimitWei,feeds};
  });
  if(new Set(result.map(n=>n.chainId)).size!==result.length)throw Error("Duplicate worker network");
  for(const network of result)if(new Set(network.feeds.map(f=>f.binding.id)).size!==network.feeds.length)throw Error("Duplicate worker source");
  const shared=new Map<string,string>();
  for(const network of result)for(const feed of network.feeds){
    const id=`${feed.binding.id}:${feed.binding.sourceVersion}`,definition=JSON.stringify(feed.definition);
    if(shared.has(id)&&shared.get(id)!==definition)throw Error("Shared source definitions differ between networks");shared.set(id,definition);
  }
  return result;
}
