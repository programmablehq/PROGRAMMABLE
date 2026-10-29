import { createHash, randomUUID } from "node:crypto";
import type { AIPool } from "../../lib/custom-ai/store.server";

export type PollSource = { id: string; intervalMs: number; run: () => Promise<void> };
type Schedule = { nextAt: number; lease: string; leaseUntil: number; failures: number; lastSuccess?: number };
const idFor = (id: string) => createHash("sha256").update(id).digest("hex");
export function createScheduler(pool: AIPool, now = Date.now) {
  async function update<T>(id: string, fn: (value?: Schedule) => { value: Schedule; result: T } | null) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`custom-ai-poll:${id}`]);
      const previous = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='worker-schedule' AND id=$1 FOR UPDATE", [id])).rows[0]?.value as Schedule | undefined;
      const next = fn(previous);
      if (next) await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','worker-schedule',$1,$2) ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()", [id, JSON.stringify(next.value)]);
      await db.query("COMMIT"); return next?.result;
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { db.release(); }
  }
  return {
    async run(sources: readonly PollSource[], maximum = 8, concurrency = 1) {
      if (sources.length > 256 || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 20 || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4 || new Set(sources.map(s => s.id)).size !== sources.length) throw Error("Invalid polling batch");
      const results: {id:string;status:"updated"|"deferred"|"busy"}[]=[];
      let index=0,reserved=0;
      const worker=async()=>{while(index<sources.length&&reserved<maximum){
        const source=sources[index++];reserved++;
        if (!/^[a-z0-9:.-]{1,180}$/i.test(source.id) || !Number.isSafeInteger(source.intervalMs) || source.intervalMs < 15000 || source.intervalMs > 3600000) throw Error("Invalid polling interval");
        const id=idFor(source.id), lease=randomUUID();
        const claimed=await update(id, previous => {
          if (previous && (previous.nextAt > now() || previous.leaseUntil > now())) return null;
          return {value:{...previous,nextAt:now()+source.intervalMs,lease,leaseUntil:now()+90000,failures:previous?.failures??0},result:true};
        });
        if (!claimed) { reserved--;results.push({id:source.id,status:"busy"}); continue; }
        let success=false;
        try { await source.run(); success=true; }
        catch { /* Keep provider details and credentials out of status records. */ }
        await update(id, previous => {
          if (!previous || previous.lease !== lease) return null;
          const failures=success?0:previous.failures+1;
          return {value:{...previous,leaseUntil:0,failures,nextAt:now()+(success?source.intervalMs:Math.min(3600000,source.intervalMs*2**Math.min(failures,5))),...(success?{lastSuccess:now()}: {})},result:true};
        });
        results.push({id:source.id,status:success?"updated":"deferred"});
      }};
      await Promise.all(Array.from({length:concurrency},worker));
      return results;
    },
  };
}
