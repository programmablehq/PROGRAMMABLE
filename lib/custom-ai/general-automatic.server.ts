import "server-only";
import type { AIAuthority } from "./auth.server";
import { requireFreshCustomAIAuthority } from "./auth.server";
import type { AIStore } from "./store.server";
import type { createCustomAIBackendLaunchBridge } from "./backend-launch.server";
import type { GeneralPreparation } from "./general-preparation-store.server";
import { createAutomaticSourceReceipt } from "./automatic-source.server";
import { readAutomaticReview,readAutomaticTransport } from "./automatic-review";
import { CustomAIError } from "./types";

export function createGeneralAutomaticService(deps:{store:AIStore;bridge:()=>ReturnType<typeof createCustomAIBackendLaunchBridge>;now?:()=>number}) {
  const now=deps.now??Date.now;
  function identity(request:Request,authority:AIAuthority,saved:GeneralPreparation) {
    const current=requireFreshCustomAIAuthority(request,authority),submission=saved.submission;
    if(!current.principal.wallets.some(w=>w.toLowerCase()===saved.account.toLowerCase()))
      throw new CustomAIError("wallet","Reconnect the wallet that owns this saved launch.",403);
    if(submission?.state!=="completed"||!submission.reviewId||!submission.resourceId||!saved.reviewSubjectHash
      ||saved.reviewSubjectHash!==submission.reviewSubjectHash||!saved.requestHash)
      throw new CustomAIError("automatic-review-binding","The original launch review is not available yet.",409);
    return {current,reviewId:submission.reviewId,resourceId:submission.resourceId,subjectHash:saved.reviewSubjectHash};
  }
  async function read(request:Request,authority:AIAuthority,saved:GeneralPreparation) {
    const binding=identity(request,authority,saved);
    const reply=await deps.bridge().automaticReview(request,authority,{account:saved.account,reviewId:binding.reviewId,operation:"status"});
    const result=readAutomaticReview(reply.value,binding.reviewId);
    if(result.transport)readAutomaticTransport(result.transport,{...binding,account:saved.account,chainId:saved.chainId,originalRequestHash:saved.requestHash!},now());
    return result;
  }
  return {read,async check(request:Request,authority:AIAuthority,id:string) {
    const current=requireFreshCustomAIAuthority(request,authority);
    const {record,source,pack}=await deps.store.projects.preparations.readAutomaticInputs(current.owner,id);
    const bound=identity(request,authority,record),bridge=deps.bridge();
    // Configuration is an authenticated, read-only observation. It never
    // resumes the review or repeats model/fork work.
    const previous=await read(request,authority,record);
    if(previous.state==="approved"||previous.state==="checking"||previous.state==="changes_required")return previous;
    const configuration=previous.configuration;
    if(!configuration||configuration.productionHash!==record.productionId)
      throw new CustomAIError("automatic-review-context","Refresh this network's launch configuration before checking the source.",409);
    await deps.store.consume(current.owner,"general-launch-check",12);
    const sourceGeneratedAt=await deps.store.projects.readSourceCreatedAt(current.owner,record.selection.id,source.project.hash);
    if(sourceGeneratedAt===null)throw new CustomAIError("automatic-source-clock","Rebuild this older draft to prepare its automatic launch.",409);
    const receipt=createAutomaticSourceReceipt({source,sourceGeneratedAt,requestBody:pack.requestBody,
      review:{...bound,chainId:String(record.chainId),controller:record.account},verifierRevision:configuration.verifierRevision},now());
    await bridge.automaticReview(request,authority,{account:record.account,reviewId:bound.reviewId,operation:"bind-source",receipt});
    const result=readAutomaticReview((await bridge.automaticReview(request,authority,{account:record.account,reviewId:bound.reviewId,operation:"check"})).value,bound.reviewId);
    if(result.transport)readAutomaticTransport(result.transport,{...bound,account:record.account,chainId:record.chainId,originalRequestHash:record.requestHash!},now());
    return result;
  }};
}
