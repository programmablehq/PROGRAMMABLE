import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));

const work=vi.hoisted(()=>({runs:vi.fn(),releases:vi.fn(),jobs:vi.fn()}));
vi.mock("@/lib/custom-ai/platform/run-production.server",()=>({productionDispatchService:()=>({dispatchPending:work.runs})}));
vi.mock("@/lib/custom-ai/platform/runtime-production.server",()=>({productionAppReleases:()=>({processPending:work.releases}),productionAppJobs:()=>({dispatchDue:work.jobs})}));
import {GET} from "../app/api/ops/project-runtime/route";

const secret="project-runtime-test-secret-with-more-than-32-bytes";
const request=(authorization?:string)=>new Request("https://platform.example/api/ops/project-runtime",{headers:authorization?{authorization}:{}});
beforeEach(()=>{
 vi.stubEnv("CRON_SECRET",secret);vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED","true");
 work.runs.mockReset().mockResolvedValue({accepted:0,failed:0});
 work.releases.mockReset().mockResolvedValue({attempted:0});
 work.jobs.mockReset().mockResolvedValue({attempted:0,completed:0});
});
afterEach(()=>vi.unstubAllEnvs());

describe("project runtime cron authority",()=>{
 it("does no work for missing or incorrect credentials",async()=>{
  for(const auth of [undefined,"Bearer incorrect","Bearer "+secret.slice(0,-1),"Bearer "+secret+"x"]){
   expect((await GET(request(auth))).status).toBe(401);
  }
  expect(work.runs).not.toHaveBeenCalled();expect(work.releases).not.toHaveBeenCalled();expect(work.jobs).not.toHaveBeenCalled();
 });
 it("does no work with an absent or short configured secret",async()=>{
  for(const value of ["","short"]){vi.stubEnv("CRON_SECRET",value);expect((await GET(request("Bearer "+value))).status).toBe(401);}
  expect(work.runs).not.toHaveBeenCalled();expect(work.releases).not.toHaveBeenCalled();expect(work.jobs).not.toHaveBeenCalled();
 });
 it("keeps a valid scheduler inactive until project execution is explicitly enabled",async()=>{
  for(const value of ["","false"]){
   vi.stubEnv("CUSTOM_AI_PLATFORM_ENABLED",value);
   const response=await GET(request("Bearer "+secret));expect(response.status).toBe(200);expect(await response.json()).toEqual({disabled:true});
  }
  expect(work.runs).not.toHaveBeenCalled();expect(work.releases).not.toHaveBeenCalled();expect(work.jobs).not.toHaveBeenCalled();
 });
 it("dispatches only bounded batches with the valid scheduler authority",async()=>{
  const response=await GET(request("Bearer "+secret));expect(response.status).toBe(200);
  expect(work.runs).toHaveBeenCalledExactlyOnceWith(8);expect(work.releases).toHaveBeenCalledExactlyOnceWith(1);expect(work.jobs).toHaveBeenCalledExactlyOnceWith(4);
  expect(work.runs.mock.invocationCallOrder[0]).toBeLessThan(work.releases.mock.invocationCallOrder[0]);
  expect(work.releases.mock.invocationCallOrder[0]).toBeLessThan(work.jobs.mock.invocationCallOrder[0]);
 });
 it("reports failure without leaking a provider error or retrying the batch",async()=>{
  work.releases.mockRejectedValueOnce(new Error("private-provider-error-detail"));
  const response=await GET(request("Bearer "+secret));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"Project dispatch unavailable"});
  expect(work.runs).toHaveBeenCalledTimes(1);expect(work.releases).toHaveBeenCalledTimes(1);expect(work.jobs).not.toHaveBeenCalled();
 });
});
