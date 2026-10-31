import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({authorize:vi.fn(),store:vi.fn(),read:vi.fn(),active:vi.fn(),consume:vi.fn(),prepare:vi.fn(),exchange:vi.fn()}));
vi.mock("../lib/custom-ai/auth.server",()=>({authorizeCustomAI:mock.authorize}));
vi.mock("../lib/custom-ai/store.server",()=>({productionAIStore:mock.store}));
vi.mock("../lib/custom-ai/general-preparation.server",()=>({createGeneralPreparationService:()=>({prepare:mock.prepare,exchange:mock.exchange})}));
import {GET,POST} from "../app/api/custom-ai/general-launch/route";
import {CustomAIError} from "../lib/custom-ai/types";
import type {GeneralPreparation} from "../lib/custom-ai/general-preparation-store.server";

const account=`0x${"11".repeat(20)}` as const,other=`0x${"22".repeat(20)}`,id="general-route-ticket-0001",hash=`sha256:${"a".repeat(64)}` as const;
const record:GeneralPreparation={version:1,id,account,chainId:1,selection:{id:"general-source-ticket-0001",account,chainId:1,
  conversation:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",studioRevision:2,projectHash:hash,artifactHash:hash,intentRevision:"b".repeat(64)},
  bindingHash:hash,productionId:hash,inputHash:hash,identity:{nonce:`0x${"11".repeat(32)}`,sourceLineageNonce:"1",validAfter:"1",deadline:"2",checkedAt:"2026-10-31T00:00:00.000Z"},
  idempotencyKey:"private-idempotency-value",createdAt:1,updatedAt:2,packState:"complete",packLease:{token:"private-lease",until:0,slot:0},requestHash:hash};
const request=(body:unknown)=>new Request("https://programmable.market/api/custom-ai/general-launch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED","true");
  mock.authorize.mockResolvedValue({kind:"account",owner:"current-owner",principal:{wallets:[account]}});
  mock.store.mockReturnValue({consume:mock.consume,projects:{preparations:{read:mock.read,active:mock.active}}});
  mock.read.mockResolvedValue(structuredClone(record));mock.active.mockResolvedValue(structuredClone(record));mock.consume.mockResolvedValue(undefined);
});
afterEach(()=>vi.unstubAllEnvs());
describe("explicit general launch route",()=>{
  it("is disabled by default before session, database, compiler or backend work",async()=>{
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED","");
    for(const response of [await GET(new Request(`https://programmable.market/api/custom-ai/general-launch?id=${id}`)),await POST(request({action:"create",id}))])expect(response.status).toBe(404);
    expect(mock.authorize).not.toHaveBeenCalled();expect(mock.store).not.toHaveBeenCalled();expect(mock.exchange).not.toHaveBeenCalled();
  });
  it("polls one owned compact journal with current cache scope and private response headers",async()=>{
    const req=new Request(`https://programmable.market/api/custom-ai/general-launch?id=${id}`),response=await GET(req),body=await response.json();
    expect(response.status).toBe(200);expect(mock.authorize).toHaveBeenCalledWith(req,false,true);expect(mock.read).toHaveBeenCalledWith("current-owner",id);
    expect(response.headers.get("cache-control")).toBe("private, no-store");expect(body.preparation.launchReady).toBe(false);
    for(const privateValue of ["private-idempotency-value","private-lease","sourceLineageNonce","requestBody"])expect(JSON.stringify(body)).not.toContain(privateValue);
    expect(mock.prepare).not.toHaveBeenCalled();expect(mock.exchange).not.toHaveBeenCalled();
  });
  it("recovers the original wallet ticket without accepting a foreign wallet",async()=>{
    const response=await GET(new Request(`https://programmable.market/api/custom-ai/general-launch?account=${account}`));
    expect(response.status).toBe(200);expect(mock.active).toHaveBeenCalledWith("current-owner",account);
    const rejected=await GET(new Request(`https://programmable.market/api/custom-ai/general-launch?account=${other}`));expect(rejected.status).toBe(403);
    mock.read.mockResolvedValue({...record,account:other});expect((await GET(new Request(`https://programmable.market/api/custom-ai/general-launch?id=${id}`))).status).toBe(403);
  });
  it("rejects ambiguous selectors and caller-provided packed bytes before work",async()=>{
    for(const query of [`id=${id}&id=${id}`,`id=${id}&account=${account}`,`account=${account}&owner=someone`,""])
      expect((await GET(new Request(`https://programmable.market/api/custom-ai/general-launch?${query}`))).status).toBe(400);
    expect((await POST(request({action:"create",id,requestBody:"untrusted-source"}))).status).toBe(400);
    expect((await POST(request({action:"prepare",id,selection:{...record.selection,bindingHash:record.bindingHash}}))).status).toBe(400);
    expect(mock.prepare).not.toHaveBeenCalled();expect(mock.exchange).not.toHaveBeenCalled();expect(mock.read).not.toHaveBeenCalled();
  });
  it("requires the current authenticated session before a preparation or mutation",async()=>{
    mock.authorize.mockRejectedValue(new CustomAIError("auth","Connect your wallet to continue.",401));
    const response=await POST(request({action:"create",id}));expect(response.status).toBe(401);expect(mock.store).not.toHaveBeenCalled();
    expect(mock.exchange).not.toHaveBeenCalled();
  });
  it("passes only the explicit parsed action to the owned service",async()=>{
    mock.prepare.mockResolvedValue({id,packState:"packing",launchReady:false});
    const body={action:"prepare",id,selection:record.selection},req=request(body),response=await POST(req);
    expect(response.status).toBe(200);expect(mock.prepare).toHaveBeenCalledWith(req,await mock.authorize.mock.results[0].value,body);
    expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mock.exchange).not.toHaveBeenCalled();
  });
});
