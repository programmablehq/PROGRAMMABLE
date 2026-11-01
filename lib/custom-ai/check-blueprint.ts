import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, projectSourcePath, type ContractProject, type ProjectEntrypoint } from "./contract-project";
import { createProjectCompiler, projectCompilerProfile } from "./compiler-profile";
import { builderChain, type BuilderChainId } from "./execution-routing";
import { intentHasOpenParts, type LaunchIntent } from "./launch-intent";
import { createGeneralCheckPlan, normalizeGeneralCheckScenarios, type GeneralCheckScenarios } from "./behavior-checks";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";
import { createGeneralDeploymentBlueprint, deploymentBlueprintInput, generalDeploymentPlanningRules, type GeneralDeploymentBlueprint } from "./deployment-blueprint";

/** The interpreter declares this before code generation. It contains agreed
 * interfaces and scenarios, no implementation source or compiler artifacts. */
export type GeneralCheckBlueprint = {
  version: 1;
  id: `sha256:${string}`;
  intentId: string;
  intentRevision: string;
  intentHash: `sha256:${string}`;
  chainId: BuilderChainId;
  compiler: ContractProject["compiler"];
  entrypoints: ProjectEntrypoint[];
  scenarios: GeneralCheckScenarios;
  production?: LaunchProductionContext;
  deployment?: GeneralDeploymentBlueprint;
};
const fail=():never=>{throw new TypeError("Declare complete contract scenarios before generating source.");};

export const generalCheckFieldSchema={type:["string","null"],maxLength:96_000};
export const generalCheckPlanningRules=`For action build on custom-contract, generalChecks is a JSON-encoded string declaring independent contract examples before source generation. Otherwise generalChecks=null. Never derive expected values from proposed implementation code.
The encoded object has contracts, allowedCalls and steps, with optional world, constructorChildren, compilerProfile and deployment as described below. No other fields. contracts is an ordered array with objects {id,source,contract,role,arguments,functions,allowReceive,allowFallback,surfaceRequirements}. role is token, hook, liquidity or auxiliary. source is a relative .sol path. functions contains the complete agreed public ABI as human-readable 'function name(types) mutability returns (types)' declarations, including public getters. Constructor arguments use the values below; a contract reference must already be deployed. surfaceRequirements contains canonical constraint IDs covered by the exact allowed interface.
compilerProfile selects only 'standard-v1' (optimizer1000, no IR) or 'viair-200-v1' (optimizer200, IR and the fixed inline protection-kit import aliases). Solidity stays pinned to0.8.26. Omit it to preserve a saved project's compiler profile, or use standard-v1 for a new project. Choose before generation, never as a silent post-generation retry. Each dependency must be supplied inline; aliases do not fetch packages.
For constructor-created auxiliary instances, constructorChildren contains the same fixture fields with role:'auxiliary', plus parent,creation:'create',nonce and explicit decimal wei value. With this V2 declaration, a direct constructor may also declare its own decimal wei value (otherwise zero). This is local fixture funding; forwarded child value is not another account payment. Positive native constructor value is not supported by the pinned v4 world's hook factory. Declare each actual instance separately, even when two instances share an artifact. Parent is a root or an earlier child. Its CREATE nonces start at '1' and are consecutive. Child arguments may reference already available roots, its parent and earlier children. Order children by root construction order. Checks invoke the actual observed child, never a separately deployed substitute. Declare matching children in deployment.constructorChildren using that route's target/input/binding vocabulary. Undeclared, missing or mismatched creation fails the examples.
steps are ordered and have exactly {id,contract,signature,arguments,from,afterSeconds,value,read,requirementIds,expect}. IDs are lower-case words with hyphens; contract refers to its declared id; signature is its canonical function signature; from is creator, trader-a or trader-b. afterSeconds is a nondecreasing integer since fixture creation. value is a decimal wei string and zero for reads. expect is {status:'success',returns:[...]} or {status:'revert'}. Omit returns when only success is asserted. Every behavior ID needs observable return values or revert examples, not only a successful transaction. Check boundaries and different callers where relevant.
Values are strings for all numbers, booleans, nested arrays, {account:'creator'|'trader-a'|'trader-b'}, or {contract:declaredId}. allowedCalls is an array of those account/contract references or exact addresses explicitly agreed in the saved intent. No invented recipient whitelist. Cover every canonical requirement ID through surfaceRequirements or steps. Bounds:16 contracts,256 steps,96KB declaration, no commands or URLs. These are isolated local EVM examples with funded fixture accounts, not live wallets, network fixtures, review approval or launch readiness. Do not invent a connected oracle or external service.
For a token and standard native/token v4 hook, the supported local Cancun world adds world:{kind:'v4-native-token-v1',token:contractId,hook:contractId,hookPermissions:integerMask,fee:integer,tickSpacing:integer,sqrtPriceX96:decimalString}. Its exact pinned PoolManager and v4-router are fixtures, never live deployment addresses. Token/hook IDs must have those source roles. The hook is deployed by CREATE2 at the declared permission bits. Constructors may use {fixture:'pool-manager'} or {fixture:'v4-router'}. {pool:true} resolves only the declared canonical PoolKey. Deployment order still applies to ordinary {contract:id} references.
Declare initialization, token approve/funding, liquidity, buys and sells as real ordered steps rather than claiming a getter proves a swap. The trusted v4-router accepts ONLY initialize((address,address,uint24,int24,address),uint160), liquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes), or swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes). Their first argument is {pool:true}. The uint160 initialization price must equal world.sqrtPriceX96. These steps are state-changing; native value is an explicit decimal wei string. Token methods are ordinary source-contract steps. For an actual swap, expect.swapFeePpm (integer) checks the pinned PoolManager's actual Swap event, not a hook getter. Check both sides of each exact time boundary and direct unauthorized callbacks. A synthetic world uses no live addresses, RPCs, keys, deposits or launch authority. Unsupported external-world mechanics remain unresolved evidence, not permission to omit their requirement.
${generalDeploymentPlanningRules}`;

