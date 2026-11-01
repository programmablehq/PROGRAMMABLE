import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({auth:vi.fn(),consume:vi.fn(),job:vi.fn(),project:vi.fn(),overview:vi.fn()}));
vi.mock("../lib/custom-ai/auth.server",()=>({authorizeCustomAI:mock.auth}));
vi.mock("../lib/custom-ai/store.server",()=>({productionAIStore:()=>({consume:mock.consume,read:mock.job,projects:{read:mock.project,overview:mock.overview}})}));
import { GET } from "../app/api/custom-ai/projects/route";
const account="0x"+"a".repeat(40),id="owned-source-request-0001",chat="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const request=(query:Record<string,string>={})=>new Request("https://site.test/api/custom-ai/projects?"+new URLSearchParams({account,id,conversation:chat,...query}));
beforeEach(()=>{vi.clearAllMocks();mock.auth.mockResolvedValue({kind:"account",owner:"alice",principal:{wallets:[account]}});mock.job.mockResolvedValue({id,state:"failed",request:{conversation:{account,id:chat,revision:1}}});mock.project.mockResolvedValue({version:1,requestId:id,payloadHash:"bound",project:{sources:{"Hook.sol":{content:"complete private source"}}}});});
describe("explicit private source reads",()=>{
 it("restores only a small owned receipt when complete source is not requested",async()=>{
  mock.overview.mockResolvedValue({requestId:id,projectHash:"sha256:"+"a".repeat(64),compilation:"pending",sourceFiles:1});
  const response=await GET(request({overview:"1"}));expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({requestId:id,compilation:"pending"});expect(mock.overview).toHaveBeenCalledWith("alice",id);
  expect(mock.project).not.toHaveBeenCalled();
 });
 it("returns the owned saved source even after a compiler failure with no additional inference",async()=>{
  const result=await GET(request());expect(result.status).toBe(200);expect(result.headers.get("cache-control")).toContain("no-store");expect((await result.json()).project.sources["Hook.sol"].content).toBe("complete private source");expect(mock.project).toHaveBeenCalledWith("alice",id);expect(mock.consume).toHaveBeenCalledWith("alice","project-source-read",120);
 });
 it("rejects a preview or unlinked wallet before any storage read",async()=>{
  mock.auth.mockResolvedValueOnce({kind:"preview"});expect((await GET(request())).status).toBe(401);
  expect((await GET(request({account:"0x"+"b".repeat(40)}))).status).toBe(403);expect(mock.job).not.toHaveBeenCalled();expect(mock.project).not.toHaveBeenCalled();
 });
 it("binds both the principal and the selected wallet/chat before loading the larger source",async()=>{
  mock.job.mockResolvedValueOnce({id,request:{conversation:{account,id:"00000000-0000-4000-8000-000000000002"}}});
  expect((await GET(request())).status).toBe(409);expect(mock.project).not.toHaveBeenCalled();expect(mock.job).toHaveBeenCalledWith("alice",id);
 });
 it("does not use a legacy unbound job as proof of another wallet's project",async()=>{
  mock.job.mockResolvedValueOnce({id,request:{}});expect((await GET(request())).status).toBe(409);expect(mock.project).not.toHaveBeenCalled();
 });
 it("bounds identifiers and distinguishes unavailable source without fetching a different request",async()=>{
  expect((await GET(request({id:"x".repeat(100)}))).status).toBe(400);expect(mock.job).not.toHaveBeenCalled();
  mock.job.mockResolvedValueOnce(null);expect((await GET(request())).status).toBe(404);expect(mock.project).not.toHaveBeenCalled();
  mock.project.mockResolvedValueOnce(null);expect((await GET(request())).status).toBe(404);
 });
 it("normalizes the same chat UUID without changing its owner scope",async()=>{
  expect((await GET(request({conversation:chat.toUpperCase()}))).status).toBe(200);expect(mock.project).toHaveBeenCalledWith("alice",id);
 });
});
