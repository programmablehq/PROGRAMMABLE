import "server-only";
import type { AIPool } from "../store.server";
import type { createPlatformStore } from "./project-store.server";
import type { createSandboxExecutor } from "./sandbox-executor.server";
import { projectTransaction } from "./transaction.server";
import { projectHash } from "./document";
import { ProjectError, type ProjectScope, type JsonValue } from "./types";

export type ProjectLevel = "discussed" | "planned" | "built" | "verified" | "deployed" | "operational";
type Ref = ProjectScope & { revisionId: string };
const identity = (ref: Ref): Ref => ({ ownerId: ref.ownerId, projectId: ref.projectId, revisionId: ref.revisionId });
type Check = { id: string; requirementIds: string[]; command: string; kind: "behavior" | "build" };
export function declaredProjectChecks(value: JsonValue, requirements: string[]): Check[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.checks)) return [];
  if (value.checks.length > 6) throw new ProjectError("project-checks", "Use up to six bounded verification commands.");
  return value.checks.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(raw.id)
      || !Array.isArray(raw.requirementIds) || raw.requirementIds.some(id => typeof id !== "string" || !requirements.includes(id))
      || typeof raw.command !== "string" || !raw.command.trim() || raw.command.length > 16000 || !["behavior", "build"].includes(String(raw.kind))) {
      throw new ProjectError("project-checks", "Keep each check tied to declared project requirements.");
    }
    return raw as Check;
  });
}

export function createProjectChecks(pool: AIPool, projects: ReturnType<typeof createPlatformStore>, sandbox: Pick<ReturnType<typeof createSandboxExecutor>, "execute">) {
  async function record(reference: Ref, input: { requirementIds: string[]; passed: boolean; commandHash: string; result: JsonValue }) {
    const ref = identity(reference);
    const project = await projects.readRevision(ref, ref.revisionId);
    if (input.requirementIds.some(id => !project.document.requirements.some(rule => rule.id === id))) throw new ProjectError("check-requirements", "The evidence names a different requirement.", 409);
    const id = projectHash({ ref, ...input });
    await projectTransaction(pool, ref, async db => {
      await db.query(`INSERT INTO programmable_projects_v1.check_evidence(owner,project_id,id,revision_id,requirement_ids,requirements_hash,command_hash,passed,result,created_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10) ON CONFLICT(owner,project_id,id) DO NOTHING`,
        [ref.ownerId, ref.projectId, id, ref.revisionId, JSON.stringify(input.requirementIds), project.requirementsHash, input.commandHash, input.passed, JSON.stringify(input.result), new Date().toISOString()]);
    });
    return { id, revisionId: ref.revisionId, passed: input.passed, requirementIds: input.requirementIds };
  }
  async function verify(reference: Ref, signal?: AbortSignal) {
    const ref = identity(reference);
    const project = await projects.readRevision(ref, ref.revisionId);
    const declarations = declaredProjectChecks(project.document.architecture, project.document.requirements.map(item => item.id));
    if (!declarations.length) throw new ProjectError("project-checks", "Declare behavior checks before verifying this project.", 409);
    const evidence: { id: string; checkId: string; passed: boolean; requirementIds: string[]; output: string }[] = [];
    for (const check of declarations) {
      const result = await sandbox.execute({ ...ref, script: check.command, outputPaths: [] }, signal);
      if (result.revisionId !== ref.revisionId) throw new ProjectError("check-revision", "The check result belongs to another source revision.", 409);
      const passed = result.exitCode === 0 && !result.truncated;
      const requirementIds = check.kind === "behavior" ? check.requirementIds : [];
      const body = { checkId: check.id, kind: check.kind, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated, jobId: result.jobId };
      const id = projectHash({ ...ref, body, requirementsHash: project.requirementsHash, command: check.command });
      await projectTransaction(pool, ref, async db => {
        await db.query(`INSERT INTO programmable_projects_v1.check_evidence(owner,project_id,id,revision_id,requirement_ids,requirements_hash,command_hash,passed,result,created_at)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10) ON CONFLICT(owner,project_id,id) DO NOTHING`,
          [ref.ownerId, ref.projectId, id, ref.revisionId, JSON.stringify(requirementIds), project.requirementsHash, projectHash(check.command), passed, JSON.stringify(body), new Date().toISOString()]);
      });
      evidence.push({ id, checkId: check.id, passed, requirementIds, output: `${result.stdout}\n${result.stderr}`.slice(0, 6000) });
    }
    return { revisionId: ref.revisionId, passed: evidence.every(item => item.passed), evidence, assessment: await assess(ref) };
  }
  async function assess(reference: Ref) {
    const ref = identity(reference);
    const project = await projects.readRevision(ref, ref.revisionId);
    const evidence = await projectTransaction(pool, ref, db => db.query("SELECT id,requirement_ids,passed,result FROM programmable_projects_v1.check_evidence WHERE owner=$1 AND project_id=$2 AND revision_id=$3 AND requirements_hash=$4 ORDER BY created_at",
      [ref.ownerId, ref.projectId, ref.revisionId, project.requirementsHash]));
    const covered = new Set(evidence.rows.filter(row => row.passed === true).flatMap(row => row.requirement_ids as string[]));
    const missingRequirementIds = project.document.requirements.filter(item => item.open !== null || !covered.has(item.id)).map(item => item.id);
    const verified = project.document.requirements.length > 0 && missingRequirementIds.length === 0 && evidence.rows.length > 0 && evidence.rows.every(row => row.passed === true);
    const level: ProjectLevel = verified ? "verified" : Object.keys(project.document.files).length ? "built" : project.document.requirements.length ? "planned" : "discussed";
    return { level, verified, missingRequirementIds, evidence: evidence.rows.map(row => ({ id: String(row.id), passed: Boolean(row.passed), requirementIds: row.requirement_ids as string[], result: row.result as JsonValue })) };
  }
  return { verify, assess, record };
}
