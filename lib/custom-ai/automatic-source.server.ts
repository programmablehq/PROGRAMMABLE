import "server-only";
import { getAddress } from "viem";
import { canonicalBrowserJsonV2,canonicalBrowserSha256V2,fileSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput,GENERAL_PROJECT_COMPILER } from "./contract-project";
import type { OwnedGeneralLaunchSource } from "./public-launch-source.server";
import { CustomAIError } from "./types";

export type AutomaticSourceReceipt = {
  schemaVersion:"programmable.automatic-source-context.v1";reviewId:string;subjectHash:`sha256:${string}`;
  chainId:"1"|"4663"|"8453"|"999";controller:string;sourceGeneratedAt:number;
  artifactHash:`sha256:${string}`;intentHash:`sha256:${string}`;productionHash:`sha256:${string}`;verifierRevision:`sha256:${string}`;
  intent:OwnedGeneralLaunchSource["project"]["intent"];compilationUnits:{id:string;inputHash:`sha256:${string}`}[];
};
const digest=/^sha256:[a-f0-9]{64}$/u;
const invalid=():never=>{throw new CustomAIError("automatic-source-binding","The automatic review could not be matched to this saved source. Your draft is kept.",409);};

/** Only the owned checked source, sealed request and server-read source time
 * may be passed here. No chat messages or browser-supplied receipt are copied. */
export function createAutomaticSourceReceipt(input:{source:OwnedGeneralLaunchSource;sourceGeneratedAt:number;requestBody:string;
  review:{reviewId:string;subjectHash:string;chainId:string;controller:string};verifierRevision:string},now=Date.now()):AutomaticSourceReceipt {
  const {source,review}=input,production=source.project.production;
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
    try{if(canonicalBrowserJsonV2(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)))!==compilerInput)return invalid();}
    catch{return invalid();}
    return {id:unit.compilationUnitId as string,inputHash:unit.standardJsonInputSha256 as `sha256:${string}`};
  });
  const receipt:AutomaticSourceReceipt={schemaVersion:"programmable.automatic-source-context.v1",reviewId:review.reviewId,
    subjectHash:review.subjectHash as `sha256:${string}`,chainId:review.chainId as AutomaticSourceReceipt["chainId"],controller:controller.toLowerCase(),
    sourceGeneratedAt:input.sourceGeneratedAt,artifactHash:source.compilation.artifactHash,
    intentHash:canonicalBrowserSha256V2("programmable.general-check-intent.v1",source.project.intent),
    productionHash:production.id,verifierRevision:input.verifierRevision as `sha256:${string}`,intent:structuredClone(source.project.intent),compilationUnits};
  if(Buffer.byteLength(JSON.stringify(receipt))>262_144)return invalid();
  return receipt;
}
