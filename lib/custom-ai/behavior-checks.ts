import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { ContractProject } from "./contract-project";
import type { LaunchIntent } from "./launch-intent";
import { parseAbi, type Abi } from "viem";
import { parseV4CheckWorld,v4WorldFixtures,V4_WORLD_FIXTURES,V4_WORLD_STEP_SIGNATURES,type V4CheckWorld,type V4WorldFixture } from "./behavior-world";
import {CHECK_ACCOUNTS,CHECK_SIGNERS,type CheckAccount,type CheckSigner} from "./check-accounts";

export {CHECK_ACCOUNTS,type CheckAccount} from "./check-accounts";
export type CheckSignature={kind:"wallet-link"|"game-event";signer:CheckSigner;contract:string;values:CheckValue[];chainId?:number};
export type CheckValue = string | boolean | CheckValue[] | { account: CheckAccount } | { contract: string } | {fixture:V4WorldFixture} | {fixtureHash:V4WorldFixture} | {pool:true} | {signature:CheckSignature};
export type ContractCheckFixture = {
  id: string; source: string; contract: string; arguments: CheckValue[];
  functions: string[]; allowReceive: boolean; allowFallback: boolean; surfaceRequirements: string[];
  value?: string;
};
export type ConstructorCheckChild = ContractCheckFixture & { parent: string; creation: "create"; nonce: string; value: string };
export type ContractEventCheck = { contract: string; signature: string; arguments: CheckValue[] };
export type ContractCheckStep = {
  id: string; contract: string; signature: string; arguments: CheckValue[]; from: CheckAccount;
  afterSeconds: number; value: string; read: boolean; requirementIds: string[];
  expect: { status: "success" | "revert"; returns?: CheckValue[];swapFeePpm?:number;events?:ContractEventCheck[] };
};
export type GeneralCheckPlan = {
  version: 1 | 2; id: `sha256:${string}`; projectHash: ContractProject["hash"]; intentRevision: string;
  contracts: ContractCheckFixture[]; allowedCalls: CheckValue[]; steps: ContractCheckStep[];
  world?:V4CheckWorld;
  constructorChildren?: ConstructorCheckChild[];
};
export type GeneralCheckScenarios = Pick<GeneralCheckPlan, "contracts" | "allowedCalls" | "steps"|"world"|"constructorChildren">;
export const generalCheckCaseCount = (plan: GeneralCheckScenarios) => 2 * (plan.contracts.length + (plan.constructorChildren?.length ?? 0)) + plan.steps.length;
const bad=(reason="invalid-shape"):never=>{throw new TypeError(`Use a bounded declared check plan for the complete saved design. Validation: ${reason}.`);};
const object=(value:unknown,keys:string[],optional:string[]=[])=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return bad();
  const record=value as Record<string,unknown>;
  if(Object.keys(record).some(key=>!keys.includes(key)&&!optional.includes(key))||keys.some(key=>!Object.hasOwn(record,key)))return bad(`object-fields-required:${keys.join(",")};optional:${optional.join(",")}`);
  return record;
};
const identifier=(value:unknown)=>{if(typeof value!=="string"||!/^[a-z][a-z0-9-]{0,63}$/.test(value))return bad();return value;};
function values(value:unknown,contracts:ReadonlySet<string>,depth=0,world:readonly V4WorldFixture[]=[],signatures=false):CheckValue[] {
  if(!Array.isArray(value)||value.length>32||depth>6)return bad();
  return value.map(item=>{
    if(typeof item==="boolean")return item;
    if(typeof item==="string"&&item.length<=2048&&!item.includes("\0"))return item;
    if(Array.isArray(item))return values(item,contracts,depth+1,world,signatures);
    if(!item||typeof item!=="object"||![Object.prototype,null].includes(Object.getPrototypeOf(item))||Object.keys(item).length!==1)return bad();
    if(Object.hasOwn(item,"account")){const name=(item as {account:CheckAccount}).account;if(!CHECK_ACCOUNTS.includes(name))return bad();return {account:name};}
    if(Object.hasOwn(item,"contract")){const id=identifier((item as {contract:unknown}).contract);if(!contracts.has(id))return bad(`contract-reference:${id}:must-be-declared-earlier`);return {contract:id};}
    if(world.length&&Object.hasOwn(item,"fixture")){const id=(item as {fixture:V4WorldFixture}).fixture;if(!world.includes(id))return bad();return {fixture:id};}
    if(world.includes("native-usd-feed")&&Object.hasOwn(item,"fixtureHash")){const id=(item as {fixtureHash:V4WorldFixture}).fixtureHash;if(!world.includes(id))return bad();return {fixtureHash:id};}
    if(world.length&&Object.hasOwn(item,"pool")&&(item as {pool:unknown}).pool===true)return {pool:true};
    if(signatures&&Object.hasOwn(item,"signature")){
      const spec=object((item as {signature:unknown}).signature,["kind","signer","contract","values"],["chainId"]);
      if(!["wallet-link","game-event"].includes(String(spec.kind))||!CHECK_SIGNERS.includes(spec.signer as CheckSigner)
        ||typeof spec.contract!=="string"||!contracts.has(spec.contract)
        ||!Array.isArray(spec.values)||spec.values.length!==(spec.kind==="wallet-link"?5:8)
        ||spec.chainId!==undefined&&(!Number.isSafeInteger(spec.chainId)||Number(spec.chainId)<1||Number(spec.chainId)>0xffffffff))return bad("invalid-local-signature");
      const fields=values(spec.values,contracts,depth+1,world);
      const types=spec.kind==="wallet-link"?["bytes32","address","bytes32","bytes32","uint64"]:["bytes32","bytes32","bytes32","address","uint64","uint256","uint64","uint64"];
      if(fields.some((value,index)=>{
        const type=types[index];
        if(type==="address")return typeof value==="string"?!/^0x[0-9a-f]{40}$/i.test(value):!value||Array.isArray(value)||typeof value!=="object"||!("account" in value||"contract" in value||"fixture" in value);
        if(type==="bytes32")return typeof value!=="string"||!/^0x[0-9a-f]{64}$/i.test(value);
        return typeof value!=="string"||!/^(?:0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>=(1n<<BigInt(type==="uint64"?64:256));
      }))return bad("invalid-local-signature-fields");
      return {signature:{kind:spec.kind as CheckSignature["kind"],signer:spec.signer as CheckSigner,contract:spec.contract,
        values:fields,...(spec.chainId===undefined?{}:{chainId:spec.chainId as number})}};
    }
    return bad();
  });
}

/** A declared oracle is not a semantic verdict. The caller supplies checks
 * independently of generated source; execution binds them to the exact project.
 * These references never grant ownership, review approval or launch authority. */
export function normalizeGeneralCheckScenarios(value:unknown,intent:LaunchIntent,entrypoints:ContractProject["entrypoints"]):GeneralCheckScenarios {
  if(new TextEncoder().encode(JSON.stringify(value)).length>96_000)return bad();
  const input=object(value,["contracts","allowedCalls","steps"],["world","constructorChildren"]),requirements=new Map(intent.requirements.map(rule=>[rule.id,rule]));
  const fixtureNames=v4WorldFixtures(input.world);
  if(!Array.isArray(input.contracts)||!input.contracts.length||input.contracts.length>16
    ||!Array.isArray(input.steps)||!input.steps.length||input.steps.length>256)return bad();
  const covered=new Set<string>(),contractIds=new Set<string>(),entries=new Set<string>();
  const ids=(value:unknown,constraint=false):string[]=>{
    if(!Array.isArray(value)||value.length>64||new Set(value).size!==value.length)return bad("invalid-or-duplicate-requirement-ids");
    return value.map(id=>{if(typeof id!=="string"||!requirements.has(id))return bad("unknown-requirement-id");
      if(constraint&&requirements.get(id)!.kind!=="constraint")return bad("surface-requirements-only-accept-constraints-use-a-step-for-other-rules");
      covered.add(id);return id;});
  };
  const fixture = (raw: unknown, available: ReadonlySet<string>, repeated = false): ContractCheckFixture => {
    const v=object(raw,["id","source","contract","arguments","functions","allowReceive","allowFallback","surfaceRequirements"],["value"]),id=identifier(v.id);
    if(contractIds.has(id)||(V4_WORLD_FIXTURES as readonly string[]).includes(id)||fixtureNames.includes(id as V4WorldFixture)||typeof v.source!=="string"||typeof v.contract!=="string"
      ||!entrypoints.some(entry=>entry.source===v.source&&entry.contract===v.contract)||!repeated&&entries.has(`${v.source}:${v.contract}`)
      ||typeof v.allowReceive!=="boolean"||typeof v.allowFallback!=="boolean"||!Array.isArray(v.functions)||v.functions.length>128
      ||v.functions.some(fn=>typeof fn!=="string"||!fn.startsWith("function ")||fn.length>800)||new Set(v.functions).size!==v.functions.length
      ||v.value!==undefined&&(input.constructorChildren===undefined||typeof v.value!=="string"||!/^(?:0|[1-9][0-9]{0,29})$/.test(v.value)))return bad(`contract:${id}:invalid-identity-interface-or-constructor-value`);
    const args=values(v.arguments,available,0,fixtureNames);contractIds.add(id);entries.add(`${v.source}:${v.contract}`);
    return {id,source:v.source,contract:v.contract,arguments:args,functions:v.functions as string[],allowReceive:v.allowReceive,
      allowFallback:v.allowFallback,surfaceRequirements:ids(v.surfaceRequirements,true),...(v.value!==undefined?{value:v.value as string}:{})};
  };
  const contracts:ContractCheckFixture[]=input.contracts.map((raw,index)=>{
    try{return fixture(raw,contractIds);}catch(error){if(error instanceof TypeError)return bad(`contracts[${index}]:${error.message}`);throw error;}
  });
  let constructorChildren: ConstructorCheckChild[] | undefined;
  if(input.constructorChildren!==undefined) {
    if(!Array.isArray(input.constructorChildren)||!input.constructorChildren.length||input.constructorChildren.length+contracts.length>16)return bad();
    const rootIndex=new Map(contracts.map((item,index)=>[item.id,index])), childRoots=new Map<string,number>(),nextNonce=new Map<string,bigint>();
    let previousRoot=-1;
    constructorChildren=input.constructorChildren.map(raw=>{
      const v=object(raw,["id","source","contract","arguments","functions","allowReceive","allowFallback","surfaceRequirements","parent","creation","nonce","value"]);
      if(typeof v.parent!=="string"||!contractIds.has(v.parent))return bad(`constructor-child:${v.id}:parent-must-be-an-earlier-declared-contract`);
      if(typeof v.nonce!=="string"||!/^[1-9][0-9]?$/.test(v.nonce))return bad(`constructor-child:${v.id}:nonce-must-be-a-positive-decimal-string`);
      const expectedNonce=nextNonce.get(v.parent)??1n;
      if(BigInt(v.nonce)!==expectedNonce)return bad(`constructor-child:${v.id}:nonce-${v.nonce}-expected-${expectedNonce};declare-every-earlier-child-of-${v.parent}-in-creation-order`);
      if(v.creation!=="create"||typeof v.value!=="string"||!/^(?:0|[1-9][0-9]{0,29})$/.test(v.value)
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
  if(world?.kind==="v4-protected-native-token-v1"&&!entrypoints.some(entry=>entry.role==="liquidity"&&contracts.find(item=>item.id===world.initializer)?.source===entry.source&&contracts.find(item=>item.id===world.initializer)?.contract===entry.contract))return bad(`protected-world-initializer:${world.initializer}:requires-liquidity-role`);
  const allowedCalls=values(input.allowedCalls,contractIds,0,fixtureNames);
  if(allowedCalls.some(item=>typeof item==="string"
    ? !/^0x[0-9a-f]{40}$/i.test(item)||!intent.requirements.some(rule=>(rule.text+(rule.origin.kind==="message"?rule.origin.quote:"")).toLowerCase().includes(item.toLowerCase()))
    : typeof item!=="object"||Array.isArray(item)||"pool" in item||"fixtureHash" in item))return bad("allowedCalls:use-declared-contracts-fixtures-accounts-or-explicitly-agreed-addresses");
  const stepIds=new Set<string>(),observed=new Set<string>();let lastTime=0;
  const steps:ContractCheckStep[]=input.steps.map((raw,index)=>{try{
    const v=object(raw,["id","contract","signature","arguments","from","afterSeconds","value","read","requirementIds","expect"]),id=identifier(v.id);
    const expect=object(v.expect,["status"],["returns","swapFeePpm","events"]);
    const protectedInitialSwap=world?.kind==="v4-protected-native-token-v1"&&v.contract===world.initializer
      &&v.signature==="initialize(address,address,int24,address,uint256)";
    const declaredSwap=v.contract==="v4-router"&&v.signature===V4_WORLD_STEP_SIGNATURES[2]||protectedInitialSwap;
    if(expect.swapFeePpm!==undefined&&!declaredSwap)return bad("swap-fee-observations-require-a-real-swap-through-v4-router-or-the-protected-initializer-not-a-direct-hook-call");
    if(stepIds.has(id)||typeof v.contract!=="string"||!contractIds.has(v.contract)&&!fixtureNames.includes(v.contract as V4WorldFixture)||typeof v.signature!=="string"||v.signature.length>800
      ||typeof v.from!=="string"||!CHECK_ACCOUNTS.includes(v.from as CheckAccount)||typeof v.read!=="boolean"
      ||!Number.isSafeInteger(v.afterSeconds)||(v.afterSeconds as number)<lastTime||(v.afterSeconds as number)>315_360_000
      ||typeof v.value!=="string"||!/^\d{1,30}$/.test(v.value)||v.read&&v.value!=="0"
      ||!["success","revert"].includes(String(expect.status))||v.read&&expect.status==="success"&&!Object.hasOwn(expect,"returns")
      ||expect.status==="revert"&&(Object.hasOwn(expect,"returns")||Object.hasOwn(expect,"swapFeePpm")||Object.hasOwn(expect,"events"))
      ||v.read&&Object.hasOwn(expect,"events")
      ||expect.swapFeePpm!==undefined&&(!world||!declaredSwap||v.read||!Number.isInteger(expect.swapFeePpm)||(expect.swapFeePpm as number)<0||(expect.swapFeePpm as number)>1_000_000))return bad("invalid-step-fields-read-result-fee-or-nondecreasing-time");
    stepIds.add(id);lastTime=v.afterSeconds as number;
    const requirementIds=ids(v.requirementIds);
    if(world&&fixtureNames.includes(v.contract as V4WorldFixture)) {
      const balanceRead=world.kind==="v4-protected-native-token-v1"&&v.contract==="v4-router"&&v.signature==="nativeBalance(address)";
      if(balanceRead?(!v.read||!Array.isArray(v.arguments)||v.arguments.length!==1)
        :v.contract!=="v4-router"||!(V4_WORLD_STEP_SIGNATURES as readonly string[]).includes(v.signature as string)||v.read
          ||!Array.isArray(v.arguments)||!v.arguments[0]||typeof v.arguments[0]!=="object"||Array.isArray(v.arguments[0])
          ||Object.keys(v.arguments[0]).length!==1||v.arguments[0].pool!==true)return bad();
    }
    if(expect.swapFeePpm!==undefined&&world&&world.fee!==0x800000&&expect.swapFeePpm!==world.fee)
      return bad("swap-event-fee-must-match-fixed-pool-lp-fee-not-hook-tax");
    if(world&&v.contract==="v4-router"&&v.signature===V4_WORLD_STEP_SIGNATURES[0]&&(v.arguments as unknown[])[1]!==world.sqrtPriceX96)return bad();
    let events:ContractEventCheck[]|undefined;
    if(Object.hasOwn(expect,"events")) {
      if(!Array.isArray(expect.events)||!expect.events.length||expect.events.length>32)return bad();
      events=expect.events.map(raw=>{
        const event=object(raw,["contract","signature","arguments"]);
        if(typeof event.contract!=="string"||!contractIds.has(event.contract)&&!fixtureNames.includes(event.contract as V4WorldFixture)
          ||typeof event.signature!=="string"||!event.signature.startsWith("event ")||event.signature.length>800)return bad();
        let abi:Abi;
        try { abi=parseAbi([event.signature]); } catch { return bad(); }
        const item=abi[0];
        if(abi.length!==1||item.type!=="event"||item.anonymous||item.inputs.length>32||item.inputs.filter(input=>input.indexed).length>3
          ||item.inputs.some(input=>input.indexed&&(input.type.startsWith("tuple")||input.type.includes("["))))return bad();
        const args=values(event.arguments,contractIds,0,fixtureNames);
        if(args.length!==item.inputs.length)return bad();
        return {contract:event.contract,signature:event.signature,arguments:args};
      });
    }
    if(expect.status==="revert"||Array.isArray(expect.returns)&&expect.returns.length||expect.swapFeePpm!==undefined||events?.length)for(const id of requirementIds)observed.add(id);
    return {id,contract:v.contract,signature:v.signature,arguments:values(v.arguments,contractIds,0,fixtureNames,true),from:v.from as CheckAccount,
      afterSeconds:v.afterSeconds as number,value:v.value,read:v.read,requirementIds,
      expect:{status:expect.status as "success"|"revert",...(expect.returns!==undefined?{returns:values(expect.returns,contractIds,0,fixtureNames)}:{}),...(expect.swapFeePpm!==undefined?{swapFeePpm:expect.swapFeePpm as number}:{}),...(events?{events}:{})}};
  }catch(error){if(error instanceof TypeError)return bad(`steps[${index}]:${error.message}`);throw error;}});
  const missing=[...requirements.keys()].filter(id=>!covered.has(id));
  if(missing.length)return bad(`missing-requirements:${missing.join(",")}`);
  const unobserved=[...requirements.values()].filter(rule=>rule.kind==="behavior"&&!observed.has(rule.id)).map(rule=>rule.id);
  if(unobserved.length)return bad(`behavior-needs-a-return-event-fee-or-revert-observation:${unobserved.join(",")}`);
  return {contracts,allowedCalls,steps,...(world?{world}:{}),...(constructorChildren?{constructorChildren}:{})};
}

export function createGeneralCheckPlan(value:unknown,project:ContractProject):GeneralCheckPlan {
  const scenarios=normalizeGeneralCheckScenarios(value,project.intent,project.entrypoints);
  if(scenarios.world&&project.compiler.evmVersion!=="cancun")return bad();
  const body={version:scenarios.constructorChildren?2 as const:1 as const,projectHash:project.hash,intentRevision:project.intent.revision,...scenarios};
  return {...body,id:canonicalBrowserSha256V2(`programmable.general-declared-checks.v${body.version}`,body)};
}
