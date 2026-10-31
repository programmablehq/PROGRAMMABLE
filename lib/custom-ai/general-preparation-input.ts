import { getAddress } from "viem";
import { builderChain } from "./execution-routing";
import type { GeneralLaunchSourceSelection } from "./general-launch-source.server";
import { CustomAIError } from "./types";

type PrepareAction={action:"prepare";id:string;selection:GeneralLaunchSourceSelection;nativeFundingWei?:string};
type ExchangeAction={action:"preflight"|"create";id:string};
const invalid=():never=>{throw new CustomAIError("launch-input","Open the current saved source to prepare this launch.",400);};
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid();
  return value as Record<string,unknown>;
}
const identifier=(value:unknown)=>typeof value==="string"&&/^[A-Za-z0-9-]{16,64}$/u.test(value);
const hash=(value:unknown)=>typeof value==="string"&&/^sha256:[a-f0-9]{64}$/u.test(value);

export function parseGeneralPreparationAction(raw:unknown):PrepareAction|ExchangeAction {
  const value=object(raw);
  if(!identifier(value.id))return invalid();
  if(value.action==="preflight"||value.action==="create"){
    if(Object.keys(value).sort().join()!=="action,id")return invalid();
    return {action:value.action,id:String(value.id)};
  }
  if(value.action!=="prepare"||Object.keys(value).some(key=>!["action","id","selection","nativeFundingWei"].includes(key)))return invalid();
  const selected=object(value.selection);
  // bindingHash is an internal revalidation receipt. A browser cannot use it
  // to bypass the initial studio revision check or provide prepared bytes.
  if(Object.keys(selected).sort().join()!=="account,artifactHash,chainId,conversation,id,intentRevision,projectHash,studioRevision"
    || !identifier(selected.id)||!identifier(selected.conversation)||!hash(selected.projectHash)||!hash(selected.artifactHash)
    || typeof selected.account!=="string"||!/^0x[a-f0-9]{40}$/iu.test(selected.account)
    || !Number.isSafeInteger(selected.studioRevision)||Number(selected.studioRevision)<1
    || typeof selected.intentRevision!=="string"||!/^[a-f0-9]{64}$/u.test(selected.intentRevision)
    || typeof selected.chainId!=="number")return invalid();
  let chainId:GeneralLaunchSourceSelection["chainId"],account:string;
  try{chainId=builderChain(selected.chainId).id;account=getAddress(selected.account);}catch{return invalid();}
  if(value.nativeFundingWei!==undefined && (typeof value.nativeFundingWei!=="string"||!/^(?:0|[1-9][0-9]{0,77})$/u.test(value.nativeFundingWei)
    || BigInt(value.nativeFundingWei)>=2n**256n))return invalid();
  return {action:"prepare",id:String(value.id),selection:{id:String(selected.id),account,
    conversation:String(selected.conversation),chainId,studioRevision:Number(selected.studioRevision),
    projectHash:selected.projectHash as `sha256:${string}`,artifactHash:selected.artifactHash as `sha256:${string}`,intentRevision:selected.intentRevision},
    ...(value.nativeFundingWei===undefined?{}:{nativeFundingWei:value.nativeFundingWei})};
}
