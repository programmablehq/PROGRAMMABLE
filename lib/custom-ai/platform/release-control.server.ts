import "server-only";
import { randomUUID } from "node:crypto";
import type { AIPool } from "../store.server";
import type { HostingProvider } from "./releases.server";
import type { createRuntimeDataStore } from "./runtime-data.server";
import { projectTransaction } from "./transaction.server";
import { ProjectError, type ProjectScope } from "./types";

type Action = "promote" | "pause" | "resume";
type Ticket = ProjectScope & {
  operationId: string;
  lease: string;
  releaseId: string;
  action: Action;
  providerId: string;
  deploymentId: string;
};

/** One durable provider-control intent per app. A lost response is retried only
 * for that same intent; a competing publication cannot change the target. */
export function createReleaseControl(pool: AIPool, data: ReturnType<typeof createRuntimeDataStore>, provider: HostingProvider, now = Date.now) {
  async function claim(scope: ProjectScope, request: { releaseId: string; action: Action; rollback?: boolean } | { operationId: string }): Promise<Ticket | null> {
    return projectTransaction(pool, scope, async db => {
      const host = (await db.query("SELECT * FROM programmable_projects_v1.app_hosts WHERE owner=$1 AND project_id=$2 FOR UPDATE", [scope.ownerId, scope.projectId])).rows[0];
      if (!host) throw new ProjectError("release-missing", "No app service exists for this release.", 409);
      const prior = (await db.query("SELECT * FROM programmable_projects_v1.app_controls WHERE owner=$1 AND project_id=$2 FOR UPDATE", [scope.ownerId, scope.projectId])).rows[0];
      const recovery = "operationId" in request;
      const pending = prior && prior.state !== "complete";
      if (recovery && (!pending || prior.operation_id !== request.operationId)) return null;
      if (recovery && Number(prior.attempts) >= 3) {
        if (new Date(String(prior.lease_until)).getTime() > now()) return null;
        await db.query("UPDATE programmable_projects_v1.app_controls SET state='unknown',lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND operation_id=$3", [scope.ownerId, scope.projectId, request.operationId]);
        await db.query("UPDATE programmable_projects_v1.app_releases SET state='reconcile',error_code='release-control-unknown' WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, prior.release_id]);
        await db.query("DELETE FROM programmable_projects_v1.app_control_queue WHERE owner=$1 AND project_id=$2 AND operation_id=$3", [scope.ownerId, scope.projectId, request.operationId]);
        return null;
      }
      if (pending && (recovery ? false : prior.release_id !== request.releaseId || prior.action !== request.action)) {
        throw new ProjectError("release-control-busy", "A previous app action must finish before another can start.", 409);
      }
      if (pending && new Date(String(prior.lease_until)).getTime() > now()) {
        if (recovery) return null;
        throw new ProjectError("release-control-busy", "This app action is still being verified.", 409);
      }
      const releaseId = pending ? String(prior.release_id) : "releaseId" in request ? request.releaseId : "";
      const action = pending ? prior.action as Action : "action" in request ? request.action : "promote";
      const release = (await db.query("SELECT * FROM programmable_projects_v1.app_releases WHERE owner=$1 AND project_id=$2 AND id=$3 FOR UPDATE", [scope.ownerId, scope.projectId, releaseId])).rows[0];
      if (!release?.observed_at || !release.provider_id || !release.deployment_id) throw new ProjectError("release-unobserved", "Verify the deployed preview before publication.", 409);
      if (!pending) {
        if (action === "promote") {
          if (!["ready", "published", "stopped"].includes(String(release.state))) throw new ProjectError("release-unobserved", "Verify the deployed preview before publication.", 409);
          const current = (await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR SHARE", [scope.ownerId, scope.projectId])).rows[0];
          if (!("rollback" in request && request.rollback) && current?.current_revision !== release.revision_id) throw new ProjectError("release-stale", "The workspace changed after this release was tested.", 409);
          const config = (await db.query("SELECT data_version FROM programmable_projects_v1.app_config WHERE owner=$1 AND project_id=$2 FOR SHARE", [scope.ownerId, scope.projectId])).rows[0];
          if (Number(config?.data_version) !== Number(release.data_version)) throw new ProjectError("release-data-version", "This release is incompatible with the current data contract.", 409);
        } else if (host.active_release !== releaseId || !["published", "stopped"].includes(String(release.state))) {
          throw new ProjectError("release-state", "Only the active, checked application can be stopped or resumed.", 409);
        }
      }
      const operationId = pending ? String(prior.operation_id) : randomUUID(), lease = randomUUID();
      await db.query("DELETE FROM programmable_projects_v1.app_control_queue WHERE owner=$1 AND project_id=$2", [scope.ownerId, scope.projectId]);
      await db.query("INSERT INTO programmable_projects_v1.app_controls(owner,project_id,operation_id,release_id,action,state,lease_token,lease_until,attempts) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,1) ON CONFLICT(owner,project_id) DO UPDATE SET operation_id=$3,release_id=$4,action=$5,state='pending',lease_token=$6,lease_until=$7,attempts=CASE WHEN programmable_projects_v1.app_controls.operation_id=$3 THEN programmable_projects_v1.app_controls.attempts+1 ELSE 1 END", [scope.ownerId, scope.projectId, operationId, releaseId, action, lease, new Date(now() + 180000).toISOString()]);
      await db.query("INSERT INTO programmable_projects_v1.app_control_queue(owner,project_id,operation_id,next_at) VALUES($1,$2,$3,$4)", [scope.ownerId, scope.projectId, operationId, new Date(now() + 180000).toISOString()]);
      await db.query("UPDATE programmable_projects_v1.app_releases SET state='reconcile',error_code='release-control-pending' WHERE owner=$1 AND project_id=$2 AND id=$3", [scope.ownerId, scope.projectId, releaseId]);
      // No old or partially promoted code may mutate live data while the target
      // is uncertain. The capability and control result are reactivated atomically.
      await data.setActive(scope, false, db);
      return { ...scope, operationId, lease, releaseId, action, providerId: String(release.provider_id), deploymentId: String(release.deployment_id) };
    });
  }

  async function assertLease(ticket: Ticket) {
    const active = await projectTransaction(pool, ticket, async db => (await db.query("SELECT operation_id,lease_token,lease_until FROM programmable_projects_v1.app_controls WHERE owner=$1 AND project_id=$2", [ticket.ownerId, ticket.projectId])).rows[0]);
    if (active?.operation_id !== ticket.operationId || active.lease_token !== ticket.lease || new Date(String(active.lease_until)).getTime() <= now()) throw new ProjectError("release-control-lease", "Another worker is verifying this app action.", 409);
  }

  async function perform(ticket: Ticket) {
    try {
      await assertLease(ticket);
      if (ticket.action === "promote") {
        await provider.promote(ticket.providerId, ticket.deploymentId);
        await assertLease(ticket);
        await provider.resume(ticket.providerId);
      } else if (ticket.action === "pause") await provider.pause(ticket.providerId);
      else await provider.resume(ticket.providerId);
      await projectTransaction(pool, ticket, async db => {
        const control = (await db.query("SELECT operation_id,lease_token,lease_until FROM programmable_projects_v1.app_controls WHERE owner=$1 AND project_id=$2 FOR UPDATE", [ticket.ownerId, ticket.projectId])).rows[0];
        if (control?.operation_id !== ticket.operationId || control.lease_token !== ticket.lease || new Date(String(control.lease_until)).getTime() <= now()) throw new ProjectError("release-control-lease", "Another worker is verifying this app action.", 409);
        if (ticket.action === "promote") {
          await data.activateRelease(ticket, ticket.releaseId, db);
          await db.query("UPDATE programmable_projects_v1.app_hosts SET active_release=$3 WHERE owner=$1 AND project_id=$2", [ticket.ownerId, ticket.projectId, ticket.releaseId]);
        }
        await data.setActive(ticket, ticket.action !== "pause", db);
        await db.query("UPDATE programmable_projects_v1.app_releases SET state=$4,mode='production',error_code=NULL WHERE owner=$1 AND project_id=$2 AND id=$3", [ticket.ownerId, ticket.projectId, ticket.releaseId, ticket.action === "pause" ? "stopped" : "published"]);
        await db.query("UPDATE programmable_projects_v1.app_controls SET state='complete',lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND operation_id=$3", [ticket.ownerId, ticket.projectId, ticket.operationId]);
        await db.query("DELETE FROM programmable_projects_v1.app_control_queue WHERE owner=$1 AND project_id=$2 AND operation_id=$3", [ticket.ownerId, ticket.projectId, ticket.operationId]);
      });
    } catch (error) {
      if (error instanceof ProjectError && error.code === "release-control-lease") throw error;
      await projectTransaction(pool, ticket, async db => {
        const updated = await db.query("UPDATE programmable_projects_v1.app_controls SET state='unknown',lease_token=NULL,lease_until=NULL WHERE owner=$1 AND project_id=$2 AND operation_id=$3 AND lease_token=$4 RETURNING operation_id,attempts", [ticket.ownerId, ticket.projectId, ticket.operationId, ticket.lease]);
        if (!updated.rows.length) return;
        await db.query("UPDATE programmable_projects_v1.app_releases SET state='reconcile',error_code='release-control-unknown' WHERE owner=$1 AND project_id=$2 AND id=$3", [ticket.ownerId, ticket.projectId, ticket.releaseId]);
        await db.query("UPDATE programmable_projects_v1.app_control_queue SET next_at=$4 WHERE owner=$1 AND project_id=$2 AND operation_id=$3", [ticket.ownerId, ticket.projectId, ticket.operationId, new Date(now() + 30000).toISOString()]);
        if (Number(updated.rows[0].attempts) >= 3) await db.query("DELETE FROM programmable_projects_v1.app_control_queue WHERE owner=$1 AND project_id=$2 AND operation_id=$3", [ticket.ownerId, ticket.projectId, ticket.operationId]);
      });
      throw new ProjectError("release-control-unknown", "The provider outcome is being reconciled. App data access stays paused until it is confirmed.", 503);
    }
  }

  async function run(scope: ProjectScope, releaseId: string, action: Action, rollback = false) {
    const ticket = await claim(scope, { releaseId, action, rollback });
    if (ticket) await perform(ticket);
  }
  async function recover(limit = 1) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 2) throw new TypeError("Invalid control recovery batch");
    const db = await pool.connect();
    let rows: Record<string, unknown>[];
    try { rows = (await db.query("SELECT owner,project_id,operation_id FROM programmable_projects_v1.app_control_queue WHERE next_at<=$1 ORDER BY next_at LIMIT $2", [new Date(now()).toISOString(), limit])).rows; }
    finally { db.release(); }
    let recovered = 0, failed = 0;
    for (const row of rows) {
      const ticket = await claim({ ownerId: String(row.owner), projectId: String(row.project_id) }, { operationId: String(row.operation_id) });
      if (!ticket) continue;
      try { await perform(ticket); recovered++; } catch { failed++; }
    }
    return { recovered, failed };
  }
  return { run, recover };
}
