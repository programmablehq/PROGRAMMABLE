import { createHash } from "node:crypto";
import type { AIPool } from "../../lib/custom-ai/store.server";
import type { LaunchSession } from "../../lib/custom-ai/launch-session";
import type { BoundRuleSpec } from "../../lib/custom-ai/rule-compiler.server";
import type { Address, Hex } from "viem";
import bundle from "../../lib/custom-ai/composable-manifest.json";

export type ProgramTarget = { chainId:1|4663; token:Address; creator:Address; launchSalt:Hex; sourceHash:string;
  binding:BoundRuleSpec; router:Address; programs:Address[]; bundleHash:string; registeredAt:number };
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const address=(v:unknown):v is Address=>typeof v==="string"&&/^0x[0-9a-f]{40}$/i.test(v);
const cursorId=hash("composable-launch-discovery-v1");
/** Reads only confirmed account-owned launch journals; never model-supplied targets. */
export async function discoverProgramTargets(pool:AIPool, limit=16) {
  if (!Number.isSafeInteger(limit)||limit<1||limit>32)throw Error("Invalid discovery page");
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[cursorId]);
    const cursor=(await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='worker-cursor' AND id=$1 FOR UPDATE",[cursorId])).rows[0]?.value as {at:string;id:string;owner:string}|undefined;
    const rows=(await db.query("SELECT id,owner,value,updated_at::text AS cursor_at FROM programmable_custom_ai_v1.objects WHERE kind='launch' AND value->>'state'='confirmed' AND value ? 'composable' AND (updated_at,id,owner) > ($1::timestamptz,$2,$3) ORDER BY updated_at,id,owner LIMIT $4",[cursor?.at??"1970-01-01T00:00:00Z",cursor?.id??"",cursor?.owner??"",limit])).rows;
    let registered=0;
    for (const row of rows) {
      const s=row.value as LaunchSession;
      if(!s.composable?.spec.actions.length||!s.programPlan||!s.token||s.programPlan.bundleHash!==bundle.bundleHash)continue;
      if(![1,4663].includes(s.chainId)||!address(s.token)||!address(s.account)||!address(s.programPlan.router)||s.programPlan.programs.some(p=>!address(p))||s.programPlan.programs.length!==s.composable.spec.actions.length)throw Error("Invalid confirmed program journal");
      const target:ProgramTarget={chainId:s.chainId,token:s.token,creator:s.account,launchSalt:s.launchSalt,sourceHash:s.sourceHash,binding:s.composable,
        router:s.programPlan.router,programs:s.programPlan.programs,bundleHash:s.programPlan.bundleHash,registeredAt:Date.now()};
      await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','program-target',$1,$2) ON CONFLICT DO NOTHING",[hash(`${s.chainId}:${s.token.toLowerCase()}`),JSON.stringify(target)]);
      registered++;
    }
    const last=rows.at(-1);
    if(last)await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','worker-cursor',$1,$2) ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()",[cursorId,JSON.stringify({at:String(last.cursor_at),id:last.id,owner:last.owner})]);
    await db.query("COMMIT");return {registered,hasMore:rows.length===limit};
  }catch(error){await db.query("ROLLBACK").catch(()=>undefined);throw error;}finally{db.release();}
}
export async function listProgramTargets(pool:AIPool,after="",limit=8) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>20||after&&!/^[a-f0-9]{64}$/.test(after))throw Error("Invalid target page");
  const db=await pool.connect();try{
    const rows=(await db.query("SELECT id,value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='program-target' AND id>$1 ORDER BY id LIMIT $2",[after,limit+1])).rows;
    const total=Number((await db.query("SELECT count(*) AS total FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='program-target'")).rows[0]?.total??0);
    const page=rows.slice(0,limit);
    return {items:page.map(r=>r.value as ProgramTarget),next:rows.length>limit?String(page.at(-1)!.id):"",total};
  }finally{db.release();}
}
