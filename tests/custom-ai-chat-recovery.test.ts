import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
vi.mock("next/server", async original => ({ ...await original<object>(), after: (task: () => Promise<unknown>) => { void task(); } }));
const runtime = vi.hoisted(() => ({ store: null as unknown, owner: "alice", run: vi.fn(), compile:vi.fn() }));
vi.mock("../lib/custom-ai/auth.server", () => ({ authorizeCustomAI: async () => ({ kind: "account", owner: runtime.owner,principal:{wallets:["0x"+"a".repeat(40)]} }) }));
vi.mock("../lib/custom-ai/service.server", () => ({ runCustomAI: runtime.run }));
vi.mock("../lib/custom-ai/contract-project.server",async original=>({...await original<object>(),compileContractProject:(...args:unknown[])=>runtime.compile(...args)}));
vi.mock("../lib/custom-ai/store.server", async original => ({ ...await original<object>(), productionAIStore: () => runtime.store }));
import { createAIStore, CUSTOM_AI_SCHEMA } from "../lib/custom-ai/store.server";
import { POST, GET } from "../app/api/custom-ai/route";
import { AIRequestError, sendAIChat } from "../lib/custom-ai/client";
import { CustomAIError, type ChatProgress, type ChatRequest } from "../lib/custom-ai/types";
import { reviseLaunchIntent } from "../lib/custom-ai/launch-intent.server";
import {createContractProject,GENERAL_PROJECT_COMPILER} from "../lib/custom-ai/contract-project";
import {canonicalBrowserSha256V2} from "../lib/custom-launch/browser-authority-v2";
import {EMPTY_COIN_SETUP} from "../lib/custom-ai/coin-setup";

let database: PGlite;
const request: ChatRequest = { id: "recovery-request-00001", intent: "chat", messages: [{ role: "user", content: "Make the buy fee 2%." }] };
beforeEach(async () => {
  vi.stubEnv("CUSTOM_AI_PROVIDER", "anthropic");vi.stubEnv("ANTHROPIC_API_KEY", "test-only-configuration");
  runtime.run.mockReset();runtime.compile.mockReset(); runtime.owner = "alice";
  database = new PGlite(); await database.exec(CUSTOM_AI_SCHEMA);
  let queue=Promise.resolve();
  runtime.store = createAIStore({ connect: async () => {
    const previous=queue;let release!:()=>void;queue=new Promise<void>(resolve=>{release=resolve;});await previous;
    return { query: (sql, values) => database.query(sql, values), release };
  } },
    { hourlyUnits: 100, dailyUnits: 200, globalDailyUnits: 300, concurrent: 1 });
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const call = new Request(`https://programmable.market${url}`, init);
    return init?.method === "POST" ? POST(call) : GET(call);
  }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await database.close(); });

