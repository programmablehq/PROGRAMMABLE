import "server-only";
import { getAddress } from "viem";
import { canonicalBrowserJsonV2,canonicalBrowserSha256V2,fileSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput,GENERAL_PROJECT_COMPILER } from "./contract-project";
import type { OwnedGeneralLaunchSource } from "./public-launch-source.server";
import { CustomAIError } from "./types";
import {checkedGeneralSourceAudit,type GeneralSourceAudit} from "./source-audit.server";

export type AutomaticSourceReceipt = {
  schemaVersion:"programmable.automatic-source-context.v1";reviewId:string;subjectHash:`sha256:${string}`;
  chainId:"1"|"4663"|"8453"|"999";controller:string;sourceGeneratedAt:number;
  artifactHash:`sha256:${string}`;intentHash:`sha256:${string}`;productionHash:`sha256:${string}`;verifierRevision:`sha256:${string}`;
  intent:OwnedGeneralLaunchSource["project"]["intent"];compilationUnits:{id:string;inputHash:`sha256:${string}`}[];
  projectHash:`sha256:${string}`;sourceAudit:GeneralSourceAudit;
};
const digest=/^sha256:[a-f0-9]{64}$/u;
const invalid=():never=>{throw new CustomAIError("automatic-source-binding","The automatic review could not be matched to this saved source. Your draft is kept.",409);};

export function generalReviewSubjectHash(chainId:number,request:Record<string,unknown>):`sha256:${string}` {
  const payload=structuredClone(request);
  if(chainId===4663){
    if(!payload.budgets||typeof payload.budgets!=="object"||Array.isArray(payload.budgets))return invalid();
    delete (payload.budgets as Record<string,unknown>).validAfter;delete (payload.budgets as Record<string,unknown>).deadline;
  }else{
    delete payload.permitWindow;delete payload.launchIntentHash;delete payload.fundingIntentHash;
    if(payload.agentAttestation&&typeof payload.agentAttestation==="object"&&!Array.isArray(payload.agentAttestation)){
      delete (payload.agentAttestation as Record<string,unknown>).subjectLaunchIntentHash;delete (payload.agentAttestation as Record<string,unknown>).checkedAt;
    }
  }
  const policy="programmable.custom-launch-manual-review.v1";
  return canonicalBrowserSha256V2(policy,{policy,chainId:String(chainId),request:payload});
}

export function readGeneralAutomaticIdentity(value:unknown,chainId:number,account:string,requestBody:string) {
  const root=value as Record<string,unknown>|null,review=root?.manualReview as Record<string,unknown>|undefined;
  if(!review||review.schemaVersion!=="programmable.custom-launch-manual-review.v1"
    ||typeof review.reviewId!=="string"||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(review.reviewId)
    ||review.chainId!==String(chainId)||typeof review.controller!=="string"||review.controller.toLowerCase()!==account.toLowerCase()
    ||review.subjectHash!==generalReviewSubjectHash(chainId,JSON.parse(requestBody)))return invalid();
  return {reviewId:review.reviewId,subjectHash:review.subjectHash as `sha256:${string}`,chainId:String(chainId),controller:account};
}

/** Only the owned checked source, sealed request and server-read source time
 * may be passed here. No chat messages or browser-supplied receipt are copied. */
export function createAutomaticSourceReceipt(input:{source:OwnedGeneralLaunchSource;sourceGeneratedAt:number;requestBody:string;
  review:{reviewId:string;subjectHash:string;chainId:string;controller:string};verifierRevision:string},now=Date.now()):AutomaticSourceReceipt {
  const {source,review}=input,production=source.project.production;
  if(!source.sourceAudit)throw new CustomAIError("automatic-source-audit","Finish the independent source check for this saved draft.",422);
  const sourceAudit=checkedGeneralSourceAudit(source.sourceAudit,source.project);
  if(sourceAudit.status!=="passed")throw new CustomAIError("automatic-source-audit",sourceAudit.findings[0]?.message??"The saved source needs a correction.",422);
  if(!production || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(review.reviewId)
    || !digest.test(review.subjectHash)||!digest.test(input.verifierRevision)
    || !Number.isSafeInteger(input.sourceGeneratedAt)||input.sourceGeneratedAt<0||input.sourceGeneratedAt>now
    || review.chainId!==String(source.project.chainId))return invalid();
  let controller:string;
  try{controller=getAddress(review.controller);}catch{return invalid();}
  if(controller.toLowerCase()!==source.binding.account.toLowerCase())return invalid();
  let request:Record<string,unknown>;
  if(typeof input.requestBody!=="string"||Buffer.byteLength(input.requestBody)>(review.chainId==="4663"?16_777_216:8_388_608))return invalid();
  try{request=JSON.parse(input.requestBody);}catch{return invalid();}
  if(!request || Array.isArray(request)||request.chainId!==review.chainId
    || request.schemaVersion!==(review.chainId==="4663"?"programmable.custom-launch-plan.v1":"programmable.custom-launch-create-request.v3"))return invalid();
  if(generalReviewSubjectHash(source.project.chainId,request)!==review.subjectHash)return invalid();
  const actor=review.chainId==="4663"?(request.controller as {address?:unknown})?.address:request.launchWallet;
  if(typeof actor!=="string"||actor.toLowerCase()!==controller.toLowerCase())return invalid();
  const units=(request.verificationBundle as {compilationUnits?:unknown})?.compilationUnits;
  if(!Array.isArray(units)||units.length<1||units.length>16)return invalid();
  const compilerInput=canonicalBrowserJsonV2(projectCompilerInput(source.project)),seen=new Set<string>();
  const compilationUnits=units.map(unit=>{
    if(!unit||typeof unit!=="object"||typeof unit.compilationUnitId!=="string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u.test(unit.compilationUnitId)||seen.has(unit.compilationUnitId)
      ||unit.compilerVersion!==GENERAL_PROJECT_COMPILER||typeof unit.standardJsonInputBase64!=="string"
      ||typeof unit.standardJsonInputSha256!=="string"||!digest.test(unit.standardJsonInputSha256))return invalid();
    seen.add(unit.compilationUnitId);
    const bytes=Buffer.from(unit.standardJsonInputBase64,"base64");
    if(bytes.length>5_242_880||bytes.toString("base64")!==unit.standardJsonInputBase64
      ||fileSha256V2(bytes)!==unit.standardJsonInputSha256)return invalid();
    try{
      const canonicalInput=canonicalBrowserJsonV2(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
      if(canonicalInput!==compilerInput||fileSha256V2(new TextEncoder().encode(canonicalInput))!==sourceAudit.compilerInputHash)return invalid();
    }
    catch{return invalid();}
    return {id:unit.compilationUnitId as string,inputHash:unit.standardJsonInputSha256 as `sha256:${string}`};
  });
  const receipt:AutomaticSourceReceipt={schemaVersion:"programmable.automatic-source-context.v1",reviewId:review.reviewId,
    subjectHash:review.subjectHash as `sha256:${string}`,chainId:review.chainId as AutomaticSourceReceipt["chainId"],controller:controller.toLowerCase(),
    sourceGeneratedAt:input.sourceGeneratedAt,artifactHash:source.compilation.artifactHash,
    intentHash:canonicalBrowserSha256V2("programmable.general-check-intent.v1",source.project.intent),
    productionHash:production.id,verifierRevision:input.verifierRevision as `sha256:${string}`,intent:structuredClone(source.project.intent),compilationUnits,
    projectHash:source.project.hash,sourceAudit};
  if(Buffer.byteLength(JSON.stringify(receipt))>262_144)return invalid();
  return receipt;
}
