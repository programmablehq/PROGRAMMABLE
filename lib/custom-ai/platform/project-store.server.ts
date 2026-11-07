import "server-only";
import type { AIConnection, AIPool } from "../store.server";
import { ProjectError, type ProjectDocument, type ProjectRevision, type ProjectScope, type RevisionPatchInput } from "./types";
import { applyDocumentPatch, emptyProjectDocument, projectHash } from "./document";
import { projectTransaction } from "./transaction.server";
import { projectDate } from "./time";

const missing = () => new ProjectError("project-missing", "This project was not found.", 404);
const conflict = () => new ProjectError("project-conflict", "This project changed. Reload the current revision before editing.", 409);
const validRevision = (value: string) => /^sha256:[a-f0-9]{64}$/.test(value);

function revision(row: Record<string, unknown>): ProjectRevision {
  return structuredClone({ ownerId: String(row.owner), projectId: String(row.project_id), revisionId: String(row.id),
    parentRevisionId: row.parent_id === null ? null : String(row.parent_id), ordinal: Number(row.ordinal), document: row.document as ProjectDocument,
    requirementsHash: String(row.requirements_hash), fileTreeHash: String(row.files_hash), dependencyLockHash: String(row.dependencies_hash),
    architectureHash: String(row.architecture_hash), createdAt: projectDate(row.created_at).toISOString() });
}

/** All access is both owner-qualified and protected by transaction-local RLS.
 * The migration is applied separately; no request performs DDL. */
