import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only",()=>({}));
import { CUSTOM_AI_SCHEMA, type AIPool } from "../lib/custom-ai/store.server";
import { createScheduler } from "../ops/custom-ai-worker/scheduler";
import { pendingProgramFunds } from "../ops/custom-ai-worker/preparations.server";
import { discoverProgramTargets, listProgramTargets } from "../ops/custom-ai-worker/discovery";
import { createOperationJournal } from "../lib/custom-ai/operation-journal.server";
import manifest from "../lib/custom-ai/composable-manifest.json";
let db:PGlite,pool:AIPool,now:number;
beforeEach(async()=>{
  db=new PGlite();await db.exec(CUSTOM_AI_SCHEMA);now=100000;
  let queued=Promise.resolve();
  pool={connect:async()=>{const before=queued;let release!:()=>void;queued=new Promise<void>(r=>{release=r;});await before;return {query:async(sql,values)=>db.query<Record<string,unknown>>(sql,values),release};}};
});
afterEach(async()=>{await db.close();});
describe("worker scheduling and funded preparation",()=>{
  it("shares polling leases between instances and resumes after failures",async()=>{
    let calls=0;
    const sources=[{id:"weather:london",intervalMs:300000,run:async()=>{calls++;}}];
    await Promise.all([createScheduler(pool,()=>now).run(sources),createScheduler(pool,()=>now).run(sources)]);
    expect(calls).toBe(1);
    now+=300000;await createScheduler(pool,()=>now).run(sources);expect(calls).toBe(2);
    const failure={id:"weather:other",intervalMs:15000,run:vi.fn(async()=>{throw Error("provider");})};
    await createScheduler(pool,()=>now).run([failure]);
    now+=16000;await createScheduler(pool,()=>now).run([failure]);expect(failure.run).toHaveBeenCalledTimes(1);
    now+=15000;await createScheduler(pool,()=>now).run([failure]);expect(failure.run).toHaveBeenCalledTimes(2);
  });
  it("includes uncollected fees without taking the creator's rounding share",()=>{
    const input={programBalance:0n,allocated:0n,claimed:0n,totalCollected:0n,weight:10000n,totalWeight:10000n,
      ledgerPending:101n,vaultBalance:0n,vaultAccounted:0n,vaultTotalReceived:0n,creatorReceived:0n,creatorShareBps:3333n,availableRewards:0n,routerClaimable:0n};
    expect(pendingProgramFunds(input)).toBe(68n);
    expect(pendingProgramFunds({...input,ledgerPending:0n,vaultBalance:101n})).toBe(68n);
    expect(()=>pendingProgramFunds({...input,vaultAccounted:1n})).toThrow("accounting");
  });
  it("bounds parallel provider calls and does not exceed the iteration allowance",async()=>{
    let active=0,maximum=0,calls=0;
    let release!:()=>void;const firstWave=new Promise<void>(resolve=>{release=resolve;});
    const sources=Array.from({length:10},(_,i)=>({id:`pool:${i}`,intervalMs:30000,run:async()=>{
      active++;calls++;maximum=Math.max(maximum,active);if(active===3)release();await firstWave;active--;
    }}));
    await createScheduler(pool,()=>now).run(sources,5,3);
    expect(calls).toBe(5);expect(maximum).toBeLessThanOrEqual(3);expect(maximum).toBeGreaterThan(1);
    await createScheduler(pool,()=>now).run(sources,5,3);expect(calls).toBe(10);
  });
  it("keeps a failed operation visible to readiness on only its own network",async()=>{
    const journal=createOperationJournal(pool,()=>now),op=(await journal.enqueue({chainId:1,kind:"execute",target:`0x${"1".repeat(40)}`,eventId:"event-1",dueAt:now}))!;
    expect(await journal.needsAttention(1)).toBe(false);
    const claimed=(await journal.claim(op.id))!;await journal.complete(claimed,"failed");
    expect(await journal.needsAttention(1)).toBe(true);expect(await journal.needsAttention(4663)).toBe(false);
  });
  it("returns to the first page immediately at an exact capacity boundary",async()=>{
    for(let i=0;i<8;i++)await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','program-target',$1,$2)",[String(i).padStart(64,"0"),JSON.stringify({token:`coin-${i}`})]);
    const page=await listProgramTargets(pool,"",8);
    expect(page.items).toHaveLength(8);expect(page.next).toBe("");expect(page.total).toBe(8);
  });
  it("discovers confirmed programs in bounded pages and does not repeat them",async()=>{
    const target={state:"confirmed",chainId:1,token:`0x${"1".repeat(40)}`,account:`0x${"2".repeat(40)}`,launchSalt:`0x${"3".repeat(64)}`,sourceHash:"a".repeat(64),
      composable:{spec:{actions:[{kind:"liquidity"}]}},programPlan:{bundleHash:manifest.bundleHash,router:`0x${"4".repeat(40)}`,programs:[`0x${"5".repeat(40)}`]}};
    await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value,updated_at) VALUES('owner','launch','first',$1,'2026-10-29T01:00:00.123456Z'),('owner','launch','second',$1,'2026-10-29T01:00:00.123457Z')",[JSON.stringify(target)]);
    expect((await discoverProgramTargets(pool,1)).registered).toBe(1);
    expect((await discoverProgramTargets(pool,1)).registered).toBe(1);
    expect((await discoverProgramTargets(pool,1)).registered).toBe(0);
    const rows=await db.query("SELECT id FROM programmable_custom_ai_v1.objects WHERE kind='program-target'");expect(rows.rows).toHaveLength(1);
  });
});
