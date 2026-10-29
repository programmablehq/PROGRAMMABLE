import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const {authorize,store}=vi.hoisted(()=>({authorize:vi.fn(),store:{consume:vi.fn(),draftVersions:vi.fn(),readObject:vi.fn(),read:vi.fn(),recentRequestMetrics:vi.fn()}}));
vi.mock("@/lib/custom-ai/auth.server",()=>({authorizeCustomAI:authorize}));
vi.mock("@/lib/custom-ai/store.server",()=>({productionAIStore:()=>store}));
import { GET as versions } from "../app/api/custom-ai/versions/route";
import { GET as metrics } from "../app/api/custom-ai/metrics/route";
import { requestMetrics, summarizeRequestMetrics } from "../lib/custom-ai/request-metrics";
const account=`0x${"1".repeat(40)}`;
beforeEach(()=>{vi.clearAllMocks();authorize.mockResolvedValue({kind:"account",owner:"owner-a",principal:{wallets:[account]}});store.consume.mockResolvedValue(undefined);});
describe("private saved versions and request measurements",()=>{
  it("rejects another wallet before reading its versions",async()=>{
    const response=await versions(new Request(`https://programmable.market/api/custom-ai/versions?account=0x${"2".repeat(40)}`));
    expect(response.status).toBe(403);expect(store.draftVersions).not.toHaveBeenCalled();expect(store.readObject).not.toHaveBeenCalled();
  });
  it("cannot restore a version from a different wallet studio",async()=>{
    store.readObject.mockResolvedValue({value:{studioId:"b".repeat(64),state:{draftId:"draft-1"}}});
    const response=await versions(new Request(`https://programmable.market/api/custom-ai/versions?account=${account}&id=${"a".repeat(64)}`));
    expect(response.status).toBe(404);expect(store.readObject).toHaveBeenCalledWith("owner-a","studio-version","a".repeat(64));expect(store.read).not.toHaveBeenCalled();
  });
  it("rejects a changed source when restoring a saved draft",async()=>{
    const {createHash}=await import("node:crypto");
    store.readObject.mockResolvedValue({value:{studioId:createHash("sha256").update(account).digest("hex"),state:{draftId:"draft-1"},sourceHash:"original"}});
    store.read.mockResolvedValue({result:{draft:{sourceHash:"changed"}}});
    expect((await versions(new Request(`https://programmable.market/api/custom-ai/versions?account=${account}&id=${"a".repeat(64)}`))).status).toBe(409);
  });
  it("reports only the authenticated account and leaves unknown usage unknown",async()=>{
    const completed=requestMetrics(100,[{model:"test",durationMs:1000,inputTokens:10,outputTokens:5,completed:true}],true,1100);
    const incomplete=requestMetrics(100,[{model:"test",durationMs:100,inputTokens:null,outputTokens:null,completed:false}],false,200);
    store.recentRequestMetrics.mockResolvedValue([incomplete,completed]);
    const response=await metrics(new Request("https://programmable.market/api/custom-ai/metrics"));
    const value=await response.json();
    expect(store.recentRequestMetrics).toHaveBeenCalledWith("owner-a");expect(value.incompleteTokenRecords).toBe(1);expect(value.failed).toBe(1);expect(value.knownInputTokens).toBe(10);expect(value.medianDurationMs).toBe(1000);
    expect(summarizeRequestMetrics([completed,{...completed,durationMs:3000}]).medianDurationMs).toBe(2000);
  });
});
