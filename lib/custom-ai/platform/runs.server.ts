import "server-only";
import { randomUUID } from "node:crypto";
import type { AIConnection, AIPool, AIBudget } from "../store.server";
import { reserveAIUnits, refundAIUnits } from "../budget.server";
import { projectTransaction } from "./transaction.server";
import { canonicalProjectJSON, projectHash } from "./document";
import { ProjectError, type JsonValue, type ProjectScope } from "./types";
import type { RunSnapshot, RunStatus } from "./protocol.generated";
import { PROJECT_PROTOCOL_HASH } from "./protocol.generated";
import { projectDate } from "./time";
import {containsInlineCredential,redactCredentialData,redactInlineCredentials} from "./secret-input";

type Operation = "plan" | "build" | "test" | "deploy";
type Capability = { units: number; effect: "read" | "write"; operations: Operation[] };
type RunOptions = { allowance: AIBudget; leaseMs: number; capabilities: Record<string, Capability> };
type RunView = RunSnapshot & { reservedUnits: number; usedUnits: number; createdAt: string; summary?: string };
type RunRow = Record<string, unknown>;
const missing = () => new ProjectError("run-missing", "This project run was not found.", 404);
const invalid = () => new ProjectError("run-input", "Use a valid project work request.");
const key = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

function view(row: RunRow): RunView {
  return { ownerId: String(row.owner), projectId: String(row.project_id), revisionId: String(row.revision_id), runId: String(row.id),
    status: row.status as RunStatus, cursor: String(row.cursor), evidence: [], reservedUnits: Number(row.reserved_units), usedUnits: Number(row.used_units), createdAt: projectDate(row.created_at).toISOString(),
    ...(typeof row.summary === "string" ? { summary: row.summary } : {}) };
}

