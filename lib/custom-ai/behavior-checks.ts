import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";
import type { LaunchIntent } from "./launch-intent";
import { parseV4CheckWorld,V4_WORLD_FIXTURES,V4_WORLD_STEP_SIGNATURES,type V4CheckWorld,type V4WorldFixture } from "./behavior-world";

export const CHECK_ACCOUNTS = ["creator", "trader-a", "trader-b"] as const;
export type CheckAccount = typeof CHECK_ACCOUNTS[number];
export type CheckValue = string | boolean | CheckValue[] | { account: CheckAccount } | { contract: string } | {fixture:V4WorldFixture} | {pool:true};
export type ContractCheckFixture = {
  id: string; source: string; contract: string; arguments: CheckValue[];
  functions: string[]; allowReceive: boolean; allowFallback: boolean; surfaceRequirements: string[];
  value?: string;
};
export type ConstructorCheckChild = ContractCheckFixture & { parent: string; creation: "create"; nonce: string; value: string };
export type ContractCheckStep = {
  id: string; contract: string; signature: string; arguments: CheckValue[]; from: CheckAccount;
  afterSeconds: number; value: string; read: boolean; requirementIds: string[];
  expect: { status: "success" | "revert"; returns?: CheckValue[];swapFeePpm?:number };
};
export type GeneralCheckPlan = {
  version: 1 | 2; id: `sha256:${string}`; projectHash: ContractProject["hash"]; intentRevision: string;
  contracts: ContractCheckFixture[]; allowedCalls: CheckValue[]; steps: ContractCheckStep[];
  world?:V4CheckWorld;
  constructorChildren?: ConstructorCheckChild[];
};
export type GeneralCheckScenarios = Pick<GeneralCheckPlan, "contracts" | "allowedCalls" | "steps"|"world"|"constructorChildren">;
export const generalCheckCaseCount = (plan: GeneralCheckScenarios) => 2 * (plan.contracts.length + (plan.constructorChildren?.length ?? 0)) + plan.steps.length;
const bad=():never=>{throw new TypeError("Use a bounded declared check plan for the complete saved design.");};
const object=(value:unknown,keys:string[],optional:string[]=[])=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return bad();
  const record=value as Record<string,unknown>;
  if(Object.keys(record).some(key=>!keys.includes(key)&&!optional.includes(key))||keys.some(key=>!Object.hasOwn(record,key)))return bad();
  return record;
};
const identifier=(value:unknown)=>{if(typeof value!=="string"||!/^[a-z][a-z0-9-]{0,63}$/.test(value))return bad();return value;};
function values(value:unknown,contracts:ReadonlySet<string>,depth=0,world=false):CheckValue[] {
  if(!Array.isArray(value)||value.length>32||depth>6)return bad();
  return value.map(item=>{
    if(typeof item==="boolean")return item;
    if(typeof item==="string"&&item.length<=2048&&!item.includes("\0"))return item;
    if(Array.isArray(item))return values(item,contracts,depth+1,world);
    if(!item||typeof item!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(item))||Object.keys(item).length!==1)return bad();
    if(Object.hasOwn(item,"account")){const name=(item as {account:CheckAccount}).account;if(!CHECK_ACCOUNTS.includes(name))return bad();return {account:name};}
    if(Object.hasOwn(item,"contract")){const id=identifier((item as {contract:unknown}).contract);if(!contracts.has(id))return bad();return {contract:id};}
    if(world&&Object.hasOwn(item,"fixture")){const id=(item as {fixture:V4WorldFixture}).fixture;if(!V4_WORLD_FIXTURES.includes(id))return bad();return {fixture:id};}
    if(world&&Object.hasOwn(item,"pool")&&(item as {pool:unknown}).pool===true)return {pool:true};
    return bad();
  });
}

/** A declared oracle is not a semantic verdict. The caller supplies checks
 * independently of generated source; execution binds them to the exact project.
 * These references never grant ownership, review approval or launch authority. */
