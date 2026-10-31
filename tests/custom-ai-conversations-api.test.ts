import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocked=vi.hoisted(()=>({auth:vi.fn(),consume:vi.fn(),list:vi.fn(),read:vi.fn(),create:vi.fn(),update:vi.fn()}));
vi.mock("../lib/custom-ai/auth.server",()=>({authorizeCustomAI:mocked.auth}));
vi.mock("../lib/custom-ai/store.server",()=>({productionAIStore:()=>({consume:mocked.consume,conversations:mocked})}));
import {GET,POST} from "../app/api/custom-ai/conversations/route";
const wallet="0x"+"a".repeat(40),other="0x"+"b".repeat(40),url="https://site.test/api/custom-ai/conversations";
beforeEach(()=>{vi.clearAllMocks();mocked.auth.mockResolvedValue({kind:"account",owner:"alice",principal:{wallets:[wallet]}});mocked.list.mockResolvedValue({conversations:[]});mocked.create.mockResolvedValue({id:"legacy-wallet-studio"});mocked.read.mockResolvedValue(null);});
describe("private conversation API authorization",()=>{
 it("rejects preview and unlinked wallets without reading another tenant",async()=>{
  mocked.auth.mockResolvedValueOnce({kind:"preview"});expect((await GET(new Request(url+"?account="+wallet))).status).toBe(401);
  expect((await GET(new Request(url+"?account="+other))).status).toBe(403);expect(mocked.list).not.toHaveBeenCalled();expect(mocked.consume).not.toHaveBeenCalled();
 });
 it("passes a bounded owner scope and cursor to the list without a provider call",async()=>{
  const result=await GET(new Request(url+"?account="+wallet+"&q=rain&archived=true&cursor=opaque"));expect(result.status).toBe(200);
  expect(mocked.list).toHaveBeenCalledWith("alice",expect.stringMatching(/^0x/i),{search:"rain",archived:true,cursor:"opaque"});expect(result.headers.get("cache-control")).toContain("no-store");
 });
 it("keeps direct metadata reads scoped to the linked account and reports a missing chat",async()=>{
  expect((await GET(new Request(url+"?account="+wallet+"&id=missing"))).status).toBe(404);
  expect(mocked.read).toHaveBeenCalledWith("alice",expect.any(String),"missing");
 });
 it("does not accept an unlinked write or null action",async()=>{
  const req=(body:unknown)=>new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  expect((await POST(req({account:other,action:"create",id:"foreign"}))).status).toBe(403);expect(mocked.create).not.toHaveBeenCalled();
  expect((await POST(req(null))).status).toBe(400);
  expect((await POST(req({account:wallet,action:"bootstrap"}))).status).toBe(200);expect(mocked.create).toHaveBeenCalledWith("alice",expect.any(String),"legacy-wallet-studio");
 });
 it("derives the local namespace from the verified principal rather than a client-supplied scope",async()=>{
  const request=()=>new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({account:wallet,action:"bootstrap",cacheScope:"invented"})});
  const alice=await(await POST(request())).json();expect(alice.cacheScope).toMatch(/^[a-f0-9]{64}$/);expect(alice.cacheScope).not.toContain("alice");
  mocked.auth.mockResolvedValue({kind:"account",owner:"bob",principal:{wallets:[wallet]}});
  const bob=await(await POST(request())).json();expect(bob.cacheScope).not.toBe(alice.cacheScope);
 });
});