export function createRunStore(pool: AIPool, options: RunOptions, now: () => number = Date.now) {
  options = structuredClone(options);
  if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs < 1000 || options.leaseMs > 300_000
    || Object.values(options.allowance).some(value => !Number.isSafeInteger(value) || value < 1)
    || Object.values(options.capabilities).some(value => !Number.isSafeInteger(value.units) || value.units < 0 || !["read", "write"].includes(value.effect)
      || !Array.isArray(value.operations) || !value.operations.length || value.operations.some(operation => !["plan", "build", "test", "deploy"].includes(operation)))) throw new TypeError("Invalid run limits");
  const policyHash = projectHash({ protocol: PROJECT_PROTOCOL_HASH, capabilities: options.capabilities });

  async function row(db: AIConnection, scope: ProjectScope, runId: string, lock = false): Promise<RunRow> {
    if (!/^[a-f0-9-]{36}$/i.test(runId)) throw missing();
    const value = (await db.query(`SELECT * FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [scope.ownerId, scope.projectId, runId])).rows[0];
    if (!value) throw missing();
    return value;
  }
  async function leased(db: AIConnection, scope: ProjectScope, runId: string, token: string) {
    const value = await row(db, scope, runId, true);
    if (value.status !== "running" || value.lease_token !== token || projectDate(value.lease_until).getTime() <= now()) {
      throw new ProjectError("run-lease", "This worker no longer owns the project run.", 409);
    }
    if (value.policy_hash !== policyHash) throw new ProjectError("run-policy", "This run uses a different tool policy.", 409);
    return value;
  }
  async function settle(db: AIConnection, scope: ProjectScope, value: RunRow) {
    if (value.settled) return;
    await refundAIUnits(db, scope.ownerId, Number(value.reserved_units) - Number(value.used_units), Number(value.reserved_hour), Number(value.reserved_day));
    await db.query("UPDATE programmable_projects_v1.runs SET settled=true WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, value.id]);
  }
  async function expire(db: AIConnection, scope: ProjectScope, value: RunRow) {
    await settle(db, scope, value);
    await db.query("UPDATE programmable_projects_v1.runs SET status='failed',summary='Work unit expired; continue from the saved project.',lease_token=NULL,lease_until=NULL,updated_at=$4 WHERE owner=$1 AND project_id=$2 AND id=$3",
      [scope.ownerId, scope.projectId, value.id, new Date(now()).toISOString()]);
    await db.query("UPDATE programmable_projects_v1.run_steps SET state='unknown' WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND state='dispatching'", [scope.ownerId, scope.projectId, value.id]);
    await db.query("DELETE FROM programmable_projects_v1.dispatch_outbox WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, value.id]);
  }
  async function startRun(input: ProjectScope & { revisionId: string; operation: Operation; prompt: string; idempotencyKey: string; budgetUnits: number }): Promise<RunView> {
    if (!key(input.idempotencyKey) || !["plan", "build", "test", "deploy"].includes(input.operation)
      || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 24_000 || !/^sha256:[a-f0-9]{64}$/.test(input.revisionId)) throw invalid();
    if(containsInlineCredential(input.prompt))throw new ProjectError("project-secret","This message appears to contain a private credential. Remove it and save it in the project's private Connections field instead.",422);
    const scope = { ownerId: input.ownerId, projectId: input.projectId }, requestHash = projectHash(input);
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const previous = (await db.query("SELECT * FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND request_key=$3", [scope.ownerId, scope.projectId, input.idempotencyKey])).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) throw new ProjectError("run-idempotency", "This request identifier was used for different work.", 409);
        return view(previous);
      }
      const project = (await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE", [scope.ownerId, scope.projectId])).rows[0];
      if (!project) throw missing();
      if (project.current_revision !== input.revisionId) throw new ProjectError("project-conflict", "Start work from the current project revision.", 409);
      const abandoned = (await db.query("SELECT * FROM programmable_projects_v1.runs WHERE owner=$1 AND NOT settled AND status IN ('queued','running','retryable','waiting_user') AND created_at<$2 FOR UPDATE",
        [scope.ownerId, new Date(now() - 600_000).toISOString()])).rows;
      for (const previous of abandoned) await expire(db, { ownerId: scope.ownerId, projectId: String(previous.project_id) }, previous);
      const active = (await db.query("SELECT count(*) AS count FROM programmable_projects_v1.runs WHERE owner=$1 AND NOT settled AND status IN ('queued','running','retryable','waiting_user')", [scope.ownerId])).rows[0];
      if (Number(active.count) >= options.allowance.concurrent) throw new ProjectError("run-busy", "Finish or stop your current project run first.", 429);
      const periods = await reserveAIUnits(db, scope.ownerId, input.budgetUnits, options.allowance, now());
      const id = randomUUID(), timestamp = new Date(now()).toISOString();
      const saved = await db.query(`INSERT INTO programmable_projects_v1.runs(owner,project_id,id,request_key,request_hash,revision_id,operation,prompt,status,
        reserved_units,reserved_hour,reserved_day,created_at,updated_at,policy_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$11,$12,$12,$13) RETURNING *`,
        [scope.ownerId, scope.projectId, id, input.idempotencyKey, requestHash, input.revisionId, input.operation, input.prompt, input.budgetUnits, periods.hour, periods.day, timestamp, policyHash]);
      await db.query("INSERT INTO programmable_projects_v1.dispatch_outbox(owner,project_id,run_id,next_attempt_at) VALUES($1,$2,$3,$4)", [scope.ownerId, scope.projectId, id, timestamp]);
      return view(saved.rows[0]);
    });
  }
  async function readRun(scope: ProjectScope, runId: string): Promise<RunView> {
    return projectTransaction(pool, scope, async db => view(await row(db, scope, runId)));
  }
  async function listRuns(scope: ProjectScope) {
    return projectTransaction(pool, scope, async db => {
      if (!(await db.query("SELECT id FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2", [scope.ownerId, scope.projectId])).rows.length) throw missing();
      return (await db.query("SELECT * FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 ORDER BY created_at DESC,id DESC LIMIT 30", [scope.ownerId, scope.projectId])).rows
        .map(run => ({ ...view(run), prompt: String(run.prompt), operation: run.operation as Operation }));
    });
  }
  async function claimRun(scope: ProjectScope, runId: string, workerId: string) {
    if (!key(workerId)) throw invalid();
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const value = await row(db, scope, runId, true);
      if (!["queued", "retryable", "running"].includes(String(value.status)) || value.status === "running" && projectDate(value.lease_until).getTime() > now()) return null;
      if (now() - projectDate(value.created_at).getTime() > 600_000) {
        await expire(db, scope, value);
        return null;
      }
      if (value.policy_hash !== policyHash) throw new ProjectError("run-policy", "This run uses a different tool policy.", 409);
      const token = randomUUID(), until = new Date(now() + options.leaseMs).toISOString();
      const saved = await db.query("UPDATE programmable_projects_v1.runs SET status='running',lease_token=$4,lease_until=$5,worker_id=$6,updated_at=$7 WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *",
        [scope.ownerId, scope.projectId, runId, token, until, workerId, new Date(now()).toISOString()]);
      await db.query("UPDATE programmable_projects_v1.dispatch_outbox SET next_attempt_at=$4 WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, runId, until]);
      return { token, expiresAt: until, run: view(saved.rows[0]) };
    });
  }
  async function heartbeat(scope: ProjectScope, runId: string, token: string): Promise<boolean> {
    return projectTransaction(pool, scope, async db => {
      const updated = await db.query(`UPDATE programmable_projects_v1.runs SET lease_until=LEAST($5::timestamptz,created_at+interval '10 minutes'),updated_at=$6
        WHERE owner=$1 AND project_id=$2 AND id=$3 AND lease_token=$4 AND policy_hash=$7 AND status='running' AND lease_until>$6 RETURNING id`,
        [scope.ownerId, scope.projectId, runId, token, new Date(now() + options.leaseMs).toISOString(), new Date(now()).toISOString(), policyHash]);
      if (updated.rows.length) await db.query(`UPDATE programmable_projects_v1.dispatch_outbox SET next_attempt_at=
        (SELECT lease_until FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND id=$3)
        WHERE owner=$1 AND project_id=$2 AND run_id=$3`, [scope.ownerId, scope.projectId, runId]);
      return updated.rows.length === 1;
    });
  }
  async function readWork(scope: ProjectScope, runId: string, token: string) {
    return projectTransaction(pool, scope, async db => {
      const run = await leased(db, scope, runId, token);
      const steps = (await db.query("SELECT id,cursor,capability_id,input,result,state,effect,attempts FROM programmable_projects_v1.run_steps WHERE owner=$1 AND project_id=$2 AND run_id=$3 ORDER BY cursor", [scope.ownerId, scope.projectId, runId])).rows;
      const history = (await db.query("SELECT prompt,summary FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND id<>$3 AND settled ORDER BY created_at DESC LIMIT 6", [scope.ownerId, scope.projectId, runId])).rows.reverse();
      return structuredClone({ run: view(run), prompt: String(run.prompt), operation: run.operation as Operation, steps, history, policyHash });
    });
  }
  async function leaseActive(scope: ProjectScope, runId: string, token: string) {
    return projectTransaction(pool, scope, async db => (await db.query("SELECT id FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND id=$3 AND lease_token=$4 AND status='running' AND lease_until>$5 AND policy_hash=$6",
      [scope.ownerId, scope.projectId, runId, token, new Date(now()).toISOString(), policyHash])).rows.length === 1);
  }
  async function readProgress(scope: ProjectScope, runId: string, afterCursor: string) {
    if (!/^(?:0|[1-9][0-9]?)$/.test(afterCursor) || Number(afterCursor) > 24) throw invalid();
    return projectTransaction(pool, scope, async db => {
      const run = await row(db, scope, runId);
      const steps = (await db.query("SELECT id,cursor,capability_id,state FROM programmable_projects_v1.run_steps WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND state='completed' AND cursor>=$4 ORDER BY cursor",
        [scope.ownerId, scope.projectId, runId, Number(afterCursor)])).rows;
      return { run: view(run), events: steps.map(step => ({ cursor: String(Number(step.cursor) + 1), stepId: String(step.id), capabilityId: String(step.capability_id), state: "completed" as const })) };
    });
  }
  async function resumeRun(scope: ProjectScope, runId: string, expectedCursor: string) {
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const run = await row(db, scope, runId, true);
      if (String(run.cursor) !== expectedCursor) throw new ProjectError("run-cursor", "Reload the saved progress before continuing.", 409);
      if (run.policy_hash !== policyHash) throw new ProjectError("run-policy", "This run uses a different tool policy.", 409);
      if (run.status !== "retryable" && run.status !== "queued") throw new ProjectError("run-state", "This work cannot be resumed in its current state.", 409);
      if (now() - projectDate(run.created_at).getTime() > 600_000) {
        await expire(db, scope, run);
        return view(await row(db, scope, runId));
      }
      const timestamp = new Date(now()).toISOString();
      await db.query("UPDATE programmable_projects_v1.dispatch_outbox SET next_attempt_at=$4 WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, runId, timestamp]);
      const saved = await db.query("UPDATE programmable_projects_v1.runs SET status='queued',updated_at=$4 WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *", [scope.ownerId, scope.projectId, runId, timestamp]);
      return view(saved.rows[0]);
    });
  }
  async function beginStep(scope: ProjectScope, runId: string, token: string, input: { id: string; capabilityId: string; input: JsonValue }) {
    if (!key(input.id) || !key(input.capabilityId) || canonicalProjectJSON(input.input).length > 600_000) throw invalid();
    if(containsInlineCredential(canonicalProjectJSON(input.input)))throw new ProjectError("project-secret","Use a private connection instead of inline credentials in a tool request.",422);
    return projectTransaction(pool, scope, async db => {
      const run = await leased(db, scope, runId, token), capability = Object.hasOwn(options.capabilities, input.capabilityId) ? options.capabilities[input.capabilityId] : undefined;
      if (!capability || !capability.operations.includes(run.operation as Operation)) throw new ProjectError("run-capability", "This tool is not available for this work.", 403);
      const hash = projectHash({ capabilityId: input.capabilityId, input: input.input });
      const previous = (await db.query("SELECT * FROM programmable_projects_v1.run_steps WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND id=$4", [scope.ownerId, scope.projectId, runId, input.id])).rows[0];
      if (previous) {
        if (previous.input_hash !== hash) throw new ProjectError("run-idempotency", "The saved tool action has different inputs.", 409);
        if (previous.state === "completed") return { execute: false, reconcile: false, result: previous.result as JsonValue };
        if (previous.lease_token === token && previous.state === "dispatching") return { execute: false, reconcile: false, pending: true };
        if (previous.effect === "write") {
          await db.query("UPDATE programmable_projects_v1.run_steps SET state='unknown',lease_token=$5 WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND id=$4", [scope.ownerId, scope.projectId, runId, input.id, token]);
          return { execute: false, reconcile: true };
        }
        if (Number(previous.attempts) >= 3) throw new ProjectError("run-attempts", "This step reached its retry limit.", 409);
      }
      if (Number(run.cursor) >= 24) throw new ProjectError("run-step-limit", "Continue from a new saved work unit.", 409);
      if (Number(run.used_units) + capability.units > Number(run.reserved_units)) throw new ProjectError("run-budget", "This work unit has used its reserved allowance.", 429);
      await db.query("UPDATE programmable_projects_v1.runs SET used_units=used_units+$4 WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, runId, capability.units]);
      await db.query(`INSERT INTO programmable_projects_v1.run_steps(owner,project_id,run_id,id,cursor,capability_id,input_hash,input,state,effect,lease_token)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'dispatching',$9,$10) ON CONFLICT(owner,project_id,run_id,id)
        DO UPDATE SET state='dispatching',attempts=programmable_projects_v1.run_steps.attempts+1,lease_token=EXCLUDED.lease_token`,
        [scope.ownerId, scope.projectId, runId, input.id, run.cursor, input.capabilityId, hash, JSON.stringify(input.input), capability.effect, token]);
      return { execute: true, reconcile: false };
    });
  }
  async function finishStep(scope: ProjectScope, runId: string, token: string, input: { id: string; result: JsonValue; reconciled?: boolean }) {
    if (!key(input.id) || canonicalProjectJSON(input.result).length > 600_000 || input.reconciled !== undefined && typeof input.reconciled !== "boolean") throw invalid();
    input={...input,result:redactCredentialData(input.result)};
    return projectTransaction(pool, scope, async db => {
      const run = await leased(db, scope, runId, token);
      const step = (await db.query("SELECT * FROM programmable_projects_v1.run_steps WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND id=$4", [scope.ownerId, scope.projectId, runId, input.id])).rows[0];
      if (step?.state === "completed" && projectHash(step.result) === projectHash(input.result)) return view(run);
      if (!step || step.lease_token !== token || Number(step.cursor) !== Number(run.cursor) || step.state !== "dispatching" && !(step.state === "unknown" && input.reconciled)) {
        throw new ProjectError("run-step", "This tool result does not match the active step.", 409);
      }
      await db.query("UPDATE programmable_projects_v1.run_steps SET state='completed',result=$5::jsonb WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND id=$4", [scope.ownerId, scope.projectId, runId, input.id, JSON.stringify(input.result)]);
      const updated = await db.query("UPDATE programmable_projects_v1.runs SET cursor=cursor+1,updated_at=$4 WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *", [scope.ownerId, scope.projectId, runId, new Date(now()).toISOString()]);
      return view(updated.rows[0]);
    });
  }
  async function finishRun(scope: ProjectScope, runId: string, token: string, summary: string, status: "succeeded" | "waiting_user" = "succeeded"): Promise<RunView> {
    if (typeof summary !== "string" || !summary.trim() || summary.length > 4000) throw invalid();
    summary=redactInlineCredentials(summary);
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const run = await leased(db, scope, runId, token);
      if ((await db.query("SELECT id FROM programmable_projects_v1.run_steps WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND state<>'completed' LIMIT 1", [scope.ownerId, scope.projectId, runId])).rows.length) {
        throw new ProjectError("run-unresolved", "Resolve the pending tool action before finishing this run.", 409);
      }
      await settle(db, scope, run);
      await db.query("DELETE FROM programmable_projects_v1.dispatch_outbox WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, runId]);
      const saved = await db.query("UPDATE programmable_projects_v1.runs SET status=$6,summary=$4,lease_token=NULL,lease_until=NULL,updated_at=$5 WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *", [scope.ownerId, scope.projectId, runId, summary, new Date(now()).toISOString(), status]);
      return view(saved.rows[0]);
    });
  }
  async function cancelRun(scope: ProjectScope, runId: string): Promise<RunView> {
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const run = await row(db, scope, runId, true);
      if (["cancelled", "failed", "succeeded"].includes(String(run.status))) return view(run);
      await settle(db, scope, run);
      await db.query("DELETE FROM programmable_projects_v1.dispatch_outbox WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, runId]);
      await db.query("UPDATE programmable_projects_v1.run_steps SET state='unknown' WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND state='dispatching'", [scope.ownerId, scope.projectId, runId]);
      const saved = await db.query("UPDATE programmable_projects_v1.runs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=$4 WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *", [scope.ownerId, scope.projectId, runId, new Date(now()).toISOString()]);
      return view(saved.rows[0]);
    });
  }
  async function failRun(scope: ProjectScope, runId: string, token: string, code: string, retryable: boolean): Promise<RunView> {
    if (!key(code) || typeof retryable !== "boolean") throw invalid();
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["custom-ai-budget-v1"]);
      const run = await leased(db, scope, runId, token);
      if (!retryable) await settle(db, scope, run);
      if (!retryable) await db.query("DELETE FROM programmable_projects_v1.dispatch_outbox WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, runId]);
      else await db.query("UPDATE programmable_projects_v1.dispatch_outbox SET next_attempt_at=$4 WHERE owner=$1 AND project_id=$2 AND run_id=$3", [scope.ownerId, scope.projectId, runId, new Date(now() + 15_000).toISOString()]);
      await db.query("UPDATE programmable_projects_v1.run_steps SET state='unknown' WHERE owner=$1 AND project_id=$2 AND run_id=$3 AND state='dispatching'", [scope.ownerId, scope.projectId, runId]);
      const saved = await db.query("UPDATE programmable_projects_v1.runs SET status=$4,summary=$5,lease_token=NULL,lease_until=NULL,updated_at=$6 WHERE owner=$1 AND project_id=$2 AND id=$3 RETURNING *",
        [scope.ownerId, scope.projectId, runId, retryable ? "retryable" : "failed", code, new Date(now()).toISOString()]);
      return view(saved.rows[0]);
    });
  }
  return { startRun, readRun, listRuns, claimRun, heartbeat, readWork, leaseActive, readProgress, resumeRun, beginStep, finishStep, finishRun, cancelRun, failRun,
    allowedCapabilities: (operation: Operation) => Object.entries(options.capabilities).filter(([, capability]) => capability.operations.includes(operation)).map(([id]) => id) };
}
