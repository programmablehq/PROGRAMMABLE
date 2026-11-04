import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({source:vi.fn(),observe:vi.fn()}));
vi.mock("../lib/custom-ai/product/runtime-source.server",()=>({readProductRuntimeSource:mocks.source}));
vi.mock("../lib/custom-ai/product/runtime-observer.server",()=>({observeProductRuntime:mocks.observe}));
vi.mock("../lib/custom-ai/auth.server",()=>({requireFreshCustomAIAuthority:(_request:Request,authority:unknown)=>authority}));
import {productRuntimeAnchor} from "../lib/custom-ai/product/runtime-anchor.server";
import {createProductRuntimeReader} from "../lib/custom-ai/product/runtime-service.server";
import {graphFinalityFixture} from "./fixtures/custom-ai-general-wallet-finality-v1";
import {recordFixture} from "./fixtures/universal-launch-v1";
import type {ProductRuntimeSource} from "../lib/custom-ai/product/runtime-source.server";
import type {AIAuthority} from "../lib/custom-ai/auth.server";
import type {AIStore} from "../lib/custom-ai/store.server";

const id="runtime-preparation-0001";
function graph(chain:"1"|"8453"|"999"="1"){
  const f=graphFinalityFixture(chain),resource=f.resource;
  const source={preparationId:id,chainId:Number(chain),controller:f.subject.controller,resourceId:resource.launchId,requestHash:resource.requestHash,
    launchProfileHash:resource.launchProfileHash,launchIntentHash:resource.launchIntentHash,token:resource.output.onchain.token,hook:resource.output.onchain.hook} as unknown as ProductRuntimeSource;
  return {f,source,reply:{httpStatus:200,location:null,value:resource}};
}
describe("historical resource identity",()=>{
  it.each(["1","8453","999"] as const)("reads finalized chain %s without requiring an unexpired signing window",chain=>{
    const {f,source,reply}=graph(chain);expect(productRuntimeAnchor(reply,source)).toEqual({transactionHash:f.hash,launchId:f.resource.onchainLaunchId});
    expect(()=>productRuntimeAnchor(reply,{...source,requestHash:`sha256:${"0".repeat(64)}`})).toThrow();
    expect(()=>productRuntimeAnchor({...reply,value:{...f.resource,status:"authorized"}},source)).toThrow();
  });
  it("keeps the original Robinhood bytes and one final transaction",()=>{
    const original=recordFixture(),tx=`0x${"a".repeat(64)}` as const;
    const record={...original,status:"final" as const,steps:original.steps.map(step=>({...step,status:"final" as const,transactionHash:tx}))};
    const source={chainId:4663,resourceId:record.planId,requestHash:record.planHash,requestSha256:record.rawRequestSha256,controller:record.plan.controller.address} as ProductRuntimeSource;
    expect(productRuntimeAnchor({httpStatus:200,location:null,value:record},source)).toEqual({transactionHash:tx,launchId:null});
    expect(()=>productRuntimeAnchor({httpStatus:200,location:null,value:record},{...source,requestSha256:`sha256:${"0".repeat(64)}`})).toThrow();
  });
});
beforeEach(()=>{vi.clearAllMocks();});
describe("private requested runtime snapshots",()=>{
  it("deduplicates simultaneous views, caches a minute and rechecks wallet access on every read",async()=>{
    const {source,reply}=graph(),wallet=source.controller;
    mocks.source.mockResolvedValue(source);mocks.observe.mockResolvedValue({state:"contracts-observed",components:[]});
    let time=1_000;const resource=vi.fn().mockResolvedValue(reply);
    const store={} as AIStore,read=createProductRuntimeReader({store:()=>store,bridge:()=>({resource}),rpcs:()=>[vi.fn(),vi.fn()],now:()=>time});
    const auth={kind:"account",owner:"owned-account",principal:{wallets:[wallet]}} as unknown as AIAuthority;
    const req=()=>new Request("https://site.test/api/custom-ai/product-runtime?id="+id);
    const [a,b]=await Promise.all([read(req(),auth,id),read(req(),auth,id)]);
    expect(a).toEqual(b);expect(a).not.toBe(b);expect(mocks.source).toHaveBeenCalledOnce();expect(resource).toHaveBeenCalledOnce();expect(mocks.observe).toHaveBeenCalledOnce();
    await read(req(),auth,id);expect(resource).toHaveBeenCalledOnce();
    const other={...auth,principal:{wallets:[`0x${"2".repeat(40)}`]}} as unknown as AIAuthority;
    await expect(read(req(),other,id)).rejects.toMatchObject({code:"wallet"});expect(resource).toHaveBeenCalledOnce();
    time+=60_001;await read(req(),auth,id);expect(resource).toHaveBeenCalledTimes(2);
    expect(mocks.source.mock.calls[0].slice(1)).toEqual(["owned-account",id]);
  });
  it("backs off after a failed observation without returning a healthy state",async()=>{
    const {source,reply}=graph();mocks.source.mockResolvedValue(source);mocks.observe.mockRejectedValue(Error("provider unavailable"));
    const resource=vi.fn().mockResolvedValue(reply),read=createProductRuntimeReader({store:()=>({} as AIStore),bridge:()=>({resource}),rpcs:()=>[vi.fn(),vi.fn()]});
    const auth={kind:"account",owner:"owned-account",principal:{wallets:[source.controller]}} as unknown as AIAuthority;
    const req=()=>new Request("https://site.test/api/custom-ai/product-runtime?id="+id);
    await expect(read(req(),auth,id)).rejects.toMatchObject({code:"product-runtime-unconfirmed"});
    await expect(read(req(),auth,id)).rejects.toMatchObject({code:"product-runtime-unconfirmed"});
    expect(mocks.observe).toHaveBeenCalledOnce();expect(resource).toHaveBeenCalledOnce();
  });
});
