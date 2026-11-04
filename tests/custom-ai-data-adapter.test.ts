import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { createJSONDataAdapter, normalizeJSONObservation, type JSONAdapterDefinition } from "../lib/custom-ai/feed-adapters/json.server";
import { createDataAdapterLibrary } from "../lib/custom-ai/feed-adapters/library.server";
import { parsePublicDataJSON, publicDataAddress, publicDataURL } from "../lib/custom-ai/feed-adapters/public-json.server";
import type { AIStore } from "../lib/custom-ai/store.server";
import dataAdapterTool from "../lib/custom-ai/capabilities/data-adapter/index.server";
import { dispatchTool } from "../lib/custom-ai/capabilities/dispatch.server";
import {runCustomAI} from "../lib/custom-ai/service.server";
import {EMPTY_COIN_SETUP} from "../lib/custom-ai/coin-setup";
import type {ClaudeInput} from "../lib/custom-ai/claude.server";

const now=1800000000;
const definition:JSONAdapterDefinition={version:1,name:"Weather condition",url:"https://data.example.com/current",valuePath:["current","value"],timestampPath:["current","time"],timestampFormat:"unix-seconds",decimals:3,minimum:"-100000",maximum:"100000",maxAgeSeconds:60,values:null};
const payload=(value="12.345",time=now-10)=>({current:{value,time}});
function store(){
  const records=new Map<string,{revision:number;value:unknown}>();
  return {records,
    async readObject<T>(owner:string,kind:string,id:string){const value=records.get(`${owner}:${kind}:${id}`);return value?structuredClone(value) as {revision:number;value:T}:null;},
    async saveObject(owner:string,kind:string,id:string,value:unknown,revision:number){const key=`${owner}:${kind}:${id}`,current=records.get(key);if((current?.revision??0)!==revision)throw Object.assign(Error("conflict"),{code:"conflict"});records.set(key,{revision:revision+1,value:structuredClone(value)});return revision+1;},
    async listObjects<T>(owner:string,kind:string,limit=10001,after=""){return [...records.entries()].filter(([key])=>key.startsWith(`${owner}:${kind}:`)&&key.slice(`${owner}:${kind}:`.length)>after).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([,item])=>structuredClone(item.value) as T);},
  } satisfies Pick<AIStore,"readObject"|"saveObject"|"listObjects"> & {records:Map<string,{revision:number;value:unknown}>};
}

