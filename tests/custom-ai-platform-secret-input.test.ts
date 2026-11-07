import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {containsInlineCredential,redactInlineCredentials} from "../lib/custom-ai/platform/secret-input";
import {createRunStore} from "../lib/custom-ai/platform/runs.server";
import type {AIPool} from "../lib/custom-ai/store.server";

const fakeKey=`sk-proj-${"fixture".repeat(10)}`;
it("recognizes pasted provider keys and explicit credential assignments without blocking instructions",()=>{
 for(const value of [fakeKey,`github_pat_${"fixture".repeat(8)}`,`API_KEY = '${"examplecredential".repeat(3)}'`,`Authorization: Bearer ${"fixture".repeat(8)}`])expect(containsInlineCredential(value)).toBe(true);
 for(const value of ["Use a private API key in Connections.","API_KEY=${API_KEY}","apiKey: process.env.API_KEY","0x"+"a".repeat(40),"Score is 12345."])expect(containsInlineCredential(value)).toBe(false);
 expect(redactInlineCredentials(`Problem with ${fakeKey}`)).toBe("Problem with [redacted]");
});
it("rejects a pasted key before a run is stored or any budget is reserved",async()=>{
 const connect=vi.fn(),pool={connect} as unknown as AIPool;
 const runs=createRunStore(pool,{allowance:{hourlyUnits:100,dailyUnits:200,globalDailyUnits:1000,concurrent:1},leaseMs:60000,capabilities:{}});
 await expect(runs.startRun({ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111",revisionId:`sha256:${"a".repeat(64)}`,idempotencyKey:"pasted-secret",prompt:`Use this key ${fakeKey}`,operation:"build",budgetUnits:20})).rejects.toMatchObject({code:"project-secret"});
 expect(connect).not.toHaveBeenCalled();
});
