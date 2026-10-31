import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";

export const CHECK_ACCOUNTS = ["creator", "trader-a", "trader-b"] as const;
export type CheckAccount = typeof CHECK_ACCOUNTS[number];
export type CheckValue = string | boolean | CheckValue[] | { account: CheckAccount } | { contract: string };
export type ContractCheckFixture = {
  id: string; source: string; contract: string; arguments: CheckValue[];
  functions: string[]; allowReceive: boolean; allowFallback: boolean; surfaceRequirements: string[];
};
export type ContractCheckStep = {
  id: string; contract: string; signature: string; arguments: CheckValue[]; from: CheckAccount;
  afterSeconds: number; value: string; read: boolean; requirementIds: string[];
  expect: { status: "success" | "revert"; returns?: CheckValue[] };
};
export type GeneralCheckPlan = {
  version: 1; id: `sha256:${string}`; projectHash: ContractProject["hash"]; intentRevision: string;
  contracts: ContractCheckFixture[]; allowedCalls: CheckValue[]; steps: ContractCheckStep[];
};
const bad=():never=>{throw new TypeError("Use a bounded declared check plan for the complete saved design.");};
const object=(value:unknown,keys:string[],optional:string[]=[])=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return bad();
  const record=value as Record<string,unknown>;
  if(Object.keys(record).some(key=>!keys.includes(key)&&!optional.includes(key))||keys.some(key=>!Object.hasOwn(record,key)))return bad();
  return record;
};
const identifier=(value:unknown)=>{if(typeof value!=="string"||!/^[a-z][a-z0-9-]{0,63}$/.test(value))return bad();return value;};
function values(value:unknown,contracts:ReadonlySet<string>,depth=0):CheckValue[] {
  if(!Array.isArray(value)||value.length>32||depth>6)return bad();
  return value.map(item=>{
    if(typeof item==="boolean")return item;
    if(typeof item==="string"&&item.length<=2048&&!item.includes("\0"))return item;
    if(Array.isArray(item))return values(item,contracts,depth+1);
    if(!item||typeof item!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(item))||Object.keys(item).length!==1)return bad();
    if(Object.hasOwn(item,"account")){const name=(item as {account:CheckAccount}).account;if(!CHECK_ACCOUNTS.includes(name))return bad();return {account:name};}
    if(Object.hasOwn(item,"contract")){const id=identifier((item as {contract:unknown}).contract);if(!contracts.has(id))return bad();return {contract:id};}
    return bad();
  });
}

/** A declared oracle is not a semantic verdict. The caller supplies checks
 * independently of generated source; execution binds them to the exact project.
 * These references never grant ownership, review approval or launch authority. */
export function createGeneralCheckPlan(value:unknown,project:ContractProject):GeneralCheckPlan {
  if(new TextEncoder().encode(JSON.stringify(value)).length>96_000)return bad();
  const input=object(value,["contracts","allowedCalls","steps"]),requirements=new Map(project.intent.requirements.map(rule=>[rule.id,rule]));
  if(!Array.isArray(input.contracts)||input.contracts.length!==project.entrypoints.length||input.contracts.length>16
    ||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>256)return bad();
  const covered=new Set<string>(),contractIds=new Set<string>(),entries=new Set<string>();
  const ids=(value:unknown,constraint=false):string[]=>{
    if(!Array.isArray(value)||value.length>64||new Set(value).size!==value.length)return bad();
    return value.map(id=>{if(typeof id!=="string"||!requirements.has(id)||constraint&&requirements.get(id)!.kind!=="constraint")return bad();covered.add(id);return id;});
  };
  const contracts:ContractCheckFixture[]=input.contracts.map(raw=>{
    const v=object(raw,["id","source","contract","arguments","functions","allowReceive","allowFallback","surfaceRequirements"]),id=identifier(v.id);
    if(contractIds.has(id)||typeof v.source!=="string"||typeof v.contract!=="string"
      ||!project.entrypoints.some(entry=>entry.source===v.source&&entry.contract===v.contract)||entries.has(`${v.source}:${v.contract}`)
      ||typeof v.allowReceive!=="boolean"||typeof v.allowFallback!=="boolean"||!Array.isArray(v.functions)||v.functions.length>128
      ||v.functions.some(fn=>typeof fn!=="string"||!fn.startsWith("function ")||fn.length>800)||new Set(v.functions).size!==v.functions.length)return bad();
    const args=values(v.arguments,contractIds);contractIds.add(id);entries.add(`${v.source}:${v.contract}`);
    return {id,source:v.source,contract:v.contract,arguments:args,functions:v.functions as string[],allowReceive:v.allowReceive,
      allowFallback:v.allowFallback,surfaceRequirements:ids(v.surfaceRequirements,true)};
  });
  const allowedCalls=values(input.allowedCalls,contractIds);
  if(allowedCalls.some(item=>typeof item==="string"
    ? !/^0x[0-9a-f]{40}$/i.test(item)||!project.intent.requirements.some(rule=>(rule.text+(rule.origin.kind==="message"?rule.origin.quote:"")).toLowerCase().includes(item.toLowerCase()))
    : typeof item!=="object"||Array.isArray(item)))return bad();
  const stepIds=new Set<string>(),observed=new Set<string>();let lastTime=0;
  const steps:ContractCheckStep[]=input.steps.map(raw=>{
    const v=object(raw,["id","contract","signature","arguments","from","afterSeconds","value","read","requirementIds","expect"]),id=identifier(v.id);
    const expect=object(v.expect,["status"],["returns"]);
    if(stepIds.has(id)||typeof v.contract!=="string"||!contractIds.has(v.contract)||typeof v.signature!=="string"||v.signature.length>800
      ||typeof v.from!=="string"||!CHECK_ACCOUNTS.includes(v.from as CheckAccount)||typeof v.read!=="boolean"
      ||!Number.isSafeInteger(v.afterSeconds)||(v.afterSeconds as number)<lastTime||(v.afterSeconds as number)>315_360_000
      ||typeof v.value!=="string"||!/^\d{1,30}$/.test(v.value)||v.read&&v.value!=="0"
      ||!["success","revert"].includes(String(expect.status))||v.read&&expect.status==="success"&&!Object.hasOwn(expect,"returns")
      ||expect.status==="revert"&&Object.hasOwn(expect,"returns"))return bad();
    stepIds.add(id);lastTime=v.afterSeconds as number;
    const requirementIds=ids(v.requirementIds);
    if(expect.status==="revert"||Array.isArray(expect.returns)&&expect.returns.length)for(const id of requirementIds)observed.add(id);
    return {id,contract:v.contract,signature:v.signature,arguments:values(v.arguments,contractIds),from:v.from as CheckAccount,
      afterSeconds:v.afterSeconds as number,value:v.value,read:v.read,requirementIds,
      expect:{status:expect.status as "success"|"revert",...(expect.returns!==undefined?{returns:values(expect.returns,contractIds)}:{})}};
  });
  if(covered.size!==requirements.size||[...requirements.values()].some(rule=>rule.kind==="behavior"&&!observed.has(rule.id)))return bad();
  const body={version:1 as const,projectHash:project.hash,intentRevision:project.intent.revision,contracts,allowedCalls,steps};
  return {...body,id:canonicalBrowserSha256V2("programmable.general-declared-checks.v1",body)};
}
