import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const calls=vi.hoisted(()=>({authenticate:vi.fn(),resolve:vi.fn(),consume:vi.fn()}));
vi.mock("@/lib/server/creator-article/wallet-principal.server",()=>({
 createPrivyWalletPrincipalAuthenticatorV1:()=>({authenticate:calls.authenticate}),
 WalletPrincipalAuthenticationErrorV1:class extends Error{constructor(readonly status:number){super("authentication");}},
}));
vi.mock("@/lib/server/custom-launch/launch-send-resolution-v1",()=>({readLaunchSendResolutionV1:calls.resolve}));
vi.mock("@/lib/server/custom-launch/routed-trade-rpc-v1",()=>({productionTradeRpcsV1:()=>[]}));
vi.mock("@/lib/custom-ai/store.server",()=>({productionAIStore:()=>({consume:calls.consume})}));
import {POST} from "@/app/api/developer/custom-launch-plans/[launchId]/resolve-send/route";
import {CustomAIError} from "@/lib/custom-ai/types";
import {controller,hash} from "./fixtures/universal-launch-v1";
import {atomicRecordFixture} from "./fixtures/atomic-launch-v2";
const record=atomicRecordFixture(),step=record.steps[0];
const attempt={schemaVersion:"programmable.custom-launch-send.v1",sourceVersion:"custom_launch_plan_v1",launchId:record.planId,stepId:step.stepId,binding:step.transactionDigest,controller,chainId:"4663",nonce:"0x7",startedAt:"2026-10-12T20:00:00.000Z",transactionHash:hash,
 transaction:{chainId:"0x1237",from:controller,to:step.transaction.to,data:step.transaction.data,value:"0x0",gas:"0x100000",nonce:"0x7"}};
const request=(changes:{origin?:string;controller?:string;body?:unknown}={})=>new Request(`https://programmable.market/api/developer/custom-launch-plans/${record.planId}/resolve-send?walletAddress=${changes.controller??controller}&source=custom_launch_plan_v1`,{method:"POST",headers:{"Content-Type":"application/json",Origin:changes.origin??"https://programmable.market"},body:JSON.stringify(changes.body??{attempt})});
const context={params:Promise.resolve({launchId:record.planId})};
beforeEach(()=>{vi.clearAllMocks();calls.authenticate.mockResolvedValue({privyUserId:"owner",wallets:[controller]});calls.resolve.mockResolvedValue(null);});
it("requires the current linked wallet before observing a nonce",async()=>{
 const response=await POST(request({controller:`0x${"99".repeat(20)}`}),context);expect(response.status).toBe(403);expect(calls.resolve).not.toHaveBeenCalled();expect(calls.consume).not.toHaveBeenCalled();
});
it("rejects foreign origins and mismatched launch identities",async()=>{
 expect((await POST(request({origin:"https://foreign.invalid"}),context)).status).toBe(403);
 expect((await POST(request({body:{attempt:{...attempt,launchId:"00000000-0000-4000-8000-000000000000"}}}),context)).status).toBe(400);
 expect(calls.resolve).not.toHaveBeenCalled();
});
it("returns a private read-only resolution and enforces the per-owner rate limit",async()=>{
 const response=await POST(request(),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({resolution:null});expect(response.headers.get("cache-control")).toBe("private, no-store");expect(calls.consume).toHaveBeenCalledWith("owner","launch-send-resolution",6,60000);expect(calls.resolve).toHaveBeenCalledOnce();
 calls.consume.mockRejectedValueOnce(new CustomAIError("rate_limit","Wait",429));expect((await POST(request(),context)).status).toBe(429);expect(calls.resolve).toHaveBeenCalledOnce();
});