export function createPlatformStore(pool: AIPool, now: () => number = Date.now) {
  async function transaction<T>(scope: ProjectScope, work: (db: AIConnection) => Promise<T>): Promise<T> {
    return projectTransaction(pool, scope, work);
  }

  async function read(db: AIConnection, scope: ProjectScope, id?: string) {
    const rows = id
      ? (await db.query("SELECT * FROM programmable_projects_v1.revisions WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, id])).rows
      : (await db.query(`SELECT r.* FROM programmable_projects_v1.projects p
          JOIN programmable_projects_v1.revisions r ON r.owner=p.owner AND r.project_id=p.id AND r.id=p.current_revision
          WHERE p.owner=$1 AND p.id=$2`, [scope.ownerId, scope.projectId])).rows;
    if (!rows[0]) throw missing();
    return revision(rows[0]);
  }

  async function insert(db: AIConnection, scope: ProjectScope, document: ProjectDocument, parent: ProjectRevision | null): Promise<ProjectRevision> {
    const createdAt = new Date(now()).toISOString();
    const hashes = { requirementsHash: projectHash(document.requirements), fileTreeHash: projectHash(document.files),
      dependencyLockHash: projectHash(document.dependencies), architectureHash: projectHash(document.architecture) };
    const revisionId = projectHash({ scope, parent: parent?.revisionId ?? null, document });
    if (!parent) await db.query(`INSERT INTO programmable_projects_v1.projects(owner,id,current_revision,created_at,updated_at)
      VALUES($1,$2,$3,$4,$4)`, [scope.ownerId, scope.projectId, revisionId, createdAt]);
    await db.query(`INSERT INTO programmable_projects_v1.revisions(owner,project_id,id,parent_id,ordinal,document,
      requirements_hash,files_hash,dependencies_hash,architecture_hash,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
      [scope.ownerId, scope.projectId, revisionId, parent?.revisionId ?? null, (parent?.ordinal ?? 0) + 1, JSON.stringify(document),
        hashes.requirementsHash, hashes.fileTreeHash, hashes.dependencyLockHash, hashes.architectureHash, createdAt]);
    if (parent) {
      const updated = await db.query(`UPDATE programmable_projects_v1.projects SET current_revision=$3,updated_at=$4
        WHERE owner=$1 AND id=$2 AND current_revision=$5 RETURNING id`, [scope.ownerId, scope.projectId, revisionId, createdAt, parent.revisionId]);
      if (updated.rows.length !== 1) throw conflict();
    }
    return read(db, scope, revisionId);
  }

  async function createProject(scope: ProjectScope): Promise<ProjectRevision> {
    return transaction(scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`project-platform:${scope.ownerId}:${scope.projectId}`]);
      const exists = (await db.query("SELECT id FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2", [scope.ownerId, scope.projectId])).rows.length;
      return exists ? read(db, scope) : insert(db, scope, emptyProjectDocument(), null);
    });
  }

  async function readProject(scope: ProjectScope): Promise<ProjectRevision> {
    return transaction(scope, db => read(db, scope));
  }

  async function readRevision(scope: ProjectScope, revisionId: string): Promise<ProjectRevision> {
    if (!validRevision(revisionId)) throw missing();
    return transaction(scope, db => read(db, scope, revisionId));
  }

  async function applyProjectPatch(input: RevisionPatchInput & { execution?: { runId: string; leaseToken: string } }): Promise<ProjectRevision> {
    const scope = { ownerId: input.ownerId, projectId: input.projectId };
    if (!validRevision(input.expectedRevisionId) || typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.idempotencyKey)) {
      throw new ProjectError("project-input", "This project change is invalid.");
    }
    const requestHash = projectHash({ expectedRevisionId: input.expectedRevisionId, patch: input.patch });
    return transaction(scope, async db => {
      if (input.execution) {
        const granted = (await db.query("SELECT id FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND id=$3 AND lease_token=$4 AND status='running' AND lease_until>$5 FOR UPDATE",
          [scope.ownerId, scope.projectId, input.execution.runId, input.execution.leaseToken, new Date(now()).toISOString()])).rows;
        if (!granted.length) throw new ProjectError("run-lease", "This worker no longer owns the project run.", 409);
      }
      const locked = await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR UPDATE", [scope.ownerId, scope.projectId]);
      if (!locked.rows.length) throw missing();
      const prior = (await db.query("SELECT request_hash,revision_id FROM programmable_projects_v1.idempotency WHERE owner=$1 AND project_id=$2 AND key=$3", [scope.ownerId, scope.projectId, input.idempotencyKey])).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash) throw new ProjectError("project-idempotency", "This change identifier was already used for different content.", 409);
        return read(db, scope, String(prior.revision_id));
      }
      if (locked.rows[0].current_revision !== input.expectedRevisionId) throw conflict();
      const previous = await read(db, scope, input.expectedRevisionId);
      const saved = await insert(db, scope, applyDocumentPatch(previous.document, input.patch), previous);
      await db.query("INSERT INTO programmable_projects_v1.idempotency(owner,project_id,key,request_hash,revision_id) VALUES($1,$2,$3,$4,$5)",
        [scope.ownerId, scope.projectId, input.idempotencyKey, requestHash, saved.revisionId]);
      return saved;
    });
  }
  async function readPatchReceipt(scope: ProjectScope, idempotencyKey: string): Promise<ProjectRevision | null> {
    return transaction(scope, async db => {
      const item = (await db.query("SELECT revision_id FROM programmable_projects_v1.idempotency WHERE owner=$1 AND project_id=$2 AND key=$3", [scope.ownerId, scope.projectId, idempotencyKey])).rows[0];
      return item ? read(db, scope, String(item.revision_id)) : null;
    });
  }

  async function listRevisions(scope: ProjectScope, limit = 50): Promise<ProjectRevision[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProjectError("project-input", "Choose up to 100 revisions.");
    return transaction(scope, async db => {
      await read(db, scope);
      return (await db.query("SELECT * FROM programmable_projects_v1.revisions WHERE owner=$1 AND project_id=$2 ORDER BY ordinal DESC LIMIT $3", [scope.ownerId, scope.projectId, limit])).rows.map(revision);
    });
  }

  async function listProjects(ownerId: string, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ProjectError("project-input", "Choose up to 100 projects.");
    return transaction({ ownerId, projectId: "00000000-0000-4000-8000-000000000000" }, async db =>
      (await db.query(`SELECT p.id,p.current_revision,p.updated_at,r.document->>'title' AS title FROM programmable_projects_v1.projects p
        JOIN programmable_projects_v1.revisions r ON r.owner=p.owner AND r.project_id=p.id AND r.id=p.current_revision
        WHERE p.owner=$1 ORDER BY p.updated_at DESC,p.id LIMIT $2`, [ownerId, limit])).rows.map(row => ({
          projectId: String(row.id), revisionId: String(row.current_revision), title: String(row.title), updatedAt: projectDate(row.updated_at).toISOString(),
        })));
  }

  async function restoreProjectRevision(input: ProjectScope & { expectedRevisionId: string; revisionId: string; idempotencyKey: string }) {
    const scope = { ownerId: input.ownerId, projectId: input.projectId };
    const [base, target] = await Promise.all([readRevision(scope, input.expectedRevisionId), readRevision(scope, input.revisionId)]);
    return applyProjectPatch({ ...scope, expectedRevisionId: input.expectedRevisionId, idempotencyKey: input.idempotencyKey, patch: {
      ...target.document,
      removeRequirementIds: base.document.requirements.filter(rule => !target.document.requirements.some(item => item.id === rule.id)).map(rule => rule.id),
      removeFilePaths: Object.keys(base.document.files).filter(path => !Object.hasOwn(target.document.files, path)),
    } });
  }

  return { createProject, readProject, readRevision, applyProjectPatch, readPatchReceipt, listProjects, listRevisions, restoreProjectRevision };
}
