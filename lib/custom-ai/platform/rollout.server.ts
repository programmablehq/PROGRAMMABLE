import "server-only";
import {CustomAIError} from "../types";

type Policy = {kind:"disabled"|"invalid"|"general"}|{kind:"pilot";owners:ReadonlySet<string>};

function policy():Policy {
  if(process.env.CUSTOM_AI_PLATFORM_ENABLED!=="true")return {kind:"disabled"};
  const raw=process.env.CUSTOM_AI_PLATFORM_PILOT_OWNERS;
  if(!raw?.trim())return {kind:"general"};
  try {
    if(raw.length>8192)return {kind:"invalid"};
    const owners:unknown=JSON.parse(raw);
    if(!Array.isArray(owners)||owners.length>32||owners.some(owner=>typeof owner!=="string"||!/^[A-Za-z0-9:_-]{1,200}$/.test(owner)))return {kind:"invalid"};
    if(owners.length===0)return {kind:"disabled"};
    return {kind:"pilot",owners:new Set<string>(owners)};
  } catch {return {kind:"invalid"};}
}

/** Public discovery reports the rollout mode, never the private owner roster. */
export function projectPlatformRollout():"general"|"pilot"|null {
  const current=policy();
  return current.kind==="general"||current.kind==="pilot"?current.kind:null;
}

export function assertProjectPlatformOwner(ownerId:string) {
  const current=policy();
  if(current.kind==="general"||current.kind==="pilot"&&current.owners.has(ownerId))return;
  if(current.kind==="pilot")throw new CustomAIError("platform-pilot","The project workspace is not available for this account yet. Your existing coin chats remain available.",403);
  throw new CustomAIError("unavailable","Project workspaces are not enabled here yet.",404);
}
