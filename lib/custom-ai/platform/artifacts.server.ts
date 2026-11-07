import "server-only";
import { createHash } from "node:crypto";
import type { AIPool } from "../store.server";
import { projectTransaction } from "./transaction.server";
import { ProjectError, type ProjectScope } from "./types";
import { projectDate } from "./time";

type ArtifactLimits = { maxArtifactBytes: number; maxOwnerBytes: number; maxProjectBytes: number; lifetimeSeconds: number };
export type ProjectArtifact = { id: string; mediaType: string; size: number; expiresAt: string };
export const DEFAULT_ARTIFACT_LIMITS: Readonly<ArtifactLimits> = Object.freeze({
  maxArtifactBytes: 4_000_000, maxOwnerBytes: 64_000_000, maxProjectBytes: 32_000_000, lifetimeSeconds: 86_400,
});
const identity = (bytes: Uint8Array, mediaType: string) => `sha256:${createHash("sha256").update("project-artifact/v1\0").update(mediaType).update("\0").update(bytes).digest("hex")}`;
function metadata(row: Record<string, unknown>): ProjectArtifact {
  return { id: String(row.id), mediaType: String(row.media_type), size: Number(row.size), expiresAt: projectDate(row.expires_at).toISOString() };
}

export function createArtifactStore(pool: AIPool, limits: Readonly<ArtifactLimits> = DEFAULT_ARTIFACT_LIMITS, now: () => number = Date.now) {
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)
    || limits.maxArtifactBytes > 4_000_000 || limits.maxArtifactBytes > limits.maxProjectBytes
    || limits.maxProjectBytes > limits.maxOwnerBytes || limits.maxOwnerBytes > 256_000_000
    || limits.lifetimeSeconds < 60 || limits.lifetimeSeconds > 604_800) throw new TypeError("Invalid artifact limits");

  async function saveArtifact(scope: ProjectScope, input: { bytes: Uint8Array; mediaType: string }): Promise<ProjectArtifact> {
    if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > limits.maxArtifactBytes) {
      throw new ProjectError("project-artifact-size", "This artifact exceeds the file limit.", 413);
    }
    if (typeof input.mediaType !== "string" || input.mediaType.length > 128 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(input.mediaType)) {
      throw new ProjectError("project-input", "Use a valid artifact media type.");
    }
    const bytes = Buffer.from(input.bytes), mediaType = input.mediaType.toLowerCase(), id = identity(bytes, mediaType);
    const timestamp = new Date(now()).toISOString(), expiry = new Date(now() + limits.lifetimeSeconds * 1000).toISOString();
    return projectTransaction(pool, scope, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`project-artifacts:${scope.ownerId}`]);
      if (!(await db.query("SELECT id FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2", [scope.ownerId, scope.projectId])).rows.length) {
        throw new ProjectError("project-missing", "This project was not found.", 404);
      }
      await db.query(`DELETE FROM programmable_projects_v1.artifacts WHERE owner=$1 AND (project_id,id) IN
        (SELECT project_id,id FROM programmable_projects_v1.artifacts WHERE owner=$1 AND expires_at<=$2 ORDER BY expires_at LIMIT 16)`, [scope.ownerId, timestamp]);
      const existing = (await db.query(`SELECT id,media_type,octet_length(content) AS size,expires_at FROM programmable_projects_v1.artifacts
        WHERE owner=$1 AND project_id=$2 AND id=$3 AND expires_at>$4`, [scope.ownerId, scope.projectId, id, timestamp])).rows[0];
      if (existing) return metadata(existing);
      const used = (await db.query(`SELECT COALESCE(sum(octet_length(content)),0) AS owner_bytes,
        COALESCE(sum(octet_length(content)) FILTER (WHERE project_id=$2),0) AS project_bytes
        FROM programmable_projects_v1.artifacts WHERE owner=$1 AND expires_at>$3`, [scope.ownerId, scope.projectId, timestamp])).rows[0];
      if (Number(used.owner_bytes) + bytes.length > limits.maxOwnerBytes || Number(used.project_bytes) + bytes.length > limits.maxProjectBytes) {
        throw new ProjectError("project-artifact-budget", "This project's artifact storage allowance is full.", 429);
      }
      await db.query(`INSERT INTO programmable_projects_v1.artifacts(owner,project_id,id,content,media_type,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner,project_id,id) DO UPDATE
        SET content=EXCLUDED.content,media_type=EXCLUDED.media_type,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at`,
        [scope.ownerId, scope.projectId, id, bytes, mediaType, timestamp, expiry]);
      return { id, mediaType, size: bytes.length, expiresAt: expiry };
    });
  }

  async function readArtifact(scope: ProjectScope, id: string): Promise<ProjectArtifact & { bytes: Uint8Array }> {
    if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new ProjectError("project-artifact-missing", "This artifact was not found.", 404);
    return projectTransaction(pool, scope, async db => {
      const row = (await db.query(`SELECT id,content,media_type,octet_length(content) AS size,expires_at FROM programmable_projects_v1.artifacts
        WHERE owner=$1 AND project_id=$2 AND id=$3 AND expires_at>$4`, [scope.ownerId, scope.projectId, id, new Date(now()).toISOString()])).rows[0];
      if (!row) throw new ProjectError("project-artifact-missing", "This artifact was not found.", 404);
      const bytes = new Uint8Array(row.content as Uint8Array);
      if (identity(bytes, String(row.media_type)) !== id) throw new ProjectError("project-artifact-corrupt", "This artifact does not match its saved content.", 409);
      return { ...metadata(row), bytes };
    });
  }
  return { saveArtifact, readArtifact };
}