export function normalizeGeneralCheckScenarios(value:unknown,intent:LaunchIntent,entrypoints:ContractProject["entrypoints"]):GeneralCheckScenarios {
  if(new TextEncoder().encode(JSON.stringify(value)).length>96_000)return bad();
  const input=object(value,["contracts","allowedCalls","steps"],["world","constructorChildren"]),requirements=new Map(intent.requirements.map(rule=>[rule.id,rule]));
  if(!Array.isArray(input.contracts)||!input.contracts.length||input.contracts.length>16
    ||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>256)return bad();
  const covered=new Set<string>(),contractIds=new Set<string>(),entries=new Set<string>();
  const ids=(value:unknown,constraint=false):string[]=>{
    if(!Array.isArray(value)||value.length>64||new Set(value).size!==value.length)return bad();
    return value.map(id=>{if(typeof id!=="string"||!requirements.has(id)||constraint&&requirements.get(id)!.kind!=="constraint")return bad();covered.add(id);return id;});
  };
  const fixture = (raw: unknown, available: ReadonlySet<string>, repeated = false): ContractCheckFixture => {
    const v=object(raw,["id","source","contract","arguments","functions","allowReceive","allowFallback","surfaceRequirements"],["value"]),id=identifier(v.id);
    if(contractIds.has(id)||V4_WORLD_FIXTURES.includes(id as V4WorldFixture)||typeof v.source!=="string"||typeof v.contract!=="string"
      ||!entrypoints.some(entry=>entry.source===v.source&&entry.contract===v.contract)||!repeated&&entries.has(`${v.source}:${v.contract}`)
      ||typeof v.allowReceive!=="boolean"||typeof v.allowFallback!=="boolean"||!Array.isArray(v.functions)||v.functions.length>128
      ||v.functions.some(fn=>typeof fn!=="string"||!fn.startsWith("function ")||fn.length>800)||new Set(v.functions).size!==v.functions.length
      ||v.value!==undefined&&(input.constructorChildren===undefined||typeof v.value!=="string"||!/^(?:0|[1-9][0-9]{0,29})$/.test(v.value)))return bad();
    const args=values(v.arguments,available,0,input.world!==undefined);contractIds.add(id);entries.add(`${v.source}:${v.contract}`);
    return {id,source:v.source,contract:v.contract,arguments:args,functions:v.functions as string[],allowReceive:v.allowReceive,
      allowFallback:v.allowFallback,surfaceRequirements:ids(v.surfaceRequirements,true),...(v.value!==undefined?{value:v.value as string}:{})};
  };
  const contracts:ContractCheckFixture[]=input.contracts.map(raw=>fixture(raw,contractIds));
  let constructorChildren: ConstructorCheckChild[] | undefined;
  if(input.constructorChildren!==undefined) {
    if(!Array.isArray(input.constructorChildren)||!input.constructorChildren.length||input.constructorChildren.length+contracts.length>16)return bad();
    const rootIndex=new Map(contracts.map((item,index)=>[item.id,index])), childRoots=new Map<string,number>(),nextNonce=new Map<string,bigint>();
    let previousRoot=-1;
    constructorChildren=input.constructorChildren.map(raw=>{
      const v=object(raw,["id","source","contract","arguments","functions","allowReceive","allowFallback","surfaceRequirements","parent","creation","nonce","value"]);
      if(typeof v.parent!=="string"||!contractIds.has(v.parent)||v.creation!=="create"||typeof v.nonce!=="string"||!/^[1-9][0-9]?$/.test(v.nonce)
        ||BigInt(v.nonce)!==(nextNonce.get(v.parent)??1n)||typeof v.value!=="string"||!/^(?:0|[1-9][0-9]{0,29})$/.test(v.value)
        ||!entrypoints.some(entry=>entry.source===v.source&&entry.contract===v.contract&&entry.role==="auxiliary"))return bad();
      const root=rootIndex.get(v.parent)??childRoots.get(v.parent);
      if(root===undefined||root<previousRoot)return bad();
      const available=new Set([...contracts.slice(0,root+1).map(item=>item.id),...childRoots.keys()]);
      const {parent,creation,nonce,value,...fields}=v;void parent;void creation;void nonce;void value;
      const child=fixture(fields,available,true);
      previousRoot=root;childRoots.set(child.id,root);nextNonce.set(v.parent,BigInt(v.nonce)+1n);
      return {...child,parent:v.parent,creation:"create" as const,nonce:v.nonce,value:v.value};
    });
  }
  if(entries.size!==entrypoints.length)return bad();
  const world=input.world!==undefined?parseV4CheckWorld(input.world,contractIds):undefined;
  if(world&&contracts.some(contract=>contract.id===world.hook&&contract.value!==undefined&&contract.value!=="0"))return bad();
  if(world&&(!entrypoints.some(entry=>entry.role==="token"&&contracts.find(item=>item.id===world.token)?.source===entry.source&&contracts.find(item=>item.id===world.token)?.contract===entry.contract)
    ||!entrypoints.some(entry=>entry.role==="hook"&&contracts.find(item=>item.id===world.hook)?.source===entry.source&&contracts.find(item=>item.id===world.hook)?.contract===entry.contract)))return bad();
  const allowedCalls=values(input.allowedCalls,contractIds,0,Boolean(world));
  if(allowedCalls.some(item=>typeof item==="string"
    ? !/^0x[0-9a-f]{40}$/i.test(item)||!intent.requirements.some(rule=>(rule.text+(rule.origin.kind==="message"?rule.origin.quote:"")).toLowerCase().includes(item.toLowerCase()))
    : typeof item!=="object"||Array.isArray(item)||"pool" in item))return bad();
  const stepIds=new Set<string>(),observed=new Set<string>();let lastTime=0;
  const steps:ContractCheckStep[]=input.steps.map(raw=>{
    const v=object(raw,["id","contract","signature","arguments","from","afterSeconds","value","read","requirementIds","expect"]),id=identifier(v.id);
    const expect=object(v.expect,["status"],["returns","swapFeePpm"]);
    if(stepIds.has(id)||typeof v.contract!=="string"||!contractIds.has(v.contract)&&!(world&&V4_WORLD_FIXTURES.includes(v.contract as V4WorldFixture))||typeof v.signature!=="string"||v.signature.length>800
      ||typeof v.from!=="string"||!CHECK_ACCOUNTS.includes(v.from as CheckAccount)||typeof v.read!=="boolean"
      ||!Number.isSafeInteger(v.afterSeconds)||(v.afterSeconds as number)<lastTime||(v.afterSeconds as number)>315_360_000
      ||typeof v.value!=="string"||!/^\d{1,30}$/.test(v.value)||v.read&&v.value!=="0"
      ||!["success","revert"].includes(String(expect.status))||v.read&&expect.status==="success"&&!Object.hasOwn(expect,"returns")
      ||expect.status==="revert"&&(Object.hasOwn(expect,"returns")||Object.hasOwn(expect,"swapFeePpm"))
      ||expect.swapFeePpm!==undefined&&(!world||v.contract!=="v4-router"||v.read||!Number.isInteger(expect.swapFeePpm)||(expect.swapFeePpm as number)<0||(expect.swapFeePpm as number)>1_000_000))return bad();
    stepIds.add(id);lastTime=v.afterSeconds as number;
    const requirementIds=ids(v.requirementIds);
    if(world&&V4_WORLD_FIXTURES.includes(v.contract as V4WorldFixture)&&(
      v.contract!=="v4-router"||!(V4_WORLD_STEP_SIGNATURES as readonly string[]).includes(v.signature as string)||v.read
      ||!Array.isArray(v.arguments)||!v.arguments[0]||typeof v.arguments[0]!=="object"||Array.isArray(v.arguments[0])
      ||Object.keys(v.arguments[0]).length!==1||v.arguments[0].pool!==true))return bad();
    if(expect.swapFeePpm!==undefined&&v.signature!==V4_WORLD_STEP_SIGNATURES[2])return bad();
    if(world&&v.contract==="v4-router"&&v.signature===V4_WORLD_STEP_SIGNATURES[0]&&(v.arguments as unknown[])[1]!==world.sqrtPriceX96)return bad();
    if(expect.status==="revert"||Array.isArray(expect.returns)&&expect.returns.length||expect.swapFeePpm!==undefined)for(const id of requirementIds)observed.add(id);
    return {id,contract:v.contract,signature:v.signature,arguments:values(v.arguments,contractIds,0,Boolean(world)),from:v.from as CheckAccount,
      afterSeconds:v.afterSeconds as number,value:v.value,read:v.read,requirementIds,
      expect:{status:expect.status as "success"|"revert",...(expect.returns!==undefined?{returns:values(expect.returns,contractIds,0,Boolean(world))}:{}),...(expect.swapFeePpm!==undefined?{swapFeePpm:expect.swapFeePpm as number}:{})}};
  });
  if(covered.size!==requirements.size||[...requirements.values()].some(rule=>rule.kind==="behavior"&&!observed.has(rule.id)))return bad();
  return {contracts,allowedCalls,steps,...(world?{world}:{}),...(constructorChildren?{constructorChildren}:{})};
}

export function createGeneralCheckPlan(value:unknown,project:ContractProject):GeneralCheckPlan {
  const scenarios=normalizeGeneralCheckScenarios(value,project.intent,project.entrypoints);
  if(scenarios.world&&project.compiler.evmVersion!=="cancun")return bad();
  const body={version:scenarios.constructorChildren?2 as const:1 as const,projectHash:project.hash,intentRevision:project.intent.revision,...scenarios};
  return {...body,id:canonicalBrowserSha256V2(`programmable.general-declared-checks.v${body.version}`,body)};
}
