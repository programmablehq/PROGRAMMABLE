import "server-only";
import { randomUUID } from "node:crypto";
import type { AIPool } from "../store.server";
import type { createPlatformStore } from "./project-store.server";
import { projectTransaction } from "./transaction.server";
import { projectHash } from "./document";
import { assertExportableFiles, projectFilePath } from "./files";
import { ProjectError, type ProjectScope, type ProjectFile } from "./types";

export type SandboxOutput = { exitCode: number; stdout: string; stderr: string; truncated: boolean };
export type SandboxResult=SandboxOutput&{files:Record<string,ProjectFile>;artifacts?:Record<string,string>;revisionId:string;jobId:string;durationMs:number};
export type SandboxInstance = {
  writeFiles(files: Record<string, ProjectFile>, signal: AbortSignal): Promise<void>;
  install(resolve: boolean, signal: AbortSignal): Promise<SandboxOutput>;
  execute(script: string, signal: AbortSignal): Promise<SandboxOutput>;
  readFile(path: string, signal: AbortSignal, maxBytes?: number): Promise<Buffer | null>;
  close(): Promise<void>;
};
export type SandboxProvider = {
  create(input: { name: string; timeoutMs: number; vcpus: number; network: "deny-all" }, signal: AbortSignal): Promise<SandboxInstance>;
  cleanup(name: string): Promise<void>;
};
const timeoutMs = 240_000;
const invalid = () => new ProjectError("sandbox-input", "Choose a valid project command.");

function dependencyPlan(files: Record<string, ProjectFile>, resolve: boolean) {
  if (!files["package.json"]) return false;
  try {
    if (typeof files["package.json"] !== "string") throw invalid();
    const pkg = JSON.parse(files["package.json"]);
    if (pkg.workspaces) throw invalid();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    if (Object.values(deps).some(value => typeof value !== "string" || /^(?:file:|link:|git|https?:|workspace:)/.test(value))) throw invalid();
    if (!Object.keys(deps).length && !resolve) return false;
    if (resolve) return true;
    if (typeof files["package-lock.json"] !== "string") throw invalid();
    const lock = JSON.parse(files["package-lock.json"]);
    if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== "object") throw invalid();
    for (const [name, raw] of Object.entries(lock.packages)) {
      const entry = raw as Record<string, unknown>;
      if (entry.link || name && (typeof entry.resolved !== "string" || !entry.resolved.startsWith("https://registry.npmjs.org/"))) throw invalid();
    }
    return true;
  } catch { throw new ProjectError("sandbox-lock", "Resolve and save a registry dependency lock before running this project.", 409); }
}

