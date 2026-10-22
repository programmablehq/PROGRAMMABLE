import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { CUSTOM_AI_SCHEMA, createAIStore, type AIStore } from "../lib/custom-ai/store.server";
import type { ChatRequest } from "../lib/custom-ai/types";
import type { WalletSession } from "../lib/custom-ai/launch-session";

let database: PGlite, store: AIStore;
let clock = Date.now();
const request = (id = "00000000-0000-4000-8000-000000000001"): ChatRequest => ({ id, intent: "build", messages: [{ role: "user", content: "Build a 3% fee." }] });
beforeEach(async () => {
  clock = Date.UTC(2026, 9, 22, 3);
  database = new PGlite();
  await database.exec(CUSTOM_AI_SCHEMA);
  let queue = Promise.resolve();
  store = createAIStore({ connect: async () => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return { query: async (sql, values) => database.query<Record<string, unknown>>(sql, values), release };
  } }, { hourlyUnits: 10, dailyUnits: 15, globalDailyUnits: 20, concurrent: 1 }, () => clock);
});
afterEach(async () => { await database.close(); });

describe("shared Custom AI storage", () => {
  it("holds a wallet across launch and trade dispatches until a definite outcome", async () => {
    const make=(id:string):WalletSession=>({id,account:"0x1000000000000000000000000000000000000001",chainId:1,state:"waiting",steps:[{
      id:`step-${id}`,kind:"approve",state:"dispatching",preparedBlock:"100",expiresAt:1800000000,
      transaction:{from:"0x1000000000000000000000000000000000000001",to:"0x2000000000000000000000000000000000000002",data:"0x",value:"0x0",nonce:"0x1",chainId:1,gas:"0x10000"},
    }]});
    const a=make(request().id),b=make("00000000-0000-4000-8000-000000000002");
    await store.saveObject("alice","launch",a.id,a,0);
    await store.saveObject("alice","trade",b.id,b,0);
    expect(await store.saveWalletAction("alice","launch",a,1)).toBe(2);
    await expect(store.saveWalletAction("alice","trade",b,1)).rejects.toMatchObject({status:409});
    a.steps[0].state="submitted";a.steps[0].hash=`0x${"ab".repeat(32)}`;
    await store.saveWalletAction("alice","launch",a,2);
    await expect(store.saveWalletAction("alice","trade",b,1)).rejects.toMatchObject({status:409});
    a.steps[0].state="confirmed";
    await store.saveWalletAction("alice","launch",a,3);
    expect(await store.saveWalletAction("alice","trade",b,1)).toBe(2);
  });
  it("rolls back an index batch before moving its cursor, and compares JSON independent of key order",async()=> {
    const id="a".repeat(64),coin="b".repeat(64);
    await store.saveIndexBatch(id,0,{height:10},[{id:coin,value:{address:"0xabc",chain:1}}]);
    await store.saveIndexBatch(id,1,{height:11},[{id:coin,value:{chain:1,address:"0xabc"}}]);
    await expect(store.saveIndexBatch(id,2,{height:12},[{id:coin,value:{chain:4663,address:"0xabc"}}])).rejects.toThrow("Conflicting");
    expect(await store.readObject("public","index",id)).toEqual({revision:2,value:{height:11}});
    await expect(store.saveIndexBatch(id,1,{height:13},[])).rejects.toMatchObject({status:409});
    expect(await store.listObjects("public","token")).toEqual([{chain:1,address:"0xabc"}]);
  });
  it("creates one active wallet launch and reconciles an identical concurrent create", async () => {
    const id = request().id;
    const value = { account: "0xabc", state: "preparing", inputHash: "same" };
    expect(await Promise.all([store.createLaunch("alice", id, value, "1:0xabc"), store.createLaunch("alice", id, value, "1:0xabc")])).toEqual([1,1]);
    await expect(store.createLaunch("alice", id, { ...value, inputHash: "different" }, "1:0xabc")).rejects.toMatchObject({ status: 409 });
    await expect(store.createLaunch("alice", request("00000000-0000-4000-8000-000000000002").id, value, "1:0xabc")).rejects.toMatchObject({ status: 409 });
    expect(await store.activeLaunch("alice", "0xABC")).toBe(id);
    expect(await store.activeLaunch("bob", "0xabc")).toBeNull();
  });
  it("dispatches the same exact request once across concurrent callers", async () => {
    const results = await Promise.all([store.reserve("alice", request()), store.reserve("alice", request())]);
    expect(results.filter(result => result.lease)).toHaveLength(1);
    await expect(store.reserve("alice", { ...request(), messages: [{ role: "user", content: "Change to 9%." }] })).rejects.toMatchObject({ status: 409 });
    await store.finish("alice", request().id, results[0].lease!, { reply: "Done." });
    expect(await store.reserve("alice", request())).toMatchObject({ lease: null, job: { state: "completed", result: { reply: "Done." } } });
  });
  it("isolates account reads, results and object versions", async () => {
    const reserved = await store.reserve("alice", request());
    await store.finish("alice", request().id, reserved.lease!, { reply: "Private draft." });
    expect(await store.read("bob", request().id)).toBeNull();
    expect(await store.list("bob")).toEqual([]);
    await store.saveObject("alice", "launch", request().id, { value: "alice" }, 0);
    expect(await store.readObject("bob", "launch", request().id)).toBeNull();
    await expect(store.saveObject("alice", "launch", request().id, {}, 0)).rejects.toMatchObject({ status: 409 });
    expect(await store.saveObject("alice", "launch", request().id, { value: "changed" }, 1)).toBe(2);
    await expect(store.saveObject("alice", "launch", request().id, {}, 1)).rejects.toMatchObject({ status: 409 });
  });
  it("reserves failed upstream calls and limits concurrent work", async () => {
    const a = await store.reserve("alice", request());
    await expect(store.reserve("alice", request("00000000-0000-4000-8000-000000000002"))).rejects.toMatchObject({ status: 429 });
    await store.finish("alice", request().id, a.lease!, undefined, "provider");
    const b = await store.reserve("alice", request("00000000-0000-4000-8000-000000000002"));
    await store.finish("alice", b.job.id, b.lease!, undefined, "provider");
    await expect(store.reserve("alice", request("00000000-0000-4000-8000-000000000003"))).rejects.toMatchObject({ status: 429 });
    expect((await store.reserve("alice", request())).lease).toBeNull();
  });
  it("enforces the global allowance across accounts and retains daily usage at hour rollover", async () => {
    for (const owner of ["alice", "bob", "carol", "dave"]) {
      const a = await store.reserve(owner, request());
      await store.finish(owner, a.job.id, a.lease!, undefined, "provider");
    }
    clock += 3_600_000;
    await expect(store.reserve("erin", request())).rejects.toMatchObject({ status: 429 });
    const usage = await database.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='global-day'");
    expect(usage.rows[0].used).toBe(20);
  });
  it("refunds a simple reply once and rejects the wrong completion lease", async () => {
    const a = await store.reserve("alice", { ...request(), intent: "chat" });
    await store.finish("alice", a.job.id, "wrong", { reply: "Wrong." });
    expect((await store.read("alice", a.job.id))?.state).toBe("running");
    await store.finish("alice", a.job.id, a.lease!, { reply: "Explanation." });
    await store.finish("alice", a.job.id, a.lease!, { reply: "Second." });
    const usage = await database.query<{ used: number }>("SELECT used FROM programmable_custom_ai_v1.budgets WHERE subject='global-day'");
    expect(usage.rows[0].used).toBe(1);
    expect((await store.read("alice", a.job.id))?.result?.reply).toBe("Explanation.");
  });
});
