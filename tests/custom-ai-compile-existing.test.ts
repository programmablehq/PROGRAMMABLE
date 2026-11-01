import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { compileExistingProject, readCompilationSource } from "../lib/custom-ai/compile-existing.server";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import type { CompiledProject } from "../lib/custom-ai/contract-project.server";
import type { AIStore } from "../lib/custom-ai/store.server";
import { parseChatRequest, type ChatRequest } from "../lib/custom-ai/types";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
const account="0x"+"a".repeat(40),chat="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sourceId="saved-source-request-0001";
const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},sources:{"Hook.sol":{content:"pragma solidity 0.8.26; contract Hook {}"}},entrypoints:[{source:"Hook.sol",contract:"Hook",role:"hook"}]},{version:1,id:"design",revision:"a".repeat(64),parentRevision:"b".repeat(64),requirements:[{id:"no-owner",text:"No owner privileges",kind:"constraint",open:null,origin:{kind:"legacy"}}],unresolved:[],changes:[]},1);
const request:ChatRequest={id:"retry-source-request-0001",intent:"compile",compilationOf:{id:sourceId,projectHash:project.hash},conversation:{account,id:chat,revision:0},coin:EMPTY_COIN_SETUP,messages:[{role:"user",content:"Retry the saved build"}]};
const checkpoint={version:1 as const,requestId:sourceId,payloadHash:"bound",project,summary:"Saved source"};
const read=vi.fn(),source=vi.fn(),save=vi.fn(),complete=vi.fn();
const store={read,projects:{read:source,save,complete}} as unknown as AIStore;
function compilation(compiled=true):CompiledProject{
 const body={version:1 as const,projectHash:project.hash,compiled,compiler:GENERAL_PROJECT_COMPILER,diagnostics:[],contracts:[],verification:"not-run" as const,launchReady:false as const};
 return {...body,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",body)};
}
beforeEach(()=>{vi.clearAllMocks();read.mockResolvedValue({id:sourceId,state:"failed",request:{conversation:{account,id:chat,revision:0}}});source.mockResolvedValue(checkpoint);save.mockResolvedValue(checkpoint);complete.mockResolvedValue(checkpoint);});

describe("compile-only owned recovery",()=>{
 it("round-trips only an exact saved source reference and rejects an injected edit or compiler command",()=>{
  expect(parseChatRequest(request)).toEqual(request);
  expect(parseChatRequest({...request,messages:[]})).toMatchObject({intent:"compile",messages:[],compilationOf:request.compilationOf});
  expect(()=>parseChatRequest({...request,intent:"chat",messages:[],compilationOf:undefined})).toThrow();
  for(const value of [{...request,compilationOf:undefined},{...request,conversation:undefined},{...request,intent:"chat"},{...request,compilationOf:{...request.compilationOf,command:"curl somewhere"}},{...request,editTarget:{sourceHash:"a".repeat(64),requirementId:"no-owner"}},{...request,compilationOf:{id:request.id,projectHash:project.hash}}])expect(()=>parseChatRequest(value)).toThrow();
 });
 it("reads the same failed source under its owner and preserves every saved requirement",async()=>{
  const value=await readCompilationSource(store,"alice",request,project.intent);
  expect(value.project).toEqual(project);expect(read).toHaveBeenCalledWith("alice",sourceId);expect(source).toHaveBeenCalledWith("alice",sourceId);
 });
 it("rejects another chat or absent owner before loading its larger source",async()=>{
  read.mockResolvedValueOnce(null);await expect(readCompilationSource(store,"bob",request)).rejects.toMatchObject({code:"context"});expect(source).not.toHaveBeenCalled();
  read.mockResolvedValueOnce({state:"failed",request:{conversation:{account,id:"00000000-0000-4000-8000-000000000001"}}});await expect(readCompilationSource(store,"alice",request)).rejects.toMatchObject({code:"context"});expect(source).not.toHaveBeenCalled();
 });
 it("cannot retry a still-running parent, changed hash/network or stale design",async()=>{
  read.mockResolvedValueOnce({state:"running",request:{conversation:{account,id:chat}}});await expect(readCompilationSource(store,"alice",request)).rejects.toMatchObject({code:"busy",status:429});expect(source).not.toHaveBeenCalled();
  await expect(readCompilationSource(store,"alice",{...request,compilationOf:{id:sourceId,projectHash:`sha256:${"c".repeat(64)}`}})).rejects.toMatchObject({code:"project-context"});
  await expect(readCompilationSource(store,"alice",{...request,coin:{...EMPTY_COIN_SETUP,chainId:4663}})).rejects.toMatchObject({code:"project-context"});
  await expect(readCompilationSource(store,"alice",request,{...project.intent,revision:"c".repeat(64)})).rejects.toMatchObject({code:"project-context"});
 });
 it("does not repeat a deterministic failed build without a source edit",async()=>{
  source.mockResolvedValueOnce({...checkpoint,compilation:compilation(false)});
  await expect(readCompilationSource(store,"alice",request)).rejects.toMatchObject({code:"project-edit",status:422});
 });
 it("saves before one compiler call and returns compact, still-unverified output without inference",async()=>{
  const events:string[]=[],compile=vi.fn(async()=>{events.push("compiler");return compilation();});save.mockImplementation(async()=>{events.push("source");});complete.mockImplementation(async()=>{events.push("receipt");});
  const value=await compileExistingProject({store,owner:"alice",id:request.id,lease:"current",source:checkpoint},undefined,compile);
  expect(events).toEqual(["source","compiler","receipt"]);expect(compile).toHaveBeenCalledTimes(1);expect(value.generalProject?.projectHash).toBe(project.hash);expect(value.generalProject?.verification).toBe("not-run");expect(value.generalProject?.launchReady).toBe(false);expect(value.intent).toEqual(project.intent);expect(JSON.stringify(value)).not.toContain("pragma solidity");
 });
 it("reuses an existing compiler receipt without another compiler execution",async()=>{
  const compile=vi.fn(),receipt=compilation();
  await compileExistingProject({store,owner:"alice",id:request.id,lease:"current",source:{...checkpoint,compilation:receipt}},undefined,compile);
  expect(compile).not.toHaveBeenCalled();expect(complete).toHaveBeenCalledWith("alice",request.id,"current",receipt);
 });
 it("keeps the source checkpoint after a compiler outage and does not retry automatically",async()=>{
  const compile=vi.fn(async()=>{throw Error("Compiler unavailable");});
  await expect(compileExistingProject({store,owner:"alice",id:request.id,lease:"current",source:checkpoint},undefined,compile)).rejects.toThrow("Compiler unavailable");expect(save).toHaveBeenCalledTimes(1);expect(compile).toHaveBeenCalledTimes(1);expect(complete).not.toHaveBeenCalled();
 });
 it("cannot run after a rejected lease or attach output after its abort signal",async()=>{
  const compile=vi.fn(async()=>compilation());save.mockRejectedValueOnce(Error("Lease stopped"));
  await expect(compileExistingProject({store,owner:"alice",id:request.id,lease:"stopped",source:checkpoint},undefined,compile)).rejects.toThrow("Lease stopped");expect(compile).not.toHaveBeenCalled();
  const abort=new AbortController();const late=vi.fn(async()=>{abort.abort();return compilation();});
  await expect(compileExistingProject({store,owner:"alice",id:request.id,lease:"current",source:checkpoint},abort.signal,late)).rejects.toThrow();expect(complete).not.toHaveBeenCalled();
 });
});
