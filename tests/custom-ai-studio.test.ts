import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ readObject: vi.fn(), read: vi.fn(), saveObject: vi.fn(), consume: vi.fn(), projects: { overview: vi.fn(), read: vi.fn() } }));
vi.mock("../lib/custom-ai/auth.server", () => ({ authorizeCustomAI: auth }));
vi.mock("../lib/custom-ai/store.server", () => ({ productionAIStore: () => store }));
import { GET, POST } from "../app/api/custom-ai/studio/route";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import { CustomAIError, type Draft } from "../lib/custom-ai/types";
import { migrateLaunchIntent } from "../lib/custom-ai/launch-intent.server";
import { intentMatchesCandidate } from "../lib/custom-ai/launch-intent";
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
  it("saves a valid multilingual history and unsent text within the declared character limits", async () => {
    const multilingual = { settings: EMPTY_COIN_SETUP,
      messages: Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "界".repeat(7000) })),
      input: "界".repeat(8000), pendingChange: "界".repeat(8000) };
    const response = await POST(request(multilingual));
    expect(response.status).toBe(200);
    expect(store.saveObject.mock.calls[0][3]).toEqual(multilingual);
  });

  it("still rejects oversized storage requests before writing", async () => {
    const response = await POST(request({ ...state, input: "x".repeat(256001) }));
    expect(response.status).toBe(413);
    expect(store.saveObject).not.toHaveBeenCalled();
  });

  it("restores editable legacy rules from the owned checked source without a write or regeneration", async () => {
    const sourceHash="a".repeat(64),draftId="legacy-fee-draft-01";
    const draft:Draft={source:"saved unchanged source",sourceHash,compiled:true,diagnostics:[],verification:{status:"passed",sourceHash,
      requirements:["Charge 10% until second599.","Charge 0.5% from second600."],checks:[],cases:0}};
    store.readObject.mockImplementation(async (_owner,kind)=>kind==="studio"?{revision:3,value:{...state,draftId,contextId:draftId}}:null);
    store.read.mockResolvedValue({result:{draft}});
    const get=()=>GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`));
    const first=await(await get()).json(),second=await(await get()).json();
    expect(first.intent).toEqual(migrateLaunchIntent({draft,requestId:draftId}));
    expect(second.intent).toEqual(first.intent);expect(first.draft).toEqual(draft);
    expect(intentMatchesCandidate(first.intent,draft)).toBe(true);
    expect(first.intent.requirements.every((rule:{origin:{sourceHash:string}})=>rule.origin.sourceHash===sourceHash)).toBe(true);
    expect(store.saveObject).not.toHaveBeenCalled();expect(store.consume).not.toHaveBeenCalled();
    expect(store.read.mock.calls).toEqual([["alice",draftId],["alice",draftId]]);
  });
  it("retains open legacy work separately from an earlier checked fee source", async () => {
    const draft={source:"saved unchanged source",sourceHash:"a".repeat(64),verification:{requirements:["Keep the fee."]}};
    store.readObject.mockImplementation(async (_owner,kind)=>kind==="studio"?{revision:3,value:{...state,draftId:"old-draft",contextId:"new-design",pendingChange:"Add weather"}}:null);
    store.read.mockImplementation(async (_owner,id)=>id==="old-draft"?{result:{draft}}:{result:{ruleSpec:{requirements:[{id:"fee",text:"Keep the fee."},{id:"rain",text:"Use London rain."}]},unresolved:["Choose a feed"]}});
    const value=await(await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`))).json();
    expect(value.intent.unresolved).toEqual(["Choose a feed"]);
    expect(value.intent.requirements.map((rule:{text:string})=>rule.text)).toContain("Use London rain.");
    expect(intentMatchesCandidate(value.intent,draft)).toBe(false);
    expect(value.state.pendingChange).toBe("Add weather");expect(value.draft).toEqual(draft);
  });
  it("restores the latest saved build issue without rereading source or restarting work", async () => {
    const buildIssue={stage:"scenarios",code:"invalid-declaration"};
    store.readObject.mockImplementation(async (_owner,kind)=>kind==="studio"?{revision:3,value:{...state,contextId:"latest-build-0001"}}:null);
    store.read.mockResolvedValue({result:{buildIssue}});
    const value=await (await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`))).json();
    expect(value.buildIssue).toEqual(buildIssue);
    expect(store.read.mock.calls).toEqual([["alice","latest-build-0001"]]);
    expect(store.saveObject).not.toHaveBeenCalled();expect(store.consume).not.toHaveBeenCalled();expect(store.projects.overview).not.toHaveBeenCalled();
  });
  it("restores a compact general source result without reading its complete source", async () => {
    const generalProject={projectHash:"sha256:"+"a".repeat(64),compiled:true,launchReady:false,coinPreparation:{eligible:false,missing:["coin-deployment"]}};
    store.readObject.mockResolvedValue({revision:2,value:{...state,draftId:"general-source-0001"}});
    store.read.mockResolvedValue({result:{generalProject}});
    const value=await (await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`))).json();
    expect(value.generalProject).toEqual(generalProject);expect(value.draft).toBeUndefined();
    expect(store.projects.overview).not.toHaveBeenCalled();
    expect(store.projects.read).not.toHaveBeenCalled();
  });
  it("restores old coin eligibility from its exact owned checkpoint without leaking source",async()=>{
    const projectHash="sha256:"+"a".repeat(64),artifactHash="sha256:"+"b".repeat(64),draftId="general-source-0001";
    const generalProject={projectHash,artifactHash,compiled:true,launchReady:false};
    store.readObject.mockResolvedValue({revision:2,value:{...state,draftId}});
    store.read.mockResolvedValue({result:{generalProject}});
    store.projects.read.mockResolvedValue({project:{hash:projectHash,sources:{"Private.sol":{content:"private source"}}},compilation:{compiled:true,artifactHash},sourceAudit:{status:"passed"},scenarios:{passed:true}});
    const response=await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`));
    const value=await response.json();
    expect(value.generalProject.coinPreparation).toEqual({eligible:false,missing:["coin-deployment"]});
    expect(store.projects.read).toHaveBeenCalledWith("alice",draftId);
    expect(JSON.stringify(value)).not.toContain("private source");expect(store.saveObject).not.toHaveBeenCalled();
  });
  it("retains a failed source separately from the previous working draft", async () => {
    const sourceId="failed-source-request-0001",draftId="previous-draft-0001";
    store.read.mockImplementation(async (_owner,id)=>id===sourceId?{id,state:"failed"}:{result:{draft:{source:"previous working source"}}});
    store.readObject.mockImplementation(async (_owner,kind)=>kind==="studio"?{revision:3,value:{...state,draftId}}:{value:{activeRequest:sourceId}});
    store.projects.overview.mockResolvedValue({requestId:sourceId,projectHash:"sha256:"+"b".repeat(64),compilation:"pending"});
    const response=await GET(new Request(`https://programmable.market/api/custom-ai/studio?account=${account}`));const value=await response.json();
    expect(value.draft.source).toBe("previous working source");expect(value.sourceRecovery.requestId).toBe(sourceId);
    expect(value).not.toHaveProperty("activeRequest");expect(store.projects.overview).toHaveBeenCalledWith("alice",sourceId);
  });
  it("binds a separately retained source to the same chat and does not accept it as a finished draft", async () => {
    const sourceId="failed-source-request-0001";store.read.mockResolvedValue({state:"failed"});store.projects.overview.mockResolvedValue({requestId:sourceId});
    expect((await POST(request({...state,sourceId}))).status).toBe(200);
    expect(store.saveObject.mock.calls[0][3].sourceId).toBe(sourceId);
    expect((await POST(request({...state,sourceId,draftId:sourceId}))).status).toBe(400);
    store.read.mockResolvedValueOnce({state:"failed",request:{conversation:{account,id:"00000000-0000-4000-8000-000000000002"}}});
    expect((await POST(request({...state,sourceId}))).status).toBe(409);
    expect(store.saveObject).toHaveBeenCalledTimes(1);
  });
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