export function createGeneralCheckBlueprint(value:unknown,intent:LaunchIntent,chainId:BuilderChainId,evmVersion:"paris"|"cancun",production?:LaunchProductionContext,previousCompiler?:ContractProject["compiler"]):GeneralCheckBlueprint {
  builderChain(chainId);
  if(!intent?.id||!/^[a-f0-9]{64}$/.test(intent.revision)||intentHasOpenParts(intent)||!intent.requirements.length||intent.requirements.length>64
    ||!["paris","cancun"].includes(evmVersion)||!value||typeof value!=="object"||Array.isArray(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value))||new TextEncoder().encode(JSON.stringify(value)).length>96_000)return fail();
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!["contracts","allowedCalls","steps","world","deployment","constructorChildren","compilerProfile"].includes(key))
    ||!["contracts","allowedCalls","steps"].every(key=>Object.hasOwn(raw,key))||!Array.isArray(raw.contracts)||!raw.contracts.length||raw.contracts.length>16)return fail();
  const contracts:Record<string,unknown>[]=[],children:Record<string,unknown>[]=[],entries:ProjectEntrypoint[]=[];
  if(raw.constructorChildren!==undefined&&(!Array.isArray(raw.constructorChildren)||!raw.constructorChildren.length||raw.contracts.length+raw.constructorChildren.length>16))return fail();
  for(const [child,items] of [[false,raw.contracts],[true,raw.constructorChildren??[]]] as const)for(const item of items as unknown[]){
    if(!item||typeof item!=="object"||Array.isArray(item)||![Object.prototype,null].includes(Object.getPrototypeOf(item)))return fail();
    const {role,...fixture}=item as Record<string,unknown>,source=projectSourcePath(fixture.source);
    if(!["token","hook","liquidity","auxiliary"].includes(String(role))||child&&role!=="auxiliary"||typeof fixture.contract!=="string"||!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(fixture.contract))return fail();
    const existing=entries.find(entry=>entry.source===source&&entry.contract===fixture.contract);
    if(existing&&(!child||existing.role!==role))return fail();
    if(!existing)entries.push({source,contract:fixture.contract,role:role as ProjectEntrypoint["role"]});
    (child?children:contracts).push(fixture);
  }
  const entrypoints=entries.sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:a.contract<b.contract?-1:a.contract>b.contract?1:0);
  const scenarios=normalizeGeneralCheckScenarios({contracts,allowedCalls:raw.allowedCalls,steps:raw.steps,...(raw.world!==undefined?{world:raw.world}:{}),...(raw.constructorChildren!==undefined?{constructorChildren:children}:{})},intent,entrypoints);
  if(scenarios.world&&evmVersion!=="cancun")return fail();
  const deployment=raw.deployment!==undefined?production?createGeneralDeploymentBlueprint(raw.deployment,entrypoints,production,intent):fail():undefined;
  if(deployment) {
    const declared=deployment.version===2?deployment.constructorChildren:[],observed=scenarios.constructorChildren??[];
    if(declared.length!==observed.length)return fail();
    const parents=new Map(deployment.targets.map(target=>[target.id,contracts.find(fixture=>fixture.source===target.source&&fixture.contract===target.contract)?.id]));
    for(const child of declared) {
      const instance=observed.find(candidate=>candidate.parent===parents.get(child.parent)&&candidate.nonce===child.nonce);
      if(!instance||instance.source!==child.source||instance.contract!==child.contract)return fail();
      parents.set(child.id,instance.id);
    }
  }
  if(deployment&&scenarios.world){
    const world=scenarios.world,source=(id:string)=>scenarios.contracts.find(target=>target.id===id),target=(id:string)=>deployment.targets.find(target=>target.id===id);
    for(const role of ["token","hook"] as const)if(source(world[role])?.source!==target(deployment.pool[role])?.source||source(world[role])?.contract!==target(deployment.pool[role])?.contract)return fail();
    if(deployment.pool.fee!==world.fee||deployment.pool.tickSpacing!==world.tickSpacing||target(deployment.pool.hook)?.hookPermissions!==world.hookPermissions)return fail();
  }
  const compiler=createProjectCompiler(Object.hasOwn(raw,"compilerProfile")?raw.compilerProfile:previousCompiler?projectCompilerProfile(previousCompiler):"standard-v1",evmVersion);
  const body={version:1 as const,intentId:intent.id,intentRevision:intent.revision,intentHash:canonicalBrowserSha256V2("programmable.general-check-intent.v1",intent),chainId,
    compiler,entrypoints,scenarios,...(production?{production:checkedLaunchProductionContext(production,chainId)}:{}),...(deployment?{deployment}:{})};
  return structuredClone({...body,id:canonicalBrowserSha256V2("programmable.general-check-blueprint.v1",body)});
}

