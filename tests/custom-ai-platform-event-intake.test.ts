import {afterEach,expect,it,vi} from "vitest";
import {ProjectError} from "../lib/custom-ai/platform/types";
const mocks=vi.hoisted(()=>({consume:vi.fn(),route:vi.fn(),ingest:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("../lib/custom-ai/store.server",()=>({productionAIStore:()=>({consume:mocks.consume})}));
vi.mock("../lib/custom-ai/platform/event-production.server",()=>({productionGameEvents:()=>({route:mocks.route,ingest:mocks.ingest})}));
import {POST} from "../app/api/custom-ai/platform/events/ingest/[id]/route";
const previous=process.env.CUSTOM_AI_PLATFORM_ENABLED;
afterEach(()=>{vi.clearAllMocks();if(previous===undefined)delete process.env.CUSTOM_AI_PLATFORM_ENABLED;else process.env.CUSTOM_AI_PLATFORM_ENABLED=previous;});
it("does not charge another owner's AI allowance for an invalid public event",async()=>{
 process.env.CUSTOM_AI_PLATFORM_ENABLED="true";
 mocks.route.mockResolvedValue({ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111"});
 mocks.ingest.mockRejectedValue(new ProjectError("game-signature","Invalid signature.",403));
 const id="0x"+"11".repeat(32),request=new Request("https://programmable.market/api/custom-ai/platform/events/ingest/"+id,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
 expect((await POST(request,{params:Promise.resolve({id})})).status).toBe(403);
 expect(mocks.consume).not.toHaveBeenCalled();
});
