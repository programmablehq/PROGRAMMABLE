import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({authenticate:vi.fn(),source:vi.fn(),observe:vi.fn()}));
vi.mock("../lib/server/creator-article/wallet-principal.server",()=>({
  createPrivyWalletPrincipalAuthenticatorV1:()=>({authenticate:mock.authenticate}),WalletPrincipalAuthenticationErrorV1:class extends Error{},
}));
vi.mock("../lib/custom-ai/product/runtime-source.server",()=>({readProductRuntimeSource:mock.source}));
vi.mock("../lib/custom-ai/product/runtime-observer.server",()=>({observeProductRuntime:mock.observe}));
import {authorizeCustomAI} from "../lib/custom-ai/auth.server";
import {createCustomAIBackendLaunchBridge} from "../lib/custom-ai/backend-launch.server";
import {createProductRuntimeReader} from "../lib/custom-ai/product/runtime-service.server";
import {graphFinalityFixture} from "./fixtures/custom-ai-general-wallet-finality-v1";
import type {ProductRuntimeSource} from "../lib/custom-ai/product/runtime-source.server";
import type {AIStore} from "../lib/custom-ai/store.server";

const id="runtime-preparation-0001";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("CUSTOM_AI_PUBLIC_ENABLED","true");mock.observe.mockResolvedValue({state:"contracts-observed",components:[]});});
afterEach(()=>{vi.unstubAllEnvs();});
describe("runtime reads with real request-bound wallet authority",()=>{
  it("keeps a second authenticated reader alive when the first metadata request is cancelled",async()=>{
    const f=graphFinalityFixture("1"),resource=f.resource;
    const source={preparationId:id,chainId:1,controller:f.subject.controller,resourceId:resource.launchId,requestHash:resource.requestHash,
      launchProfileHash:resource.launchProfileHash,launchIntentHash:resource.launchIntentHash,token:resource.output.onchain.token,hook:resource.output.onchain.hook} as ProductRuntimeSource;
    mock.source.mockResolvedValue(source);mock.authenticate.mockResolvedValue({privyUserId:"owned-runtime-user",privySessionId:"runtime-session",wallets:[source.controller]});
    const abort=new AbortController(),url="https://site.test/api/custom-ai/product-runtime?id="+id;
    const firstRequest=new Request(url,{signal:abort.signal}),secondRequest=new Request(url);
    const firstAuthority=await authorizeCustomAI(firstRequest),secondAuthority=await authorizeCustomAI(secondRequest);
    const fetchBackend=vi.fn().mockImplementationOnce((_url,options)=>new Promise((_resolve,reject)=>{
      options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true});
    })).mockImplementation(()=>Promise.resolve(Response.json(resource)));
    const bridge=createCustomAIBackendLaunchBridge({backendBaseUrl:"https://api.test/",websiteToken:"w".repeat(43),assertionKey:"k".repeat(43),fetchBackend});
    const read=createProductRuntimeReader({store:()=>({} as AIStore),bridge:()=>bridge,rpcs:()=>[vi.fn(),vi.fn()]});
    const first=read(firstRequest,firstAuthority,id).catch(error=>error);
    await vi.waitFor(()=>expect(fetchBackend).toHaveBeenCalledOnce());
    await expect(read(secondRequest,secondAuthority,id)).resolves.toMatchObject({state:"contracts-observed"});
    abort.abort();expect((await first).name).toBe("AbortError");
    const thirdRequest=new Request(url),thirdAuthority=await authorizeCustomAI(thirdRequest);
    await expect(read(thirdRequest,thirdAuthority,id)).resolves.toMatchObject({state:"contracts-observed"});
    expect(fetchBackend).toHaveBeenCalledTimes(2);expect(mock.observe).toHaveBeenCalledOnce();
  });
  it("uses the authenticated request for the backend resource and never accepts a copied request",async()=>{
    const f=graphFinalityFixture("1"),resource=f.resource;
    const source={preparationId:id,chainId:1,controller:f.subject.controller,resourceId:resource.launchId,requestHash:resource.requestHash,
      launchProfileHash:resource.launchProfileHash,launchIntentHash:resource.launchIntentHash,token:resource.output.onchain.token,hook:resource.output.onchain.hook} as ProductRuntimeSource;
    mock.source.mockResolvedValue(source);mock.authenticate.mockResolvedValue({privyUserId:"owned-runtime-user",privySessionId:"runtime-session",wallets:[source.controller]});
    const request=new Request("https://site.test/api/custom-ai/product-runtime?id="+id),authority=await authorizeCustomAI(request);
    const fetchBackend=vi.fn().mockResolvedValue(Response.json(resource));
    const bridge=createCustomAIBackendLaunchBridge({backendBaseUrl:"https://api.test/",websiteToken:"w".repeat(43),assertionKey:"k".repeat(43),fetchBackend});
    const read=createProductRuntimeReader({store:()=>({} as AIStore),bridge:()=>bridge,rpcs:()=>[vi.fn(),vi.fn()]});
    await expect(read(request,authority,id)).resolves.toMatchObject({state:"contracts-observed"});
    expect(fetchBackend).toHaveBeenCalledOnce();
    const [,options]=fetchBackend.mock.calls[0];
    expect(options.method).toBe("GET");expect(new Headers(options.headers).get("x-programmable-wallet-address")).toBe(source.controller.toLowerCase());
    await expect(bridge.resource(new Request(request),authority,{chainId:1,account:source.controller,resourceId:source.resourceId})).rejects.toMatchObject({code:"session_changed"});
    expect(fetchBackend).toHaveBeenCalledOnce();
  });
});