export function createSandboxExecutor(pool: AIPool, projects: ReturnType<typeof createPlatformStore>, provider: SandboxProvider, now = Date.now) {
  async function execute(input: ProjectScope & { revisionId: string; script: string; outputPaths: string[]; resolveDependencies?: boolean; artifactPaths?: string[] }, externalSignal?: AbortSignal):Promise<SandboxResult> {
    if (typeof input.script !== "string" || !input.script.trim() || input.script.length > 16_000 || !Array.isArray(input.outputPaths) || input.outputPaths.length > 32) throw invalid();
    const paths = input.outputPaths.map(projectFilePath);
    if(input.artifactPaths&&(!Array.isArray(input.artifactPaths)||input.artifactPaths.length>2))throw invalid();
    const artifactPaths=(input.artifactPaths??[]).map(projectFilePath);
    const scope = { ownerId: input.ownerId, projectId: input.projectId };
    const revision = await projects.readRevision(scope, input.revisionId);
    assertExportableFiles(revision.document.files);
    const install = dependencyPlan(revision.document.files, input.resolveDependencies === true);
    const id = randomUUID(), name = `programmable-${id}`, started = now(), day = Math.floor(started / 86_400_000);
    const signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    signal.throwIfAborted();
    await projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["project-sandbox-quota-v1"]);
      await db.query("DELETE FROM programmable_projects_v1.sandbox_slots WHERE expires_at<=$1", [new Date(started).toISOString()]);
      const slots = (await db.query("SELECT count(*) AS total,count(*) FILTER(WHERE owner=$1) AS owned FROM programmable_projects_v1.sandbox_slots", [scope.ownerId])).rows[0];
      if (Number(slots.total) >= 2 || Number(slots.owned) >= 1) throw new ProjectError("sandbox-busy", "Wait for the active sandbox to finish.", 429);
      for (const [subject, limit] of [[`owner:${scope.ownerId}`, 3_600_000], ["global", 7_200_000]] as const) {
        const reserved = await db.query(`INSERT INTO programmable_projects_v1.sandbox_usage(subject,period,used_ms) VALUES($1,$2,$3)
          ON CONFLICT(subject,period) DO UPDATE SET used_ms=programmable_projects_v1.sandbox_usage.used_ms+$3
          WHERE programmable_projects_v1.sandbox_usage.used_ms+$3<=$4 RETURNING used_ms`, [subject, day, timeoutMs, limit]);
        if (!reserved.rows.length) throw new ProjectError("sandbox-budget", "The sandbox allowance is used up for today. Your project is saved.", 429);
      }
      const expires = new Date(started + timeoutMs + 60_000).toISOString();
      await db.query(`INSERT INTO programmable_projects_v1.sandbox_jobs(owner,project_id,id,revision_id,provider_name,command_hash,state,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,'reserved',$7,$8)`, [scope.ownerId, scope.projectId, id, input.revisionId, name, projectHash({ script: input.script, paths, resolve: Boolean(input.resolveDependencies) }), new Date(started).toISOString(), expires]);
      await db.query("INSERT INTO programmable_projects_v1.sandbox_slots(owner,project_id,id,provider_name,expires_at) VALUES($1,$2,$3,$4,$5)", [scope.ownerId, scope.projectId, id, name, expires]);
    });
    let instance: SandboxInstance | undefined, output: SandboxOutput | undefined, cleaned = false;
    try {
      instance = await provider.create({ name, timeoutMs, vcpus: 1, network: "deny-all" }, signal);
      await projectTransaction(pool, scope, db => db.query("UPDATE programmable_projects_v1.sandbox_jobs SET state='active' WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, id]));
      await instance.writeFiles(revision.document.files, signal);
      if (install) output = await instance.install(input.resolveDependencies === true, signal);
      if (!output || output.exitCode === 0) output = await instance.execute(input.script, signal);
      const files: Record<string, ProjectFile> = {};
      let total = 0;
      for (const path of paths) {
        const content = await instance.readFile(path, signal);
        if (content === null) continue;
        if (content.byteLength > 512_000 || (total += content.byteLength) > 4_000_000) throw new ProjectError("sandbox-artifact", "The generated files exceed the project limit.", 413);
        const text = content.toString("utf8");
        files[path] = Buffer.from(text).equals(content) && !text.includes("\0") ? text : { encoding: "base64", content: content.toString("base64"), mediaType: "application/octet-stream" };
      }
      assertExportableFiles(files);
      const artifacts:Record<string,string>={};let artifactBytes=0;
      for(const path of artifactPaths){const content=await instance.readFile(path,signal,4000000);if(!content)continue;artifactBytes+=content.length;if(artifactBytes>4000000)throw new ProjectError("sandbox-artifact","The packaged artifact is too large.",413);artifacts[path]=content.toString("base64");}
      return { ...output, files, artifacts, revisionId: input.revisionId, jobId: String(id), durationMs: Math.max(0, now() - started) };
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      if (externalSignal?.aborted) throw new ProjectError("sandbox-cancelled", "The sandbox was stopped.", 409);
      throw new ProjectError("sandbox-provider", "The sandbox could not finish. Your source revision is saved.", 503);
    } finally {
      try { if (instance) await instance.close(); else await provider.cleanup(name); cleaned = true; } catch { /* Keep the slot until the provider TTL is guaranteed to have elapsed. */ }
      const duration = cleaned ? Math.min(timeoutMs, Math.max(1, now() - started)) : timeoutMs;
      await projectTransaction(pool, scope, async db => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["project-sandbox-quota-v1"]);
        await db.query("UPDATE programmable_projects_v1.sandbox_jobs SET state=$4,duration_ms=$5,exit_code=$6 WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, id, cleaned ? "cleaned" : "cleanup_pending", duration, output?.exitCode ?? null]);
        if (cleaned) await db.query("DELETE FROM programmable_projects_v1.sandbox_slots WHERE id=$1", [id]);
        for (const subject of [`owner:${scope.ownerId}`, "global"]) await db.query("UPDATE programmable_projects_v1.sandbox_usage SET used_ms=used_ms-$3 WHERE subject=$1 AND period=$2", [subject, day, timeoutMs - duration]);
      });
    }
  }
  return { execute };
}