describe("versioned public data adapters",()=>{
  it("preserves exact numeric source digits before JSON number rounding",()=>{
    const data=parsePublicDataJSON('{"current":{"value":0.123456789012345678,"time":1799999990}}');
    const adapter=createJSONDataAdapter({...definition,decimals:18,minimum:"0",maximum:"1000000000000000000"});
    expect(normalizeJSONObservation(adapter,data,now).value).toBe("123456789012345678");
  });
  it("binds units, field mapping and freshness to a stable implementation identity",()=>{
    const adapter=createJSONDataAdapter(definition),original=normalizeJSONObservation(adapter,payload(),now);
    expect(adapter.id).toMatch(/^adapter-[a-f0-9]{56}$/);
    expect(createJSONDataAdapter({...definition}).implementationHash).toBe(adapter.implementationHash);
    expect(createJSONDataAdapter({...definition,maxAgeSeconds:61}).id).not.toBe(adapter.id);
    expect(original).toMatchObject({value:"12345",observedAt:now-10,validUntil:now+50,fresh:true,sequence:"1",transitionSequence:"0"});
    expect(normalizeJSONObservation(adapter,payload(),now,original)).toEqual(original);
    const next=normalizeJSONObservation(adapter,payload("13.000",now-5),now,original);
    expect(next).toMatchObject({value:"13000",previousValue:"12345",sequence:"2",transitionSequence:"1",changedAt:now-5});
    expect(()=>normalizeJSONObservation(adapter,payload("14.000",now-10),now,original)).toThrow();
  });
  it("requires a timestamp and rejects stale, future, lossy or out-of-range observations",()=>{
    const adapter=createJSONDataAdapter(definition);
    for(const value of [payload("1",now-61),payload("1",now+1),payload("999999"),payload("1.1234"),payload("1e3"),payload("NaN"),payload(1.123 as unknown as string),{current:{value:"1"}}])expect(()=>normalizeJSONObservation(adapter,value,now)).toThrow();
    expect(()=>normalizeJSONObservation(adapter,payload(),now,{...normalizeJSONObservation(adapter,payload(),now),sourceVersion:"wrong"})).toThrow();
  });
  it("normalizes explicit millisecond and timezone-bearing ISO timestamps",()=>{
    const milliseconds=createJSONDataAdapter({...definition,timestampFormat:"unix-milliseconds"});
    expect(normalizeJSONObservation(milliseconds,payload("1",(now-10)*1000+123),now).observedAt).toBe(now-10);
    const iso=createJSONDataAdapter({...definition,timestampFormat:"iso8601"});
    expect(normalizeJSONObservation(iso,{current:{value:"1",time:new Date((now-10)*1000+123).toISOString()}},now).observedAt).toBe(now-10);
    expect(()=>normalizeJSONObservation(iso,{current:{value:"1",time:"2027-01-15 08:00:00"}},now)).toThrow();
  });
  it("maps only explicitly declared categorical values",()=>{
    const adapter=createJSONDataAdapter({...definition,values:{rain:"1",clear:"0"},decimals:0});
    expect(normalizeJSONObservation(adapter,payload("rain"),now).value).toBe("1");
    expect(()=>normalizeJSONObservation(adapter,payload("snow"),now)).toThrow();
    expect(()=>createJSONDataAdapter({...definition,valuePath:["__proto__"]})).toThrow();
  });
  it("saves a reusable adapter privately only after a real parsed observation",async()=>{
    const db=store(),read=vi.fn(async(adapter,prior)=>({observation:normalizeJSONObservation(adapter,payload(),now,prior),responseHash:`sha256:${"a".repeat(64)}` as const}));
    const alice=createDataAdapterLibrary(db,"alice",read),bob=createDataAdapterLibrary(db,"bob",read);
    const first=await alice.create(definition),again=await alice.create(definition);
    expect(read).toHaveBeenCalledOnce();expect(first.reused).toBe(false);expect(again.reused).toBe(true);
    expect(first).toMatchObject({onchainBinding:"not-configured",qualification:"parsed-observation-only",transactions:false});
    expect((await alice.list()).items.map(item=>item.id)).toEqual([first.id]);expect((await bob.list()).items).toEqual([]);
    await expect(bob.read(first.id)).rejects.toThrow("not found");
    expect((await alice.read(first.id)).observation.value).toBe("12345");
    const rejected=createDataAdapterLibrary(db,"charlie",async()=>{throw Error("source unavailable");});
    await expect(rejected.create(definition)).rejects.toThrow("unavailable");
    expect((await rejected.list()).items).toEqual([]);
  });
  it("enforces owner binding, the existing tool budget and the closed adapter schema",async()=>{
    const db=store(),read=vi.fn(async(adapter,prior)=>({observation:normalizeJSONObservation(adapter,payload(),now,prior),responseHash:`sha256:${"a".repeat(64)}` as const}));
    const library=createDataAdapterLibrary(db,"alice",read),context={owner:"alice",chainId:8453 as const,allowWeb:false,budget:{remaining:2},dataAdapters:library};
    const created=await dispatchTool(dataAdapterTool.ref,{action:"create",definition},context,[dataAdapterTool]);
    expect(created.status).toBe("data-adapter-observation");
    const id=(created.facts as {id:string}).id;
    await dispatchTool(dataAdapterTool.ref,{action:"read",id},context,[dataAdapterTool]);
    expect(context.budget.remaining).toBe(0);
    await expect(dispatchTool(dataAdapterTool.ref,{action:"list"},context,[dataAdapterTool])).rejects.toMatchObject({code:"lookup_budget"});
    await expect(dispatchTool(dataAdapterTool.ref,{action:"read",id},{...context,owner:"bob",budget:{remaining:2}},[dataAdapterTool])).rejects.toMatchObject({code:"capability"});
    await expect(dispatchTool(dataAdapterTool.ref,{action:"create",definition:{...definition,headers:{Authorization:"secret"}}},{...context,budget:{remaining:2}},[dataAdapterTool])).rejects.toMatchObject({code:"capability_input"});
  });
  it("paginates a private library without omitting versions or reading another owner",async()=>{
    const db=store(),read=async(adapter:ReturnType<typeof createJSONDataAdapter>)=>({observation:normalizeJSONObservation(adapter,payload(),now),responseHash:`sha256:${"a".repeat(64)}` as const});
    const library=createDataAdapterLibrary(db,"alice",read);
    for(let n=0;n<22;n++)await library.create({...definition,name:`Source ${n}`});
    const first=await library.list(),second=await library.list(first.nextCursor!);
    expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(2);expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(22);
    expect((await createDataAdapterLibrary(db,"bob",read).list()).items).toEqual([]);
  });
  it("builds a private data reader through the normal chat planner without generating a contract",async()=>{
    const instruction="Plan a private reader for the public weather code. Do not generate or launch a contract.";
    const db=store(),read=async(adapter:ReturnType<typeof createJSONDataAdapter>)=>({observation:normalizeJSONObservation(adapter,payload(),now),responseHash:`sha256:${"a".repeat(64)}` as const});
    const library=createDataAdapterLibrary(db,"alice",read),adapter=createJSONDataAdapter(definition);
    const envelope={reply:"The private reader is prepared.",replyLocale:"en",action:"answer",executionRoute:"custom-contract",intentMode:"revise",
      intentRequirements:[{id:"source",text:"Observe the public weather code",kind:"behavior",instruction,open:null}],ruleEdits:[],memory:"Public weather reader",implementedRequirementIds:[],setupPatch:{},feeChecks:[],program:null,eventRule:null,composable:null,launchRequested:false,reviseChecks:false};
    let calls=0;
    const call=vi.fn(async(input:ClaudeInput)=>{
      const second=calls++>0;if(second)expect(input.system).toContain(adapter.id);
      return {text:JSON.stringify({...envelope,lookups:second?[]:[{kind:"data_adapter",input:{action:"create",definition}}],productPlan:second?{
        components:[{id:"weather-reader",kind:"adapter",name:"Weather reader",purpose:"Observe the public source",requirementIds:["source"],dependsOn:[]}],assets:[],flows:[],services:[{component:"weather-reader",capability:adapter.id,trigger:"external-event",failurePolicy:"pause-action",requirementIds:["source"]}],interfaceActions:[],
      }:null}),inputTokens:1,outputTokens:1};
    });
    const compile=vi.fn(async()=>{throw Error("No compilation expected");});
    const result=await runCustomAI({id:"data-adapter-chat-0001",intent:"chat",coin:{...EMPTY_COIN_SETUP,chainId:8453},messages:[{role:"user",content:instruction}]},undefined,{call,compile},{owner:"alice",dataAdapters:library});
    expect(result.productBlueprint?.services[0].capability).toBe(adapter.id);expect(call).toHaveBeenCalledTimes(2);expect(compile).not.toHaveBeenCalled();
    expect((await library.list()).items[0].id).toBe(adapter.id);
  });
  it.each(["127.0.0.1","10.1.2.3","100.100.100.200","169.254.169.254","168.63.129.16","192.168.1.1","198.18.0.1","224.0.0.1","::1","::ffff:127.0.0.1","fc00::1","fe80::1","2001:db8::1","2002:7f00:1::","3fff::1"])("does not permit private or special destination %s",address=>{
    expect(publicDataAddress(address)).toBe(false);
  });
  it("limits endpoints to public credential-free HTTPS",()=>{
    for(const url of ["http://data.example.com","https://localhost","https://metadata.google.internal","https://user:secret@data.example.com","https://data.example.com:8443/x","https://127.0.0.1/x","https://2130706433/x","https://data.example.com/x?api_key=secret"] )expect(()=>publicDataURL(url)).toThrow();
    expect(publicDataAddress("8.8.8.8")).toBe(true);expect(publicDataAddress("2606:4700:4700::1111")).toBe(true);
    expect(publicDataURL(definition.url).href).toBe(definition.url);
  });
});
