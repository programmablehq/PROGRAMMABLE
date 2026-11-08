import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createReleaseRoutes} from "../lib/custom-ai/platform/runtime-http.server";
import type {createProjectReleases} from "../lib/custom-ai/platform/releases.server";
import type {ProjectScope} from "../lib/custom-ai/platform/types";

it("uses the bounded progress bucket only for a single owned release",async()=>{
 const consume=vi.fn(async()=>undefined),authorize=vi.fn(async()=>({ownerId:"alice"}));
 const read=vi.fn(async(scope:ProjectScope,id:string)=>({id,projectId:scope.projectId})),list=vi.fn(async()=>[]);
 const routes=createReleaseRoutes({enabled:()=>true,authorize,consume,releases:()=>({read,list}) as unknown as ReturnType<typeof createProjectReleases>});
 const response=await routes.GET(new Request("https://app.test/api/custom-ai/platform/releases?projectId=owned-project&releaseId=owned-release"));
 expect(response.status).toBe(200);expect(await response.json()).toEqual({release:{id:"owned-release",projectId:"owned-project"}});
 expect(consume).toHaveBeenLastCalledWith("alice","progress");expect(authorize).toHaveBeenLastCalledWith(expect.any(Request),false);
 expect(read).toHaveBeenCalledWith({ownerId:"alice",projectId:"owned-project"},"owned-release");expect(list).not.toHaveBeenCalled();
 await routes.GET(new Request("https://app.test/api/custom-ai/platform/releases?projectId=owned-project"));
 expect(consume).toHaveBeenLastCalledWith("alice","read");
});

it("does not allow empty release ids to fetch a full list through the progress bucket",async()=>{
 const list=vi.fn(async()=>[]);
 const routes=createReleaseRoutes({enabled:()=>true,authorize:async()=>({ownerId:"alice"}),consume:async()=>undefined,releases:()=>({list}) as unknown as ReturnType<typeof createProjectReleases>});
 const response=await routes.GET(new Request("https://app.test/api/custom-ai/platform/releases?projectId=owned-project&releaseId="));
 expect(response.status).toBe(400);expect(list).not.toHaveBeenCalled();
});
