import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { AIPool, AIConnection } from "./store.server";
export type Operation = { id: string; chainId: 1 | 4663; kind: "feed" | "price" | "collect" | "execute" | "index";
  target: string; eventId: string; dueAt: number; state: "pending" | "leased" | "signed" | "broadcast" | "confirmed" | "failed" | "attention";
  lease?: string; leaseUntil?: number; rawTransaction?: string; transactionHash?: string; costCeilingWei?: string;
  confirmedBlockHash?: string; attempts: number; error?: string };
const key = (chainId: number, target: string, eventId: string) => createHash("sha256").update(`${chainId}:${target.toLowerCase()}:${eventId}`).digest("hex");
export function createOperationJournal(pool: AIPool, now = Date.now) {
  async function transaction<T>(work: (db: AIConnection) => Promise<T>) { const db = await pool.connect();
    try { await db.query("BEGIN"); const result = await work(db); await db.query("COMMIT"); return result; }
    catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; } finally { db.release(); } }
  const read = async (db: AIConnection, id: string) => (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='operation' AND id=$1 FOR UPDATE", [id])).rows[0]?.value as Operation | undefined;
  const write = async (db: AIConnection, value: Operation) => { await db.query("UPDATE programmable_custom_ai_v1.objects SET value=$2,revision=revision+1,updated_at=now() WHERE owner='system' AND kind='operation' AND id=$1", [value.id, JSON.stringify(value)]); };
  return {
    async enqueue(input: Omit<Operation, "id" | "state" | "attempts">) {
      if (![1,4663].includes(input.chainId) || !/^0x[0-9a-f]{40}$/i.test(input.target) || !input.eventId || input.eventId.length > 256 || !Number.isSafeInteger(input.dueAt)) throw Error("Invalid worker operation");
      const id = key(input.chainId, input.target, input.eventId);
      return transaction(async db => { const operation = { ...input, id, state: "pending" as const, attempts: 0 };
        await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','operation',$1,$2) ON CONFLICT DO NOTHING", [id, JSON.stringify(operation)]);
        return await read(db, id); });
    },
    async due(limit = 8) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw Error("Invalid worker batch");
      return transaction(async db => (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='operation' AND value->>'state' NOT IN ('confirmed','failed','attention') AND (value->>'dueAt')::bigint <= $1 ORDER BY (value->>'dueAt')::bigint,id LIMIT $2", [now(), limit])).rows.map(r => r.value as Operation));
    },
    async claim(id: string) { return transaction(async db => { const op = await read(db, id);
      if (!op || ["confirmed", "failed", "attention"].includes(op.state) || op.dueAt > now() || (op.leaseUntil ?? 0) > now()) return null;
      const value: Operation = { ...op, state: op.rawTransaction ? op.state : "leased", lease: randomUUID(), leaseUntil: now() + 60000, attempts: op.attempts + 1 };
      await write(db, value); return value; }); },
    async acquireSigner(op: Operation, address: string) { return transaction(async db => {
      const id = key(op.chainId, address, "signer");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
      const prior = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='worker-signer' AND id=$1 FOR UPDATE", [id])).rows[0]?.value as { operation?: string } | undefined;
      if (prior?.operation && prior.operation !== op.id) return false;
      await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','worker-signer',$1,$2) ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()", [id, JSON.stringify({ operation: op.id })]);
      return true;
    }); },
    async releaseSigner(op: Operation, address: string) { return transaction(async db => {
      const id = key(op.chainId, address, "signer");
      await db.query("UPDATE programmable_custom_ai_v1.objects SET value='{}'::jsonb,revision=revision+1 WHERE owner='system' AND kind='worker-signer' AND id=$1 AND value->>'operation'=$2", [id, op.id]);
    }); },
    async signed(op: Operation, raw: string, transactionHash: string, costCeilingWei: bigint, dailyLimitWei: bigint) { return transaction(async db => {
      const current = await read(db, op.id); if (!current || current.lease !== op.lease || current.rawTransaction || current.state !== "leased" || (current.leaseUntil ?? 0) <= now()) throw Error("Operation lease expired");
      if (!/^0x[0-9a-f]+$/i.test(raw) || raw.length > 64000 || !/^0x[0-9a-f]{64}$/i.test(transactionHash) || costCeilingWei < 0n) throw Error("Invalid signed operation");
      const budgetId = `worker-${op.chainId}-${Math.floor(now()/86400000)}`;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [budgetId]);
      const budget = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='worker-budget' AND id=$1 FOR UPDATE", [budgetId])).rows[0]?.value as { reserved: string } | undefined;
      const reserved = BigInt(budget?.reserved ?? "0") + costCeilingWei;
      if (reserved > dailyLimitWei) throw Error("Worker daily budget reached");
      await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','worker-budget',$1,$2) ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()", [budgetId, JSON.stringify({ reserved: reserved.toString() })]);
      const value: Operation = { ...current, rawTransaction: raw, transactionHash, costCeilingWei: costCeilingWei.toString(), state: "signed" };
      await write(db, value); return value;
    }); },
    async complete(op: Operation, state: Operation["state"], blockHash?: string) { return transaction(async db => { const current = await read(db, op.id);
      if (!current || current.lease !== op.lease) throw Error("Operation lease expired");
      const value = { ...current, state, leaseUntil: state === "broadcast" ? now() + 15000 : 0,
        ...(blockHash ? { confirmedBlockHash: blockHash } : {}) };
      await write(db, value); return value; }); },
    async defer(op: Operation) { return transaction(async db => { const current = await read(db, op.id);
      if (!current || current.lease !== op.lease) return;
      await write(db, { ...current, ...(current.attempts >= 12 ? { state: "attention" as const } : {}), leaseUntil: 0, dueAt: now() + Math.min(300000, 15000 * 2 ** Math.min(current.attempts, 4)) }); }); },
  };
}
export type OperationJournal = ReturnType<typeof createOperationJournal>;
