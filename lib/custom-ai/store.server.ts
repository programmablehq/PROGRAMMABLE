import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CHAT_PHASES, CustomAIError, isBriefChat, type AIUsage, type ChatPhase, type ChatRequest, type ChatResult } from "./types";
import type { ExecutionProfile } from "./ai-config";
import { refundsProviderFailure } from "./provider-errors";
import type { WalletAction, WalletSession } from "./launch-session";

export interface AIConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  release(): void;
}
export interface AIPool { connect(): Promise<AIConnection> }

// Applied by the release operator, never by a web request. The runtime role
// receives only SELECT/INSERT/UPDATE on these tables, not schema ownership.
export const CUSTOM_AI_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS programmable_custom_ai_v1;
CREATE TABLE IF NOT EXISTS programmable_custom_ai_v1.budgets (
  subject text NOT NULL, period bigint NOT NULL, used integer NOT NULL CHECK (used >= 0),
  PRIMARY KEY (subject, period)
);
CREATE TABLE IF NOT EXISTS programmable_custom_ai_v1.jobs (
  owner text NOT NULL, id text NOT NULL, payload_hash text NOT NULL,
  request jsonb NOT NULL, result jsonb, state text NOT NULL CHECK (state IN ('running','completed','failed')),
  lease text NOT NULL, reserved integer NOT NULL, hour bigint NOT NULL, day bigint NOT NULL,
  error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS custom_ai_jobs_owner_time ON programmable_custom_ai_v1.jobs(owner, created_at DESC);
CREATE TABLE IF NOT EXISTS programmable_custom_ai_v1.objects (
  owner text NOT NULL, kind text NOT NULL, id text NOT NULL, revision integer NOT NULL DEFAULT 1,
  value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (owner,kind,id)
);`;

export type AIJob = { id: string; executionProfile?: ExecutionProfile; state: "running" | "completed" | "failed"; result?: ChatResult; errorCode?: string;
  request?: ChatRequest; payloadHash?: string; phase?: ChatPhase; heartbeatAt?: number };
export type AIBudget = { hourlyUnits: number; dailyUnits: number; globalDailyUnits: number; concurrent: number };
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const unavailable = () => new CustomAIError("storage", "Your draft could not be saved. Try again shortly.", 503);
const identifier = (value: string) => typeof value === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(value);

export function createAIStore(pool: AIPool, limits: AIBudget, now: () => number = Date.now) {
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)) throw Error("Invalid Custom AI budget");
  async function transaction<T>(work: (connection: AIConnection) => Promise<T>) {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const result = await work(connection);
      await connection.query("COMMIT");
      return result;
    } catch (error) { await connection.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { connection.release(); }
  }
  function job(row: Record<string, unknown>, includeRequest = false): AIJob {
    const stored = row.request as (ChatRequest & { executionProfile?: ExecutionProfile; progress?: { phase?: ChatPhase } }) | undefined;
    const { executionProfile, progress, ...payload } = stored ?? {};
    const heartbeatAt = new Date(String(row.updated_at)).getTime();
    return { id: String(row.id), ...(executionProfile ? { executionProfile } : {}), state: row.state as AIJob["state"],
      ...(includeRequest && stored ? { request: payload as ChatRequest } : {}),
      ...(typeof row.payload_hash==="string"?{payloadHash:row.payload_hash}:{}),
      ...(progress?.phase && CHAT_PHASES.includes(progress.phase) ? { phase: progress.phase } : {}),
      ...(Number.isFinite(heartbeatAt) ? { heartbeatAt } : {}),
      ...(row.result ? { result: row.result as ChatResult } : {}),
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}) };
  }
  async function read(owner: string, id: string, includeRequest = true): Promise<AIJob | null> {
    return transaction(async db => {
      await db.query("UPDATE programmable_custom_ai_v1.jobs SET state='failed',error_code='interrupted',updated_at=now() WHERE owner=$1 AND id=$2 AND state='running' AND created_at < now()-interval '10 minutes'", [owner,id]);
      const fields=includeRequest?"*":"id,state,error_code,result,payload_hash,updated_at,jsonb_build_object('executionProfile',request->'executionProfile','progress',request->'progress') AS request";
      const { rows } = await db.query(`SELECT ${fields} FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2`, [owner, id]);
      if (rows[0]) return job(rows[0], includeRequest);
      const stopped = (await db.query("SELECT id FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='cancelled-request' AND id=$2",[owner,id])).rows[0];
      return stopped ? { id, state: "failed" as const, errorCode: "cancelled" } : null;
    });
  }
  async function reserve(owner: string, request: ChatRequest, profile?: ExecutionProfile) {
    if (!owner || owner.length > 512 || !identifier(request.id)) throw new CustomAIError("input", "Invalid request.");
    return transaction(async db => {
      // All reservations take these locks in the same order. Two website
      // machines cannot exceed either the global or per-account allowance.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const hash = digest(request);
      const previous = (await db.query("SELECT * FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2 FOR UPDATE", [owner, request.id])).rows[0];
      if (previous) {
        if (previous.payload_hash !== hash) throw new CustomAIError("conflict", "This request already has different settings. Start a new request.", 409);
        return { job: job(previous, true), lease: null };
      }
      if ((await db.query("SELECT id FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='cancelled-request' AND id=$2",[owner,request.id])).rows.length) {
        throw new CustomAIError("cancelled", "This saved request was stopped. Send again to start a new reply.", 409);
      }
      // Expired jobs are never silently dispatched a second time. Their full
      // reservation remains charged because an upstream call may have run.
      await db.query("UPDATE programmable_custom_ai_v1.jobs SET state='failed',error_code='interrupted',updated_at=now() WHERE state='running' AND created_at < now()-interval '10 minutes'");
      const active = (await db.query("SELECT count(*)::integer AS n FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND state='running'", [owner])).rows[0];
      if (Number(active.n) >= limits.concurrent) throw new CustomAIError("busy", "Your previous reply is still being prepared.", 429);
      const units = isBriefChat(request) ? 1 : 5, time = now();
      const hour = Math.floor(time / 3_600_000), day = Math.floor(time / 86_400_000);
      for (const [subject, period, limit] of [
        [`account-hour:${owner}`, hour, limits.hourlyUnits],
        [`account-day:${owner}`, day, limits.dailyUnits],
        ["global-day", day, limits.globalDailyUnits],
      ] as const) {
        const charged = await db.query(`INSERT INTO programmable_custom_ai_v1.budgets(subject,period,used)
          VALUES($1,$2,$3) ON CONFLICT(subject,period) DO UPDATE SET used=programmable_custom_ai_v1.budgets.used+$3
          WHERE programmable_custom_ai_v1.budgets.used+$3 <= $4 RETURNING used`, [subject, period, units, limit]);
        if (units > limit || !charged.rows.length) {
          const duration = subject.startsWith("account-hour:") ? 3_600_000 : 86_400_000;
          throw new CustomAIError("budget", "The current allowance is used up. Your draft is saved; check Usage for the reset time.", 429, (period + 1) * duration - time);
        }
      }
      const lease = randomUUID();
      await db.query(`INSERT INTO programmable_custom_ai_v1.jobs(owner,id,payload_hash,request,state,lease,reserved,hour,day)
        VALUES($1,$2,$3,$4,'running',$5,$6,$7,$8)`, [owner, request.id, hash, JSON.stringify({ ...request, ...(profile ? { executionProfile: profile } : {}) }), lease, units, hour, day]);
      return { job: { id: request.id, state: "running" } as AIJob, lease };
    });
  }
  async function finish(owner: string, id: string, lease: string, result?: ChatResult, errorCode?: string) {
    return transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const row = (await db.query("SELECT * FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2 AND lease=$3 FOR UPDATE", [owner, id, lease])).rows[0];
      if (!row || row.state !== "running") return false;
      const request = row.request as ChatRequest;
      const normalRefund = result && request.intent === "chat" && !result.draft && !result.chargedAs ? Number(row.reserved) - 1 : 0;
      // Return user allowance only for confirmed infrastructure rejection. The
      // global provider-cost ledger keeps every dispatched reservation.
      const accountRefund = refundsProviderFailure(errorCode) ? Number(row.reserved) : normalRefund;
      for (const [subject, period, refund] of [[`account-hour:${owner}`, row.hour, accountRefund],
        [`account-day:${owner}`, row.day, accountRefund], ["global-day", row.day, normalRefund]] as const) {
        if (refund > 0) await db.query("UPDATE programmable_custom_ai_v1.budgets SET used=used-$3 WHERE subject=$1 AND period=$2", [subject, period, refund]);
      }
      await db.query("UPDATE programmable_custom_ai_v1.jobs SET state=$4,result=$5,error_code=$6,updated_at=now() WHERE owner=$1 AND id=$2 AND lease=$3",
        [owner,id,lease,result ? "completed" : "failed", result ? JSON.stringify(result) : null, errorCode ?? null]);
      return true;
    });
  }
  async function setPhase(owner: string, id: string, lease: string, phase: ChatPhase) {
    if (!CHAT_PHASES.includes(phase)) throw new CustomAIError("phase", "Invalid saved request phase.");
    return transaction(async db => (await db.query(`UPDATE programmable_custom_ai_v1.jobs
      SET request=jsonb_set(request,'{progress}',jsonb_build_object('phase',$4::text)),updated_at=now()
      WHERE owner=$1 AND id=$2 AND lease=$3 AND state='running'
      AND request->'progress'->>'phase' IS DISTINCT FROM $4 RETURNING id`,[owner,id,lease,phase])).rows.length > 0);
  }
  async function heartbeat(owner: string, id: string, lease: string) {
    return transaction(async db => (await db.query(`UPDATE programmable_custom_ai_v1.jobs SET updated_at=now()
      WHERE owner=$1 AND id=$2 AND lease=$3 AND state='running' RETURNING id`,[owner,id,lease])).rows.length > 0);
  }
  async function cancel(owner: string, id: string): Promise<AIJob> {
    if (!identifier(id)) throw new CustomAIError("input", "Invalid saved request.");
    return transaction(async db => {
      // A stop can arrive before the original POST reserves its job. Use the
      // same lock as reserve so that a late reservation cannot start it again.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["custom-ai-budget-v1"]);
      await db.query("UPDATE programmable_custom_ai_v1.jobs SET state='failed',error_code='cancelled',updated_at=now() WHERE owner=$1 AND id=$2 AND state='running'", [owner, id]);
      const row = (await db.query("SELECT * FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$2", [owner, id])).rows[0];
      if (row) return job(row);
      await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,'cancelled-request',$2,'{}'::jsonb) ON CONFLICT DO NOTHING",[owner,id]);
      return { id, state: "failed" as const, errorCode: "cancelled" };
    });
  }
  async function list(owner: string) {
    return transaction(async db => (await db.query("SELECT id,state,created_at,result,error_code FROM programmable_custom_ai_v1.jobs WHERE owner=$1 ORDER BY created_at DESC LIMIT 30", [owner])).rows.map(row=>job(row)));
  }
  async function usage(owner: string): Promise<AIUsage> {
    return transaction(async db => {
      const time = now(), hour = Math.floor(time / 3_600_000), day = Math.floor(time / 86_400_000);
      const { rows } = await db.query(`SELECT subject,used FROM programmable_custom_ai_v1.budgets
        WHERE (subject=$1 AND period=$2) OR (subject=$3 AND period=$4) OR (subject='global-day' AND period=$4)`,
      [`account-hour:${owner}`, hour, `account-day:${owner}`, day]);
      const used = (subject: string) => Number(rows.find(row => row.subject === subject)?.used ?? 0);
      const window = (subject: string, limit: number, period: number, duration: number) => ({
        used: used(subject), limit, remaining: Math.max(0, limit - used(subject)), resetsAt: (period + 1) * duration,
      });
      const hourly = window(`account-hour:${owner}`, limits.hourlyUnits, hour, 3_600_000);
      const daily = window(`account-day:${owner}`, limits.dailyUnits, day, 86_400_000);
      const globalRemaining = limits.globalDailyUnits - used("global-day");
      const active = Number((await db.query("SELECT count(*)::integer AS n FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND state='running' AND created_at >= now()-interval '10 minutes'", [owner])).rows[0].n);
      return { hourly, daily, active, available: Math.min(hourly.remaining, daily.remaining, globalRemaining) >= 5 && active < limits.concurrent,
        resumesAt: Math.max(hourly.remaining < 5 ? hourly.resetsAt : 0, daily.remaining < 5 || globalRemaining < 5 ? daily.resetsAt : 0) };
    });
  }
  async function readObject<T>(owner: string, kind: string, id: string): Promise<{ revision: number; value: T } | null> {
    return transaction(async db => {
      const row = (await db.query("SELECT revision,value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind=$2 AND id=$3", [owner,kind,id])).rows[0];
      return row ? { revision: Number(row.revision), value: row.value as T } : null;
    });
  }
  async function saveObject(owner: string, kind: string, id: string, value: unknown, revision: number) {
    if (!identifier(id) || !/^[a-z-]{1,32}$/.test(kind) || !Number.isSafeInteger(revision) || revision < 0
      || Buffer.byteLength(JSON.stringify(value)) > 256_000) throw new CustomAIError("input", "This draft could not be saved.");
    return transaction(async db => {
      const row = revision === 0
        ? await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$2,$3,$4)
          ON CONFLICT DO NOTHING RETURNING revision`, [owner,kind,id,JSON.stringify(value)])
        : await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
          WHERE owner=$1 AND kind=$2 AND id=$3 AND revision=$5 RETURNING revision`, [owner,kind,id,JSON.stringify(value),revision]);
      if (!row.rows[0]) throw new CustomAIError("conflict", "This draft changed in another window. Reload it before continuing.", 409);
      if (kind === "studio" && value && typeof value === "object" && "draftId" in value && typeof value.draftId === "string") {
        const versionId=digest([id,value.draftId]);
        await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
          SELECT $1,'studio-version',$2,jsonb_build_object('studioId',$3::text,'state',$4::jsonb,'sourceHash',result->'draft'->>'sourceHash','summary',result->'draft'->>'hookSummary')
          FROM programmable_custom_ai_v1.jobs WHERE owner=$1 AND id=$5 AND state='completed' AND result->'draft' IS NOT NULL
          ON CONFLICT DO NOTHING`,[owner,versionId,id,JSON.stringify(value),value.draftId]);
      }
      return Number(row.rows[0].revision);
    });
  }
  async function consume(owner: string, operation: string, maximum: number, periodMs = 3_600_000) {
    return transaction(async db => {
      const charged = await db.query(`INSERT INTO programmable_custom_ai_v1.budgets(subject,period,used)
        VALUES($1,$2,1) ON CONFLICT(subject,period) DO UPDATE SET used=programmable_custom_ai_v1.budgets.used+1
        WHERE programmable_custom_ai_v1.budgets.used < $3 RETURNING used`,
      [`operation:${operation}:${owner}`, Math.floor(now() / periodMs), maximum]);
      if (!charged.rows.length) throw new CustomAIError("budget", "Too many requests. Give it a moment, then try again.", 429);
    });
  }
  async function createLaunch(owner: string, id: string, value: unknown, wallet: string, kind: WalletAction = "launch") {
    return transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`custom-ai-launch:${wallet}`]);
      const existing = (await db.query("SELECT revision,value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind=$3 AND id=$2", [owner,id,kind])).rows[0];
      if (existing) {
        if ((existing.value as { inputHash?: string }).inputHash !== (value as { inputHash?: string }).inputHash) {
          throw new CustomAIError("conflict", "This launch already has different settings.", 409);
        }
        return Number(existing.revision);
      }
      const activeId = digest(wallet);
      const prior = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind=$3 AND id=$2", [owner,activeId,`active-${kind}`])).rows[0];
      if (prior) {
        const previousId = (prior.value as { id: string }).id;
        const previous = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind=$3 AND id=$2", [owner,previousId,kind])).rows[0];
        const state = (previous?.value as { state?: string } | undefined)?.state;
        if (!state || !["confirmed","failed"].includes(state)) throw new CustomAIError("active", "Finish checking your saved launch before starting another one.", 409);
      }
      await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$4,$2,$3)", [owner,id,JSON.stringify(value),kind]);
      await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES($1,$4,$2,$3)
        ON CONFLICT(owner,kind,id) DO UPDATE SET value=$3,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()`, [owner,activeId,JSON.stringify({id}),`active-${kind}`]);
      return 1;
    });
  }
  async function activeLaunch(owner: string, account: string, kind: WalletAction = "launch") {
    return transaction(async db => {
      const row = (await db.query(`SELECT id FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind=$3
        AND lower(value->>'account')=$2 ORDER BY CASE WHEN value->>'state' IN ('confirmed','failed') THEN 1 ELSE 0 END,updated_at DESC LIMIT 1`, [owner,account.toLowerCase(),kind])).rows[0];
      return row ? String(row.id) : null;
    });
  }
  async function saveWalletAction(owner: string, kind: WalletAction, value: WalletSession, revision: number) {
    if (Buffer.byteLength(JSON.stringify(value)) > 256_000) throw new CustomAIError("journal", "This transaction history needs recovery before another step can be added.", 409);
    const walletId = digest(`${value.chainId}:${value.account.toLowerCase()}`);
    const step = value.steps.at(-1);
    return transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`custom-ai-wallet:${walletId}`]);
      const row = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='system' AND kind='wallet-dispatch' AND id=$1 FOR UPDATE", [walletId])).rows[0];
      const prior = row?.value as { owner?: string; kind?: string; id?: string; step?: string; released?: boolean } | undefined;
      const sameRequest = prior?.owner === owner && prior.kind === kind && prior.id === value.id;
      const same = sameRequest && prior.step === step?.id;
      const previousStep = sameRequest ? value.steps.find(item=>item.id===prior.step) : undefined;
      const sameNonceReplacement = previousStep && step && previousStep.transaction.nonce===step.transaction.nonce;
      if (step?.state === "dispatching" && prior && !prior.released && !same && !sameNonceReplacement) {
        throw new CustomAIError("pending", "Another Custom AI transaction is still waiting for this wallet. Finish checking it first.", 409);
      }
      const updated = await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
        WHERE owner=$1 AND kind=$2 AND id=$3 AND revision=$5 RETURNING revision`, [owner,kind,value.id,JSON.stringify(value),revision]);
      if (!updated.rows[0]) throw new CustomAIError("conflict", "This request changed in another window. Refresh it before continuing.", 409);
      const resolved = step && (["confirmed","failed"].includes(step.state) || step.state==="prepared" && step.walletRejected);
      if (step?.state === "dispatching" || (same || sameNonceReplacement) && resolved) {
        const lock = {owner,kind,id:value.id,step:step?.id,released:step?.state !== "dispatching"};
        await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('system','wallet-dispatch',$1,$2)
          ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()`, [walletId,JSON.stringify(lock)]);
      }
      return Number(updated.rows[0].revision);
    });
  }
  async function listObjects<T>(owner: string, kind: string): Promise<T[]> {
    return transaction(async db => {
      const rows = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind=$2 ORDER BY id LIMIT 10001", [owner,kind])).rows;
      if (rows.length > 10000) throw Error("Custom AI catalog requires pagination");
      return rows.map(row => row.value as T);
    });
  }
  async function draftVersions(owner:string,studioId:string) {
    return transaction(async db=>(await db.query(`SELECT id,value,updated_at FROM programmable_custom_ai_v1.objects
      WHERE owner=$1 AND kind='studio-version' AND value->>'studioId'=$2 ORDER BY updated_at DESC,id DESC LIMIT 20`,[owner,studioId])).rows);
  }
  async function recentRequestMetrics(owner:string) {
    return transaction(async db=>(await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner=$1 AND kind='request-metrics' ORDER BY updated_at DESC LIMIT 100",[owner])).rows.map(r=>r.value));
  }
  async function saveIndexBatch(id: string, revision: number, cursor: unknown, tokens: readonly { id: string; value: unknown }[]) {
    return transaction(async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`custom-ai-index:${id}`]);
      const prior = (await db.query("SELECT revision FROM programmable_custom_ai_v1.objects WHERE owner='public' AND kind='index' AND id=$1 FOR UPDATE", [id])).rows[0];
      if (Number(prior?.revision ?? 0) !== revision) throw new CustomAIError("index-conflict", "The index is already advancing.", 409);
      for (const token of tokens) {
        const previous = (await db.query("SELECT value FROM programmable_custom_ai_v1.objects WHERE owner='public' AND kind='token' AND id=$1", [token.id])).rows[0];
        if (previous && digest(previous.value) !== digest(token.value)) throw Error("Conflicting finalized Custom AI token");
        await db.query("INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('public','token',$1,$2) ON CONFLICT DO NOTHING", [token.id,JSON.stringify(token.value)]);
      }
      await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value) VALUES('public','index',$1,$2)
        ON CONFLICT(owner,kind,id) DO UPDATE SET value=$2,revision=programmable_custom_ai_v1.objects.revision+1,updated_at=now()`, [id,JSON.stringify(cursor)]);
    });
  }
  return { reserve, finish, read, setPhase, heartbeat, cancel, list, usage, readObject, saveObject, consume, createLaunch, activeLaunch, saveWalletAction, listObjects, draftVersions, recentRequestMetrics, saveIndexBatch };
}

export type AIStore = ReturnType<typeof createAIStore>;
let production: AIStore | undefined;
export function productionAIStore(): AIStore {
  if (production) return production;
  const value = process.env.CUSTOM_AI_DATABASE_URL;
  if (!value) throw unavailable();
  const url = new URL(value);
  if (!["postgres:","postgresql:"].includes(url.protocol) || !url.username || !url.password || !url.hostname
    || url.hash || [...url.searchParams.keys()].some(key => /ssl|options|role/i.test(key))) throw unavailable();
  const pool = new Pool({ connectionString: value, ssl: {
    rejectUnauthorized: true, servername: url.hostname,
    ...(process.env.CUSTOM_AI_DATABASE_CA ? { ca: process.env.CUSTOM_AI_DATABASE_CA } : {}),
  }, max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
  pool.on("error", () => undefined);
  const cap = Number(process.env.CUSTOM_AI_GLOBAL_DAILY_UNITS);
  if (!Number.isSafeInteger(cap) || cap < 5 || cap > 10000) throw unavailable();
  production = createAIStore(pool, { hourlyUnits: 25, dailyUnits: 100, globalDailyUnits: cap, concurrent: 1 });
  return production;
}
