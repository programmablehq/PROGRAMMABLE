import "server-only";
import type {AIConnection} from "../store.server";
import type {GeneralLaunchSourceSelection} from "../general-launch-source.server";
import type {CoinSetup} from "../coin-setup";
import type {ImageReceipt} from "../studio";
import {CustomAIError} from "../types";
import {projectRevisionFromRow} from "./project-store.server";
import {readContractCheckpointInTransaction} from "./contract-checkpoint.server";
import {checkedPlatformLaunchSource,platformLaunchSourceId} from "./launch-source.server";
import {validateScope} from "./document";
import {ProjectError} from "./types";

const changed=()=>new CustomAIError("launch-source-changed","The project or launch details changed. Review the current saved version.",409);
/** Shares the existing preparation transaction and its finality/approval gates.
 * Only this project's private checkpoint and current launch draft are read. */
export async function readPlatformLaunchSourceInTransaction(db:AIConnection,owner:string,selected:GeneralLaunchSourceSelection){
 try{
  const scope={ownerId:owner,projectId:selected.conversation};validateScope(scope);
  if(!/^pp-[a-f0-9]{61}$/.test(selected.id)||!/^0x[a-f0-9]{40}$/i.test(selected.account))throw changed();
  await db.query("SELECT set_config('programmable.project_owner',$1,true)",[owner]);
  const row=(await db.query("SELECT r.* FROM programmable_projects_v1.projects p JOIN programmable_projects_v1.revisions r ON r.owner=p.owner AND r.project_id=p.id AND r.id=p.current_revision WHERE p.owner=$1 AND p.id=$2 FOR UPDATE OF p",[owner,scope.projectId])).rows[0];
  if(!row)throw changed();const revision=projectRevisionFromRow(row);
  if(platformLaunchSourceId(revision.revisionId)!==selected.id)throw changed();
  const details=(await db.query("SELECT * FROM programmable_projects_v1.launch_drafts WHERE owner=$1 AND project_id=$2 AND account=$3 FOR UPDATE",[owner,scope.projectId,selected.account.toLowerCase()])).rows[0];
  if(!details)throw changed();
  const working=(await db.query("SELECT id FROM programmable_projects_v1.runs WHERE owner=$1 AND project_id=$2 AND status IN ('queued','running','retryable') LIMIT 1",[owner,scope.projectId])).rows.length;
  const failed=(await db.query("SELECT id FROM programmable_projects_v1.check_evidence WHERE owner=$1 AND project_id=$2 AND revision_id=$3 AND NOT passed LIMIT 1",[owner,scope.projectId,revision.revisionId])).rows.length;
  if(working||failed)throw new CustomAIError("launch-source-checks","Finish the current project work and checks before preparing its launch.",422);
  const checkpoint=await readContractCheckpointInTransaction(db,scope,revision.revisionId);
  if(!checkpoint)throw new CustomAIError("launch-source-checks","Save the checked contract package before preparing its launch.",422);
  const draft={revision:Number(details.revision),sourceRevision:String(details.source_revision),account:String(details.account),settings:details.settings as CoinSetup,...(details.image?{image:details.image as ImageReceipt}:{})};
  const source=checkedPlatformLaunchSource({revision,draft,...checkpoint});
  if(selected.chainId!==source.project.chainId||selected.projectHash!==source.project.hash||selected.artifactHash!==source.compilation.artifactHash||selected.intentRevision!==source.project.intent.revision)throw changed();
  if(selected.bindingHash?selected.bindingHash!==source.bindingHash:selected.studioRevision!==draft.revision)throw changed();
  return source;
 }catch(error){if(error instanceof ProjectError)throw new CustomAIError(error.code,error.message,error.status);throw error;}
}
