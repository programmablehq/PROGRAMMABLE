import "server-only";
import type {AIPool,AIConnection} from "../store.server";
import type {CompiledProject} from "../contract-project.server";
import type {GeneralScenarioReport} from "../behavior-checks.server";
import type {GeneralSourceAudit} from "../source-audit.server";
import type {createPlatformStore} from "./project-store.server";
import type {createArtifactStore} from "./artifacts.server";
import type {createProjectChecks} from "./builds.server";
import type {createPlatformLaunchDrafts} from "./launch-draft.server";
import {checkedPlatformLaunchSource} from "./launch-source.server";
import {projectHash,validateScope} from "./document";
import {assertExportableFiles,assertExportableMetadata} from "./files";
import {projectTransaction} from "./transaction.server";
import {ProjectError,type ProjectScope} from "./types";

export type PlatformContractCheckpoint={version:1;revisionId:string;compilation:CompiledProject;scenarios:GeneralScenarioReport;audit:GeneralSourceAudit};
const missing=()=>new ProjectError("launch-source-checks","Finish all source and behavior checks for this project version first.",422);
export async function readContractCheckpointInTransaction(db:AIConnection,scope:ProjectScope,revisionId:string):Promise<PlatformContractCheckpoint|null>{
  validateScope(scope);
  const row=(await db.query("SELECT content,content_hash FROM programmable_projects_v1.contract_checkpoints WHERE owner=$1 AND project_id=$2 AND revision_id=$3",[scope.ownerId,scope.projectId,revisionId])).rows[0];
  if(!row)return null;
  try{const body=JSON.parse(Buffer.from(row.content as Uint8Array).toString("utf8"));if(body.version!==1||body.revisionId!==revisionId||projectHash(body)!==row.content_hash)throw Error();return body;}catch{throw new ProjectError("launch-checkpoint","The saved contract checkpoint could not be verified.",409);}
}
/** Preserve only checked compiler/scenario/audit bytes. Source itself remains
 * in the immutable project revision. Temporary artifact expiry cannot erase
 * the input to an already prepared launch. */
export function createPlatformContractCheckpoints(pool:AIPool,deps:{projects:ReturnType<typeof createPlatformStore>;artifacts:ReturnType<typeof createArtifactStore>;checks:ReturnType<typeof createProjectChecks>;drafts:ReturnType<typeof createPlatformLaunchDrafts>}){
  async function freeze(scope:ProjectScope,account:string,expectedRevision?:string){
    const revision=await deps.projects.readProject(scope),ref={...scope,revisionId:revision.revisionId};
    if(expectedRevision!==undefined&&expectedRevision!==revision.revisionId)throw new ProjectError("launch-source-changed","The project changed. Review its current version.",409);
    const assessment=await deps.checks.assess(ref);if(!assessment.verified)throw missing();
    const draft=await deps.drafts.read(scope,account);
    let checkpoint=await projectTransaction(pool,scope,db=>readContractCheckpointInTransaction(db,scope,revision.revisionId));
    if(!checkpoint){
      const record=(kind:string)=>assessment.evidence.find(item=>item.passed&&item.result&&typeof item.result==="object"&&!Array.isArray(item.result)&&item.result.kind===kind)?.result as Record<string,unknown>|undefined;
      const compile=record("compile"),scenario=record("contract-scenarios"),audit=record("source-audit");
      if(typeof compile?.artifactId!=="string"||!scenario||!audit)throw missing();
      const artifact=await deps.artifacts.readArtifact(scope,compile.artifactId);
      let saved;try{saved=JSON.parse(Buffer.from(artifact.bytes).toString("utf8"));}catch{throw missing();}
      if(saved.kind!=="programmable-contract-build-v1"||saved.revisionId!==revision.revisionId)throw missing();
      const {kind:scenarioKind,...scenarios}=scenario,{kind:auditKind,...sourceAudit}=audit;void scenarioKind;void auditKind;
      checkpoint={version:1,revisionId:revision.revisionId,compilation:saved.compilation,scenarios:scenarios as GeneralScenarioReport,audit:sourceAudit as GeneralSourceAudit};
    }
    assertExportableFiles(revision.document.files);assertExportableMetadata(revision.document.architecture);
    const source=checkedPlatformLaunchSource({revision,draft,...checkpoint}),content=Buffer.from(JSON.stringify(checkpoint)),hash=projectHash(checkpoint);
    if(content.length>4_000_000)throw new ProjectError("launch-checkpoint-size","The checked contract package exceeds 4 MB.",413);
    await projectTransaction(pool,scope,async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`contract-checkpoints:${scope.ownerId}`]);
      const current=(await db.query("SELECT current_revision FROM programmable_projects_v1.projects WHERE owner=$1 AND id=$2 FOR UPDATE",[scope.ownerId,scope.projectId])).rows[0];
      const details=(await db.query("SELECT revision,source_revision FROM programmable_projects_v1.launch_drafts WHERE owner=$1 AND project_id=$2 AND account=$3 FOR SHARE",[scope.ownerId,scope.projectId,draft.account])).rows[0];
      if(current?.current_revision!==revision.revisionId||Number(details?.revision)!==draft.revision||details?.source_revision!==revision.revisionId)throw new ProjectError("launch-source-changed","The project or launch details changed. Review the current version.",409);
      if((await db.query("SELECT id FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND status IN ('queued','running','retryable') LIMIT 1",[scope.ownerId,scope.projectId])).rows.length)throw new ProjectError("launch-source-busy","Finish or stop the current project work before preparing its launch.",409);
      const prior=await readContractCheckpointInTransaction(db,scope,revision.revisionId);
      if(prior){if(projectHash(prior)!==hash)throw new ProjectError("launch-checkpoint","This project version already has different checked artifacts.",409);return;}
      const usage=(await db.query("SELECT count(*) FILTER(WHERE project_id=$2) AS project_count,coalesce(sum(octet_length(content)),0) AS owner_bytes FROM programmable_projects_v1.contract_checkpoints WHERE owner=$1",[scope.ownerId,scope.projectId])).rows[0];
      if(Number(usage.project_count)>=8||Number(usage.owner_bytes)+content.length>64_000_000)throw new ProjectError("launch-checkpoint-quota","The saved contract checkpoint allowance is full.",429);
      await db.query("INSERT INTO programmable_projects_v1.contract_checkpoints(owner,project_id,revision_id,content,content_hash,created_at) VALUES($1,$2,$3,$4,$5,now())",[scope.ownerId,scope.projectId,revision.revisionId,content,hash]);
    });
    return source;
  }
  return {freeze};
}
