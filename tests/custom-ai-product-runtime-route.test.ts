import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({authorize:vi.fn(),read:vi.fn(),consume:vi.fn()}));
vi.mock("../lib/custom-ai/auth.server",()=>({authorizeCustomAI:mock.authorize}));
vi.mock("../lib/custom-ai/product/runtime-service.server",()=>({createProductRuntimeReader:()=>mock.read}));
vi.mock("../lib/custom-ai/store.server",()=>({productionAIStore:()=>({consume:mock.consume})}));
import {GET} from "../app/api/custom-ai/product-runtime/route";
const id="runtime-preparation-0001",auth={kind:"account",owner:"private-owner",principal:{wallets:[]}};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED","true");mock.authorize.mockResolvedValue(auth);mock.read.mockResolvedValue({state:"contracts-observed"});});
afterEach(()=>vi.unstubAllEnvs());
describe("requested product runtime route",()=>{
  it("requires the current scoped session and returns a private response",async()=>{
    const request=new Request(`https://site.test/api/custom-ai/product-runtime?id=${id}`),reply=await GET(request);
    expect(reply.status).toBe(200);expect(mock.authorize).toHaveBeenCalledWith(request,false,true);expect(mock.read).toHaveBeenCalledWith(request,auth,id);
    expect(reply.headers.get("cache-control")).toBe("private, no-store");expect(await reply.json()).toEqual({runtime:{state:"contracts-observed"}});
    expect(mock.consume).toHaveBeenCalledWith("private-owner","product-runtime-read",60);
  });
  it("rejects bulk queries, extra caller fields and an unconnected account before reading",async()=>{
    for(const query of ["",`id=${id}&id=${id}`,`id=${id}&address=0x1234`])expect((await GET(new Request(`https://site.test/api/custom-ai/product-runtime?${query}`))).status).toBe(400);
    mock.authorize.mockResolvedValue({kind:"preview"});
    expect((await GET(new Request(`https://site.test/api/custom-ai/product-runtime?id=${id}`))).status).toBe(401);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it("honors the existing availability boundary before any authentication or read",async()=>{
    vi.stubEnv("CUSTOM_AI_GENERAL_LAUNCH_ENABLED","");
    expect((await GET(new Request(`https://site.test/api/custom-ai/product-runtime?id=${id}`))).status).toBe(404);
    expect(mock.authorize).not.toHaveBeenCalled();expect(mock.read).not.toHaveBeenCalled();
  });
});