describe("durable chat retry and streaming", () => {
  it("ends an unreserved quota rejection without a reconnect or model call",async()=>{
    const store=runtime.store as ReturnType<typeof createAIStore>;
    vi.spyOn(store,"reserve").mockRejectedValueOnce(new CustomAIError("budget","Wait for the hourly reset.",429,1000));
    await expect(sendAIChat(request,async()=>({}),new AbortController().signal)).rejects.toMatchObject({code:"budget",status:429,requestState:"failed"});
    expect(runtime.run).not.toHaveBeenCalled();
    expect(await store.read(runtime.owner,request.id)).toBeNull();
    expect((await store.usage(runtime.owner)).hourly.used).toBe(0);
  });
  async function savedCompilerSource(){
    const store=runtime.store as ReturnType<typeof createAIStore>,account="0x"+"a".repeat(40),chat="legacy-wallet-studio";
    await store.conversations.create(runtime.owner,account,chat);
    const parent:ChatRequest={...request,id:"saved-compiler-source-01",intent:"build",coin:EMPTY_COIN_SETUP,conversation:{account,id:chat,revision:0}};
    const lease=(await store.reserve(runtime.owner,parent)).lease!;
    const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},sources:{"Hook.sol":{content:"pragma solidity 0.8.26; contract Hook {}"}},entrypoints:[{source:"Hook.sol",contract:"Hook",role:"hook"}]},{version:1,id:"design",revision:"a".repeat(64),requirements:[{id:"no-owner",text:"No owner privileges",kind:"constraint",open:null,origin:{kind:"legacy"}}],changes:[],unresolved:[]},1);
    await store.projects.save(runtime.owner,parent.id,lease,project);await store.finish(runtime.owner,parent.id,lease,undefined,"project-compiler");
    const input:ChatRequest={...parent,id:"compile-retry-attempt-01",intent:"compile",compilationOf:{id:parent.id,projectHash:project.hash}};
    return {store,parent,project,input};
  }
  it("recovers compilation through the same job while its model provider is unconfigured, without inference or duplicate compute",async()=>{
    const {store,parent,project,input}=await savedCompilerSource();vi.stubEnv("CUSTOM_AI_PROVIDER","surplus");vi.stubEnv("SURPLUS_API_KEY","");
    const sourceReads=vi.spyOn(store.projects,"read");
    const body={version:1 as const,projectHash:project.hash,compiled:true,compiler:GENERAL_PROJECT_COMPILER,diagnostics:[],contracts:[],verification:"not-run" as const,launchReady:false as const};
    runtime.compile.mockResolvedValue({...body,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",body)});
    const result=await sendAIChat(input,async()=>({}),new AbortController().signal);
    expect(result.generalProject).toMatchObject({projectHash:project.hash,compiled:true,verification:"not-run",launchReady:false});expect(runtime.run).not.toHaveBeenCalled();expect(runtime.compile).toHaveBeenCalledTimes(1);
    expect(await sendAIChat(input,async()=>({}),new AbortController().signal)).toEqual(result);expect(runtime.compile).toHaveBeenCalledTimes(1);expect(sourceReads).toHaveBeenCalledTimes(1);
    expect((await store.read(runtime.owner,parent.id))?.state).toBe("failed");expect((await store.read(runtime.owner,input.id))?.state).toBe("completed");expect((await store.usage(runtime.owner)).hourly.used).toBe(6);
    expect((await store.readObject<{calls:unknown[]}>(runtime.owner,"request-metrics",input.id))?.value.calls).toEqual([]);
  });
  it("keeps another compiler outage terminal while preserving the exact source without calling a model",async()=>{
    const {store,project,input}=await savedCompilerSource();vi.stubEnv("CUSTOM_AI_PROVIDER","surplus");vi.stubEnv("SURPLUS_API_KEY","");runtime.compile.mockRejectedValue(new CustomAIError("project-compiler","Compiler unavailable",503));
    await expect(sendAIChat(input,async()=>({}),new AbortController().signal)).rejects.toMatchObject({status:503,requestState:"failed"});
    expect((await store.projects.read(runtime.owner,input.id))?.project.hash).toBe(project.hash);expect(runtime.run).not.toHaveBeenCalled();expect(runtime.compile).toHaveBeenCalledTimes(1);
    await expect(sendAIChat(input,async()=>({}),new AbortController().signal)).rejects.toMatchObject({status:409,requestState:"failed"});expect(runtime.compile).toHaveBeenCalledTimes(1);
  });
  it("loads a shared draft and conversation job only once",async()=>{
    const store=runtime.store as ReturnType<typeof createAIStore>,prior={...request,id:"previous-context-00001"};
    const lease=(await store.reserve(runtime.owner,prior)).lease!;
    await store.finish(runtime.owner,prior.id,lease,{reply:"Previous design",draft:{source:"saved source",sourceHash:"a".repeat(64),compiled:false,diagnostics:[]}});
    const read=vi.spyOn(store,"read");runtime.run.mockResolvedValueOnce({reply:"The design is kept",change:"unchanged"});
    const response=await POST(new Request("https://programmable.market/api/custom-ai",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...request,draftId:prior.id,contextId:prior.id})}));
    expect(response.status).toBe(200);expect(read.mock.calls.filter(([,id])=>id===prior.id)).toHaveLength(1);expect(runtime.run).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch when cancellation wins immediately after reservation",async()=>{
    const store=runtime.store as ReturnType<typeof createAIStore>,reserve=store.reserve;
    vi.spyOn(store,"reserve").mockImplementationOnce(async(owner,input,profile)=>{
      const reserved=await reserve(owner,input,profile);await store.cancel(owner,input.id);return reserved;
    });
    const response=await POST(new Request("https://programmable.market/api/custom-ai",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)}));
    expect(response.status).toBe(409);expect((await response.json()).code).toBe("cancelled");expect(runtime.run).not.toHaveBeenCalled();
  });
  it("does not report success or success metrics for a reply cancelled before commit", async () => {
    const store=runtime.store as ReturnType<typeof createAIStore>;
    runtime.run.mockImplementationOnce(async()=>{await store.cancel(runtime.owner,request.id);return {reply:"This late reply must not be delivered"};});
    const response=await POST(new Request("https://programmable.market/api/custom-ai",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)}));
    expect(response.status).toBe(409);expect((await response.json()).code).toBe("cancelled");
    expect((await store.read(runtime.owner,request.id))?.result).toBeUndefined();
    const metrics=await store.readObject<{state:string}>(runtime.owner,"request-metrics",request.id);
    expect(metrics?.value.state).toBe("failed");
  });
  it("exposes the saved phase and original request after a stream disconnect", async () => {
    let complete!:()=>void;const waiting=new Promise<void>(resolve=>{complete=resolve;});
    runtime.run.mockImplementationOnce(async(_input,_signal,_deps,context)=>{context.onProgress({type:"phase",phase:"checking"});await waiting;return {reply:"Saved after reconnect"};});
    const response=await POST(new Request("https://programmable.market/api/custom-ai",{method:"POST",headers:{"content-type":"application/json",accept:"text/event-stream"},body:JSON.stringify(request)}));
    await response.body!.cancel();
    const store=runtime.store as ReturnType<typeof createAIStore>;
    await expect.poll(async()=> (await store.read(runtime.owner,request.id))?.phase).toBe("checking");
    expect((await store.read(runtime.owner,request.id))?.request).toEqual(request);
    complete();
    await expect.poll(async()=> (await store.read(runtime.owner,request.id))?.state).toBe("completed");
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
  it("does not reserve an attempt or call a model when the selected provider is unconfigured", async () => {
    vi.stubEnv("CUSTOM_AI_PROVIDER", "surplus");vi.stubEnv("SURPLUS_API_KEY", "");
    const response=await POST(new Request("https://programmable.market/api/custom-ai",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)}));
    expect(response.status).toBe(503);expect((await response.json()).code).toBe("configuration");
    expect(runtime.run).not.toHaveBeenCalled();
    expect((await database.query("SELECT count(*)::int AS n FROM programmable_custom_ai_v1.jobs")).rows).toEqual([{n:0}]);
  });
  it("reports a terminal failure so a deliberate retry can use a new attempt", async () => {
    runtime.run.mockRejectedValueOnce(new CustomAIError("provider_503", "Temporary provider error", 503)).mockResolvedValue({ reply: "Recovered." });
    const send = (id: string) => sendAIChat({ ...request, id }, async () => ({}), new AbortController().signal);
    await expect(send(request.id)).rejects.toMatchObject({ status: 503, requestState: "failed" });
    await expect(send(request.id)).rejects.toMatchObject({ status: 409, requestState: "failed" });
    expect(await send("recovery-request-00002")).toEqual({ reply: "Recovered." });
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
  it("recovers a completed result under the same ID without a second paid call", async () => {
    runtime.run.mockResolvedValue({ reply: "Saved answer." });
    const first = await POST(new Request("https://programmable.market/api/custom-ai", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
    expect(first.status).toBe(200); // simulate a response lost before it reached the browser
    expect(await sendAIChat(request, async () => ({}), new AbortController().signal)).toEqual({ reply: "Saved answer." });
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
  it("delivers progress before completion and commits only the complete answer", async () => {
    const events: ChatProgress[] = [];
    let complete!: () => void;
    const pause = new Promise<void>(resolve => { complete = resolve; });
    runtime.run.mockImplementation(async (_request, _signal, _deps, context) => {
      context.onProgress({ type: "reply", text: "Working on your" });
      await pause;
      return { reply: "Your complete answer." };
    });
    const result = sendAIChat(request, async () => ({}), new AbortController().signal, event => events.push(event));
    await expect.poll(() => events.length).toBe(1);
    expect(events[0]).toEqual({ type: "reply", text: "Working on your" });
    complete();
    expect(await result).toEqual({ reply: "Your complete answer." });
  });
  it("never lets a different account supply another owner's saved context", async () => {
    runtime.run.mockResolvedValue({ reply: "Private", memory: "Private requirements." });
    await sendAIChat(request, async () => ({}), new AbortController().signal);
    runtime.owner = "bob";
    await expect(sendAIChat({ ...request, id: "other-request-0001", contextId: request.id }, async () => ({}), new AbortController().signal)).rejects.toBeInstanceOf(AIRequestError);
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
  it("persists complete open requirements and passes that same authority to the next job", async () => {
    const intent=reviseLaunchIntent({request,proposed:[{id:"fees",text:"Make the buy fee 2%.",kind:"behavior",instruction:request.messages[0].content,open:null},
      {id:"feed",text:"Choose the external feed",kind:"decision",instruction:request.messages[0].content,open:"Which source?"}],unresolved:["Which source?"],edits:[]}).intent;
    runtime.run.mockResolvedValueOnce({reply:"A source remains open.",intent,change:"blocked"});
    const saved=await sendAIChat(request,async()=>({}),new AbortController().signal);
    expect(saved.intent).toEqual(intent);
    const reloaded=await GET(new Request(`https://programmable.market/api/custom-ai?id=${request.id}`));
    expect((await reloaded.json()).result.intent).toEqual(intent);
    expect(runtime.run).toHaveBeenCalledTimes(1);
    runtime.run.mockImplementationOnce(async(_request,_signal,_deps,context)=>{
      expect(context.intent).toEqual(intent);
      return {reply:"The first rule affects buys.",intent:context.intent,change:"unchanged"};
    });
    const next=await sendAIChat({...request,id:"intent-followup-0001",contextId:request.id,messages:[{role:"user",content:"Explain the first rule."}]},async()=>({}),new AbortController().signal);
    expect(next.intent).toEqual(intent);expect(runtime.run).toHaveBeenCalledTimes(2);
  });
});
