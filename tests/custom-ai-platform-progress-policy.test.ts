import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({store:vi.fn()}));
vi.mock("../lib/custom-ai/store.server",async original=>({...await original<typeof import("../lib/custom-ai/store.server")>(),productionAIStore:mocks.store}));
import {createAIStore,CUSTOM_AI_SCHEMA,type AIPool} from "../lib/custom-ai/store.server";
import {productionAccountDependencies} from "../lib/custom-ai/platform/production.server";
let db:PGlite,time:number;
beforeEach(async()=>{
 db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);time=Date.UTC(2026,10,7,12);
 const pool:AIPool={connect:async()=>({query:(sql,values)=>db.query<Record<string,unknown>>(sql,values),release(){}})};
 mocks.store.mockReturnValue(createAIStore(pool,{hourlyUnits:25,dailyUnits:100,globalDailyUnits:200,concurrent:1},()=>time));
});
afterEach(async()=>{await db.close();});
it("allows a long-running job to report progress without exhausting the hourly data-read budget",async()=>{
 const consume=productionAccountDependencies().consume;
 for(let i=0;i<150;i++){await consume("alice","progress");time+=5000;}
 await expect(consume("alice","read")).resolves.toBeUndefined();
});
it("retains finite bursts and the existing full-read and write limits",async()=>{
 const consume=productionAccountDependencies().consume;
 for(let i=0;i<120;i++)await consume("alice","progress");
 await expect(consume("alice","progress")).rejects.toMatchObject({status:429});
 time+=60000;await expect(consume("alice","progress")).resolves.toBeUndefined();
 for(let i=0;i<120;i++)await consume("alice","read");
 await expect(consume("alice","read")).rejects.toMatchObject({status:429});
 for(let i=0;i<30;i++)await consume("alice","write");
 await expect(consume("alice","write")).rejects.toMatchObject({status:429});
});
