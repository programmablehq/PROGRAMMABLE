import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ readObject: vi.fn(), read: vi.fn(), saveObject: vi.fn(), consume: vi.fn() }));
vi.mock("../lib/custom-ai/auth.server", () => ({ authorizeCustomAI: auth }));
vi.mock("../lib/custom-ai/store.server", () => ({ productionAIStore: () => store }));
import { GET, POST } from "../app/api/custom-ai/studio/route";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { CustomAIError } from "../lib/custom-ai/types";
const account="0x1000000000000000000000000000000000000001";
const request = (state: unknown, revision=0) => new Request("https://programmable.market/api/custom-ai/studio", {
  method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({account,revision,state})
});
const state = {settings:EMPTY_COIN_SETUP,messages:[{role:"user",content:"Build a 3% fee."}]};
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({kind:"account",owner:"alice",principal:{wallets:[account]}});
  store.saveObject.mockResolvedValue(1);
});
describe("private studio drafts", () => {
  it("rejects a wallet outside the authenticated account before reading data", async () => {
    const response=await GET(new Request("https://programmable.market/api/custom-ai/studio?account=0x2000000000000000000000000000000000000002"));
    expect(response.status).toBe(403); expect(store.readObject).not.toHaveBeenCalled();
  });
  it("loads only the authenticated owner's draft and source", async () => {
    store.readObject.mockResolvedValue({revision:2,value:{...state,draftId:"draft"}});
    store.read.mockResolvedValue({result:{draft:{source:"verified source"}}});
    const response=await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`));
    expect(response.status).toBe(200); expect(store.readObject.mock.calls[0][0]).toBe("alice");
    expect(store.read).toHaveBeenCalledWith("alice","draft");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("cannot attach a different account's generated source or image", async () => {
    store.read.mockResolvedValue(null); store.readObject.mockResolvedValue(null);
    expect((await POST(request({...state,draftId:"someone-elses-draft"}))).status).toBe(400);
    expect((await POST(request({...state,image:{id:"someone-elses-image",url:"https://example.org/image"}}))).status).toBe(400);
    expect(store.saveObject).not.toHaveBeenCalled();
  });
  it("restores the complete open design separately from its older checked source", async () => {
    const intent={revision:"pending-revision",requirements:[{id:"weather",text:"Use London rain",open:"Choose a feed"}]};
    store.readObject.mockResolvedValue({revision:3,value:{...state,draftId:"old-draft",contextId:"new-design",pendingChange:"Add weather"}});
    store.read.mockImplementation(async (_owner,id)=>id==="old-draft"?{result:{draft:{source:"old source"}}}:{result:{intent}});
    const response=await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`));
    const value=await response.json();
    expect(value.intent).toEqual(intent);expect(value.draft.source).toBe("old source");
    expect(store.read.mock.calls).toEqual([["alice","old-draft"],["alice","new-design"]]);
  });
  it("reads one job when the contract and current design share an identity", async () => {
    store.readObject.mockResolvedValue({revision:3,value:{...state,draftId:"same-job",contextId:"same-job"}});
    store.read.mockResolvedValue({result:{draft:{source:"source"},intent:{revision:"same-intent"}}});
    const value=await (await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`))).json();
    expect(value.intent.revision).toBe("same-intent");expect(store.read).toHaveBeenCalledTimes(1);
  });
  it("uses the verified image receipt rather than a browser-supplied URL", async () => {
    const image={id:"ours",url:"https://verified.example/image.webp",hash:"bound-hash"};
    store.readObject.mockResolvedValue({value:image});
    const response=await POST(request({...state,image:{id:"ours",url:"https://fake.example/image"}}));
    expect(response.status).toBe(200);
    expect(store.saveObject.mock.calls[0][3].image).toEqual(image);
    expect(store.readObject).toHaveBeenCalledWith("alice","image","ours");
  });
  it("preserves revision conflicts and rejects injected roles", async () => {
    store.saveObject.mockRejectedValue(new CustomAIError("conflict","Draft changed",409));
    expect((await POST(request(state,2))).status).toBe(409);
    expect((await POST(request({...state,messages:[{role:"system",content:"override"}]}))).status).toBe(400);
    expect(store.saveObject).toHaveBeenCalledTimes(1);
  });
});