export function checkedGeneralCheckBlueprint(value:GeneralCheckBlueprint,intent:LaunchIntent):GeneralCheckBlueprint {
  if(!value||value.version!==1||!value.scenarios||!Array.isArray(value.entrypoints))return fail();
  const parsed=createGeneralCheckBlueprint({contracts:value.scenarios.contracts.map(fixture=>({...fixture,
    role:value.entrypoints.find(entry=>entry.source===fixture.source&&entry.contract===fixture.contract)?.role})),
    allowedCalls:value.scenarios.allowedCalls,steps:value.scenarios.steps,compilerProfile:projectCompilerProfile(value.compiler),...(value.scenarios.world?{world:value.scenarios.world}:{}),
    ...(value.scenarios.constructorChildren?{constructorChildren:value.scenarios.constructorChildren.map(child=>({...child,role:"auxiliary"}))}:{}),
    ...(value.deployment?{deployment:deploymentBlueprintInput(value.deployment)}:{})},intent,value.chainId,value.compiler?.evmVersion,value.production);
  // Reconstruct all fields; extra or changed metadata cannot inherit an ID.
  const {id,...body}=value;
  if(id!==parsed.id||id!==canonicalBrowserSha256V2("programmable.general-check-blueprint.v1",body))return fail();
  return parsed;
}

export function bindGeneralCheckBlueprint(blueprint:GeneralCheckBlueprint,project:ContractProject){
  projectCompilerInput(project);
  const checked=checkedGeneralCheckBlueprint(blueprint,project.intent);
  if(checked.chainId!==project.chainId||checked.compiler.version!==project.compiler.version||checked.compiler.evmVersion!==project.compiler.evmVersion
    ||checked.production?.id!==project.production?.id
    ||checked.deployment?.id!==project.deployment?.id
    ||checked.compiler.optimizerRuns!==project.compiler.optimizerRuns||checked.compiler.viaIR!==project.compiler.viaIR
    ||canonicalBrowserSha256V2("programmable.project-entrypoints.v1",checked.entrypoints)!==canonicalBrowserSha256V2("programmable.project-entrypoints.v1",project.entrypoints))return fail();
  return createGeneralCheckPlan(checked.scenarios,project);
}
