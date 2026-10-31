import "server-only";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, type ContractProject } from "./contract-project";
import type { CompiledProject } from "./contract-project.server";
import { CustomAIError } from "./types";
import type { AIConnection } from "./store.server";
import { projectOverview, type ProjectOverview } from "./project-overview";

export type ProjectCheckpoint = {
  version: 1;
  requestId: string;
  payloadHash: string;
  project: ContractProject;
  compilation?: CompiledProject;
  overview?: ProjectOverview;
};
type Transaction = <T>(work: (connection: AIConnection) => Promise<T>) => Promise<T>;
const kind = "contract-project";
const conflict = () => new CustomAIError("project-conflict", "This saved source belongs to a different revision. Your earlier project is kept.", 409);

/** Uses the existing owned job and object tables. Source survives a compiler
 * failure; polling never needs to transfer it. Only the active lease may write. */
export function createProjectStore(transaction: Transaction) {
  async function active(db: AIConnection, owner: string, id: string, lease: string) {
    const row = (await db.query(`SELECT payload_hash FROM programmable_custom_ai_v1.jobs
      WHERE owner=$1 AND id=$2 AND lease=$3 AND state='running'
      AND created_at >= now()-interval '10 minutes' FOR UPDATE`, [owner, id, lease])).rows[0];
    if (!row) throw new CustomAIError("interrupted", "This request is no longer running. Your saved source is kept.", 409);
    return String(row.payload_hash);
  }
  async function saved(db: AIConnection, owner: string, id: string): Promise<ProjectCheckpoint | null> {
    const row = (await db.query(`SELECT o.value FROM programmable_custom_ai_v1.objects o
      JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id
      AND j.payload_hash=o.value->>'payloadHash'
      WHERE o.owner=$1 AND o.id=$2 AND o.kind=$3`, [owner, id, kind])).rows[0];
    return row ? row.value as ProjectCheckpoint : null;
  }
  async function save(owner: string, id: string, lease: string, project: ContractProject) {
    projectCompilerInput(project);
    // This dedicated server-only path accommodates the complete bounded source
    // package without raising the ordinary chat/image object-write limit.
    if (Buffer.byteLength(JSON.stringify(project)) > 3_000_000) throw new CustomAIError("project-size", "This source package is too large to save.", 422);
    return transaction(async db => {
      const payloadHash = await active(db, owner, id, lease), previous = await saved(db, owner, id);
      if (previous) {
        if (previous.project.hash !== project.hash) throw conflict();
        return previous;
      }
      const value: ProjectCheckpoint = { version: 1, requestId: id, payloadHash, project, overview: projectOverview(id, project) };
      await db.query(`INSERT INTO programmable_custom_ai_v1.objects(owner,kind,id,value)
        VALUES($1,$2,$3,$4)`, [owner, kind, id, JSON.stringify(value)]);
      return value;
    });
  }
  async function complete(owner: string, id: string, lease: string, compilation: CompiledProject) {
    const { artifactHash, ...body } = compilation;
    if (compilation.version !== 1 || compilation.verification !== "not-run" || compilation.launchReady !== false
      || canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) !== artifactHash
      || Buffer.byteLength(JSON.stringify(compilation)) > 4_000_000) throw conflict();
    return transaction(async db => {
      await active(db, owner, id, lease);
      const previous = await saved(db, owner, id);
      if (!previous || previous.project.hash !== compilation.projectHash) throw conflict();
      if (previous.compilation) {
        if (previous.compilation.artifactHash !== artifactHash) throw conflict();
        return previous;
      }
      const value: ProjectCheckpoint = { ...previous, compilation, overview: projectOverview(id, previous.project, compilation) };
      await db.query(`UPDATE programmable_custom_ai_v1.objects SET value=$4,revision=revision+1,updated_at=now()
        WHERE owner=$1 AND kind=$2 AND id=$3`, [owner, kind, id, JSON.stringify(value)]);
      return value;
    });
  }
  async function overview(owner: string, id: string): Promise<ProjectOverview | null> {
    return transaction(async db => {
      const row = (await db.query(`SELECT o.value->'overview' AS overview FROM programmable_custom_ai_v1.objects o
        JOIN programmable_custom_ai_v1.jobs j ON j.owner=o.owner AND j.id=o.id
        AND j.payload_hash=o.value->>'payloadHash'
        WHERE o.owner=$1 AND o.id=$2 AND o.kind=$3`, [owner, id, kind])).rows[0];
      return row?.overview ? row.overview as ProjectOverview : null;
    });
  }
  return { save, complete, overview, read: (owner: string, id: string) => transaction(db => saved(db, owner, id)) };
}
