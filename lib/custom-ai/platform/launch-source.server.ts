import "server-only";
import type {CompiledProject} from "../contract-project.server";
import type {GeneralScenarioReport} from "../behavior-checks.server";
import {checkedGeneralSourceAudit,type GeneralSourceAudit} from "../source-audit.server";
import {checkedGeneralLaunchSource} from "../general-launch-source.server";
import {projectCompilationView} from "../project-view";
import type {ChatRequest,ChatResult} from "../types";
import {platformContract,platformContractBlueprint} from "./contract-plan.server";
import {projectHash} from "./document";
import type {PlatformLaunchDraft} from "./launch-draft.server";
import {ProjectError,type ProjectRevision} from "./types";

export const platformLaunchSourceId=(revisionId:string)=>`pp-${revisionId.slice(7,68)}`;
/** Adapt the canonical project and its private evidence to the existing launch
 * reader's shape. This does not create legacy chats/jobs or grant a launch.
 * The store caller must load each input under the same owner/project scope. */
export function checkedPlatformLaunchSource(input:{revision:ProjectRevision;draft:PlatformLaunchDraft;compilation:CompiledProject;scenarios:GeneralScenarioReport;audit:GeneralSourceAudit}){
  const {revision,draft,compilation,scenarios}=input;
  if(draft.revision<1||draft.sourceRevision!==revision.revisionId)throw new ProjectError("launch-source-changed","Review and save launch details for this exact project version.",409);
  const project=platformContract(revision),blueprint=platformContractBlueprint(revision),audit=checkedGeneralSourceAudit(input.audit,project);
  if(audit.status!=="passed")throw new ProjectError("launch-source-checks","Resolve the source review findings before preparing a launch.",422);
  const id=platformLaunchSourceId(revision.revisionId),payloadHash=projectHash({ownerId:revision.ownerId,projectId:revision.projectId,revisionId:revision.revisionId});
  const view=projectCompilationView({project,compilation,scenarios,sourceAudit:audit,summary:revision.document.title,blueprintId:blueprint.id});
  const request:ChatRequest={id,intent:"build",messages:[],conversation:{id:revision.projectId,account:draft.account,revision:draft.revision}};
  const result:ChatResult={reply:"Saved project source and checks.",change:"applied",intent:project.intent,generalProject:view};
  return checkedGeneralLaunchSource(revision.ownerId,{id,account:draft.account,conversation:revision.projectId,studioRevision:draft.revision,chainId:project.chainId,projectHash:project.hash,artifactHash:compilation.artifactHash,intentRevision:project.intent.revision},{
    conversation:{id:revision.projectId,account:draft.account,title:revision.document.title,archived:false,createdAt:revision.createdAt},studioRevision:draft.revision,
    studio:{settings:draft.settings,messages:[],draftId:id,contextId:id,...(draft.image?{image:draft.image}:{})},
    sourceJob:{state:"completed",payloadHash,request,result},contextJob:{state:"completed",request,result},
    checkpoint:{version:1,requestId:id,payloadHash,project,compilation,scenarios,sourceAudit:audit,blueprintId:blueprint.id},
    declared:{version:1,requestId:id,payloadHash,intent:project.intent,blueprint},
  });
}
