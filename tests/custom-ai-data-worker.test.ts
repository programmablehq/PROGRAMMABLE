import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {parseWorkerConfig} from "../ops/custom-ai-worker/config";
import {createJSONDataAdapter} from "../lib/custom-ai/feed-adapters/json.server";
import manifest from "../lib/custom-ai/composable-manifest.json";

const adapter=createJSONDataAdapter({version:1,name:"Funding rate",url:"https://data.example.com/funding",valuePath:["rate"],timestampPath:["time"],timestampFormat:"unix-seconds",decimals:4,minimum:"-10000",maximum:"10000",maxAgeSeconds:60,values:null});
const config=()=>({version:1,bundleHash:manifest.bundleHash,networks:[{chainId:1,programFactory:`0x${"1".repeat(40)}`,signerKeyEnv:"CUSTOM_AI_WORKER_SIGNER",priceKeyEnv:"CUSTOM_AI_PRICE_SIGNER",rpcEnvs:["CUSTOM_AI_RPC_PRIMARY","CUSTOM_AI_RPC_SECONDARY"],transactionLimitWei:"1000",dailyLimitWei:"5000",feeds:[{
  binding:{id:adapter.id,sourceVersion:adapter.implementationHash,address:`0x${"2".repeat(40)}`,runtimeHash:`0x${"a".repeat(64)}`,runtimeCode:"0x6000",minimum:"-10000",maximum:"10000",maxAge:60},
  definition:{kind:"json",id:adapter.id,sourceVersion:adapter.implementationHash,maxAgeSeconds:60,adapter},signerKeyEnv:"CUSTOM_AI_DATA_SIGNER",
}]}]});
describe("explicit data source worker bindings",()=>{
  it("accepts a matching signed-range adapter without changing the existing transaction budgets",()=>{
    const value=parseWorkerConfig(JSON.stringify(config()));
    expect(value[0].feeds[0].definition.kind).toBe("json");
    expect(value[0].transactionLimitWei).toBe(1000n);expect(value[0].dailyLimitWei).toBe(5000n);
    expect(value[0].feeds[0].binding.minimum).toBe("-10000");
  });
  it("rejects a substituted parser, source version or freshness bound before worker execution",()=>{
    for(const change of ["version","scale","age"]){
      const value=config(),feed=value.networks[0].feeds[0];
      if(change==="version")feed.definition.sourceVersion=`sha256:${"b".repeat(64)}`;
      if(change==="scale")feed.definition.adapter={...adapter,definition:{...adapter.definition,decimals:5}};
      if(change==="age")feed.definition.maxAgeSeconds=120;
      expect(()=>parseWorkerConfig(JSON.stringify(value))).toThrow();
    }
  });
});
