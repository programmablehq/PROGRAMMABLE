import {it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const {publicHTTP}=vi.hoisted(()=>({publicHTTP:vi.fn()}));
vi.mock("../lib/custom-ai/platform/private-http.server",()=>({privateConnectorHTTP:publicHTTP}));
import {createVercelHostingProvider} from "../lib/custom-ai/platform/hosting-provider.server";
it("does not report a paused project while its deployment still serves requests",async()=>{
 vi.useFakeTimers();
 publicHTTP.mockResolvedValue({status:200,headers:{},text:'{"ok":true}'});
 const provider=createVercelHostingProvider({token:"private-token",teamId:"team_test",fetch:async()=>Response.json({accountId:"team_test",paused:true,targets:{production:{id:"dpl_test",url:"test.vercel.app",meta:{programmableRevision:`sha256:${"a".repeat(64)}`}}}})});
 try{const checked=expect(provider.pause("prj_test")).rejects.toMatchObject({code:"hosting-pending"});await vi.runAllTimersAsync();await checked;}finally{vi.useRealTimers();}
});
it("reuses a confirmed paused provider state only after its public endpoint is blocked",async()=>{
 publicHTTP.mockResolvedValue({status:503,headers:{},text:"DEPLOYMENT_PAUSED"});
 const send=vi.fn<typeof fetch>(async()=>Response.json({accountId:"team_test",paused:true,targets:{production:{id:"dpl_test",url:"test.vercel.app"}}}));
 await createVercelHostingProvider({token:"private-token",teamId:"team_test",fetch:send}).pause("prj_test");
 expect(send.mock.calls.every(([,options])=>options?.method==="GET")).toBe(true);
});
it("reconciles a promotion already applied by the provider without submitting it twice",async()=>{
 const send=vi.fn<typeof fetch>(async()=>Response.json({accountId:"team_test",targets:{production:{id:"dpl_test",readyState:"READY"}}}));
 await createVercelHostingProvider({token:"private-token",teamId:"team_test",fetch:send}).promote("prj_test","dpl_test");
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][1]?.method).toBe("GET");
});
it("accepts an empty acknowledgement only after the exact production target is observed",async()=>{
 const provider=createVercelHostingProvider({token:"private-token",teamId:"team_test",fetch:async(_url,init)=>init?.method==="POST"?new Response(null,{status:202}):Response.json({accountId:"team_test",targets:{production:{id:"dpl_test",readyState:"READY"}}})});
 await expect(provider.promote("prj_test","dpl_test")).resolves.toBeUndefined();
});
it("creates only an owned app project and disables provider identity credentials in generated runtimes",async()=>{
 const requests:{url:URL;body:Record<string,unknown>}[]=[];
 const send:typeof fetch=async(url,init)=>{
  const address=new URL(String(url)),body=JSON.parse(String(init?.body??"{}"));requests.push({url:address,body});
  if(init?.method==="GET")return Response.json({error:"missing"},{status:404});
  if(init?.method==="POST"){expect(body).toEqual({name:"programmable-000000000000000000000008",framework:null});return Response.json({id:"prj_test",name:body.name,accountId:"team_test"});}
  return Response.json({});
 };
 const provider=createVercelHostingProvider({token:"private-token",teamId:"team_test",fetch:send});
 expect(await provider.ensureProject("programmable-000000000000000000000008")).toEqual({id:"prj_test",name:"programmable-000000000000000000000008"});
 expect(requests.at(-1)?.body).toMatchObject({oidcTokenConfig:{enabled:false},autoExposeSystemEnvs:false,publicSource:false});
 expect(requests.every(r=>r.url.searchParams.get("teamId")==="team_test")).toBe(true);
});
it("never changes settings on a project returned from a different account",async()=>{
 const send=vi.fn(async()=>Response.json({id:"prj_foreign",name:"programmable-000000000000000000000008",accountId:"team_foreign"}));
 await expect(createVercelHostingProvider({token:"private-token",teamId:"team_test",fetch:send}).ensureProject("programmable-000000000000000000000008")).rejects.toMatchObject({code:"hosting-owner"});
 expect(send).toHaveBeenCalledOnce();
});
