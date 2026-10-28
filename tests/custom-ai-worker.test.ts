import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import { runDueJobs } from "../ops/custom-ai-worker/jobs";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { CUSTOM_AI_SCHEMA } from "../lib/custom-ai/store.server";
import { createOperationJournal } from "../lib/custom-ai/operation-journal.server";
let db: PGlite; let journal: ReturnType<typeof createOperationJournal>; let now = 1000;
beforeEach(async () => {
  db = new PGlite(); await db.exec(CUSTOM_AI_SCHEMA); now = 1000;
  let queued = Promise.resolve();
  journal = createOperationJournal({ connect: async () => {
    const prior = queued; let release!: () => void; queued = new Promise<void>(r => { release = r; }); await prior;
    return { query: async (sql, values) => db.query<Record<string, unknown>>(sql, values), release };
  } }, () => now);
});
afterEach(async () => { await db.close(); });
const input = { chainId: 1 as const, kind: "execute" as const, target: "0x1000000000000000000000000000000000000001", eventId: "weather:1", dueAt: 1000 };
describe("durable bounded operations", () => {
  it("allows only one worker to claim a due event and keeps signed bytes across restart", async () => {
    const op = (await journal.enqueue(input))!;
    expect((await journal.enqueue(input))?.id).toBe(op.id);
    const claims = await Promise.all([journal.claim(op.id), journal.claim(op.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const signed = await journal.signed(claims.find(Boolean)!, "0x1234", `0x${"ab".repeat(32)}`, 10n, 100n);
    now += 60001;
    expect(await journal.claim(op.id)).toMatchObject({ rawTransaction: signed.rawTransaction, transactionHash: signed.transactionHash });
  });
  it("rejects overspending without publishing a signed journal", async () => {
    const op = (await journal.enqueue(input))!; const claimed = (await journal.claim(op.id))!;
    await expect(journal.signed(claimed, "0x1234", `0x${"ab".repeat(32)}`, 101n, 100n)).rejects.toThrow("budget");
    expect((await journal.due())[0].rawTransaction).toBeUndefined();
  });
  it("serializes one signer across distinct events until the first outcome is known", async () => {
    const first = (await journal.claim((await journal.enqueue(input))!.id))!;
    const second = (await journal.claim((await journal.enqueue({ ...input, eventId: "weather:2" }))!.id))!;
    expect(await journal.acquireSigner(first, "operator")).toBe(true);
    expect(await journal.acquireSigner(second, "operator")).toBe(false);
    await journal.releaseSigner(first, "operator");
    expect(await journal.acquireSigner(second, "operator")).toBe(true);
  });
  it("does not let an expired worker release the replacement worker's signer", async () => {
    const queued = (await journal.enqueue(input))!;
    const old = (await journal.claim(queued.id))!;
    await journal.acquireSigner(old, "operator");
    now += 60001;
    const replacement = (await journal.claim(queued.id))!;
    await journal.acquireSigner(replacement, "operator");
    await expect(journal.acquireSigner(old, "operator")).rejects.toThrow("lease");
    await journal.releaseSigner(old, "operator");
    const other = (await journal.claim((await journal.enqueue({ ...input, eventId: "weather:other", dueAt: now }))!.id))!;
    expect(await journal.acquireSigner(other, "operator")).toBe(false);
  });
  it("checks the saved receipt after restart and never signs the same action twice", async () => {
    await journal.enqueue(input);
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const raw = await account.signTransaction({chainId:1,type:"eip1559",nonce:0,gas:21000n,maxFeePerGas:2n,maxPriorityFeePerGas:1n,to:input.target as `0x${string}`,value:0n});
    const prepare = vi.fn(async()=>({rawTransaction:raw}));
    const receipt = vi.fn().mockResolvedValueOnce({state:"pending"}).mockResolvedValueOnce({state:"confirmed",blockHash:`0x${"cc".repeat(32)}`});
    const adapter = {chainId:1 as const,signer:account.address,allowedTargets:new Set([input.target]),dailyLimitWei:100000n,transactionLimitWei:100000n,
      prepare,receipt,broadcast:vi.fn(async()=>keccak256(raw)),readOnly:async()=>undefined};
    await runDueJobs(journal,[adapter]);
    now += 60001; await runDueJobs(journal,[adapter]);
    now += 60001; await runDueJobs(journal,[adapter]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await journal.due()).toEqual([]);
  });
});
