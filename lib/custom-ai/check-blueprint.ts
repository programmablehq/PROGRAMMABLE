import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, projectSourcePath, type ContractProject, type ProjectEntrypoint } from "./contract-project";
import { createProjectCompiler, newProjectCompilerProfile, projectCompilerProfile } from "./compiler-profile";
import { builderChain, type BuilderChainId } from "./execution-routing";
import { intentHasOpenParts, type LaunchIntent } from "./launch-intent";
import { createGeneralCheckPlan, normalizeGeneralCheckScenarios, type GeneralCheckScenarios } from "./behavior-checks";
import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";
import { createGeneralDeploymentBlueprint, deploymentBlueprintInput, generalDeploymentPlanningRules, type GeneralDeploymentBlueprint } from "./deployment-blueprint";
import {validateDeclaredInterfaceCalls} from "./declared-interface-calls";
import {checkedProductBindings,type ProductBindings} from "./product/bindings";

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
  productBlueprintId?: `sha256:${string}`;
  productBindings?: ProductBindings;
  launchInputsHash?: `sha256:${string}`;
};
const fail=(reason="invalid-blueprint"):never=>{throw new TypeError(`Declare complete contract scenarios before generating source. Validation: ${reason}.`);};

export const generalCheckFieldSchema={type:["string","null"],maxLength:96_000};
const checkInstructions={
  scope: `Keep the declaration compact: no prose, no repeated scenarios or duplicated ABI entries. Choose the smallest complete set of observable checks that covers every agreed behavior, negative constraint and required boundary. Compactness never permits dropping a requirement or replacing a real swap with a getter.`,
  contracts: `The logical declaration has contracts, allowedCalls and steps, with optional world, constructorChildren, compilerProfile and deployment as described below. Encode it using the compact-v1 wire rules supplied after this logical schema. Canonical contracts are ordered objects {id,source,contract,role,arguments,functions,allowReceive,allowFallback,surfaceRequirements}. role is token, hook, liquidity or auxiliary. source is a relative .sol path. functions contains the complete agreed public ABI as human-readable 'function name(types) mutability returns (types)' declarations, including public getters. Constructor arguments use the values below; a contract reference must already be deployed. surfaceRequirements contains canonical constraint IDs covered by the exact allowed interface.`,
  compiler: `compilerProfile selects only 'standard-v1' (optimizer1000, no IR) or 'viair-200-v1' (optimizer200, IR and the fixed inline protection-kit import aliases). Solidity stays pinned to0.8.26. Omit it to preserve a saved project's compiler profile. New projects with required production protections default to viair-200-v1 so they can import the original protection kit; other new projects default to standard-v1. Choose before generation, never as a silent post-generation retry. Each dependency must be supplied inline; aliases do not fetch packages.`,
  children: `For constructor-created auxiliary instances, constructorChildren contains the same fixture fields with role:'auxiliary', plus parent,creation:'create',nonce and explicit decimal wei value. With this V2 declaration, a direct constructor may also declare its own decimal wei value (otherwise zero). This is local fixture funding; forwarded child value is not another account payment. Positive native constructor value is not supported by the pinned v4 world's hook factory. Declare each actual instance separately, even when two instances share an artifact. Parent is a root or an earlier child. Its CREATE nonces start at '1' and are consecutive. Child arguments may reference already available roots, its parent and earlier children. Order children by root construction order. Checks invoke the actual observed child, never a separately deployed substitute. In a protected world, explicitly include every declared constructor child in allowedCalls as {contract:childId}; declaring a child does not grant an internal-call exception. Declare matching children in deployment.constructorChildren using that route's target/input/binding vocabulary. Undeclared, missing or mismatched creation fails the examples.`,
  steps: `Canonical steps are ordered and have exactly {id,contract,signature,arguments,from,afterSeconds,value,read,requirementIds,expect}. IDs are lower-case words with hyphens; contract refers to its declared id; signature is its canonical function signature; from is creator, trader-a, trader-b or an isolated signing actor: signer-issuer, signer-player-a, signer-player-b. afterSeconds is a nondecreasing integer since fixture creation. The local fixture starts at Unix timestamp 1800000000, and every call uses block.timestamp = 1800000000 + afterSeconds. For UTC calendar-day boundaries, the first midnight is afterSeconds 57600; this fixed clock is local test data, never the production launch time. value is a decimal wei string and zero for reads. expect is {status:'success',returns:[...]} or {status:'revert'}. A read:true step must include independently expected return values; omit returns only for a state-changing success assertion. Every behavior ID needs observable return values, exact event logs or revert examples, not only a successful transaction. Check boundaries and different callers where relevant.`,
  events: `For a required emitted event, a successful state-changing step must declare expect.events:[{contract:emitterId,signature:'event SwapCounted(address indexed sender,uint256 count)',arguments:[{account:'trader-a'},'1']}]. The signature includes indexed modifiers and arguments include ALL inputs in ABI order. Logs are checked on the actual emitter, with exact arguments, count and order for the declared emitter/signature pairs; unrelated logs are ignored. Declare repeated events individually. Each list has1-32 events. Omit events for reads and reverts. Non-anonymous events support scalar indexed fields (including string/bytes hashes), and any ABI-encodable non-indexed fields; indexed arrays/tuples are not supported. A getter or event ABI alone never proves emission. Check the real call that emits the required event.`,
  values: `ABI integer values use decimal strings; ABI bool values use JSON true or false, never quoted strings. Other values are strings, nested arrays, {account:'creator'|'trader-a'|'trader-b'}, or {contract:declaredId}. allowedCalls is an array of those account/contract references or exact addresses explicitly agreed in the saved intent. For real EIP712 game proofs in the networkless EVM, use fixed public test actors signer-issuer, signer-player-a and signer-player-b in {account:name} references and as from. A step argument may contain {signature:{kind:"wallet-link"|"game-event",signer:"signer-issuer"|"signer-player-a"|"signer-player-b",contract:declaredReceiverId,values:[...]}}. Wallet-link values are [bindingId,player,playerIdHash,nonce,validUntil]; game-event values are [bindingId,eventId,playerIdHash,player,sequence,score,observedAt,validUntil]. Use decimal integer strings and 32-byte hex IDs. These produce genuine signatures for the declared receiver and local chain with domain Programmable Project Events/version1. Optional chainId overrides only help negative-domain tests. The worker owns deterministic public TEST keys; never request, store or paste a private key. Use signer-issuer only for local receiver construction; preserve the actual service issuer in the separate deployment manifest. Signature references are allowed only in step arguments, never constructors or expected values. Existing creator/trader addresses are unchanged and cannot sign. No invented recipient whitelist. Cover every canonical requirement ID through surfaceRequirements or steps. Bounds:16 contracts,256 steps,96KB declaration, no commands or URLs. These are isolated local EVM examples with funded fixture accounts, not live wallets, network fixtures, review approval or launch readiness. Do not invent a connected oracle or external service.`,
  world: `For a token and standard native/token v4 hook, the supported local Cancun world adds world:{kind:'v4-native-token-v1',token:contractId,hook:contractId,hookPermissions:integerMask,fee:integer,tickSpacing:integer,sqrtPriceX96:decimalString}. Its exact pinned PoolManager and v4-router are fixtures, never live deployment addresses. Token/hook IDs must have those source roles. The hook is deployed by CREATE2 at the declared permission bits. Constructors may use {fixture:'pool-manager'} or {fixture:'v4-router'}. {pool:true} resolves only the declared canonical PoolKey. Deployment order still applies to ordinary {contract:id} references.`,
  worldActions: `Declare initialization, token approve/funding, liquidity, buys and sells as real ordered steps rather than claiming a getter proves a swap. The trusted v4-router accepts ONLY initialize((address,address,uint24,int24,address),uint160), liquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes), or swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes). Their first argument is {pool:true}. The uint160 initialization price must equal world.sqrtPriceX96. These steps are state-changing; native value is an explicit decimal wei string. Token methods are ordinary source-contract steps. For an actual swap, expect.swapFeePpm (integer) checks the pinned PoolManager's actual Swap event, not a hook getter. Check both sides of each exact time boundary and direct unauthorized callbacks. A synthetic world uses no live addresses, RPCs, keys, deposits or launch authority. Unsupported external-world mechanics remain unresolved evidence, not permission to omit their requirement.`,
  protectedWorld: `Original protected native/token source can use world.kind='v4-protected-native-token-v1' with the same pool fields plus initializer:itsLiquidityContractId and nativeUsdAnswer:aPositiveRawInteger. That initializer must be a root contract with role:'liquidity'; role:'auxiliary' is not valid for the world initializer. This separate fixture places the pinned local manager, authenticated router and synthetic feed at that chain's canonical addresses. Feed precision is 18 on HyperEVM and 8 otherwise; Base also has a synthetic recovered sequencer. Use {fixture:'native-usd-feed'|'sequencer-uptime-feed'} for those addresses and {fixtureHash:'native-usd-feed'|'v4-router'} for their exact local bytes32 hashes. The server binds the fixture revision; never supply code, URLs or live-state claims. Call initialize on the actual declared initializer. The protected router additionally exposes the read-only nativeBalance(address) so examples can check the actual payer and recipient balances around swaps and claims. Its msgSender() authenticates the active payer during a swap. Local feed values and successful examples are never production oracle observations or launch admission.`,
  protectedInitialBuy: `The canonical protected initialize(hook,token,startTick,buyer,minTokenOut) is a one-time launch by its configured factory, with a first buy for the same declared developer used by the protection module. In the isolated world use from:'creator' and buyer:{account:'creator'} when the local factory and developer are bound to creator. A different buyer does not make a valid positive launch example: the canonical initializer requires buyer to equal protection.developer(). Use other buyers or unauthorized callers only in explicit revert examples. The start tick must reproduce the hook's opening sqrt price, the initial native funding must be positive, and minTokenOut must be a positive raw token amount affordable after fees. A successful launch already executes a buy and accrues its fees. These prerequisites belong to the pinned protected initializer; arbitrary custom methods do not acquire these rules merely by sharing its function name.`,
};
export const generalCheckLogicalRules=[...Object.values(checkInstructions),generalDeploymentPlanningRules].join("\n");
export const generalCheckGraphRules=[checkInstructions.scope,checkInstructions.contracts,checkInstructions.compiler,
  checkInstructions.children,checkInstructions.values,checkInstructions.world,checkInstructions.protectedWorld,
  checkInstructions.protectedInitialBuy].join("\n");

export const generalCheckPlanningRules=`For action build on custom-contract, generalChecks is a JSON-encoded string declaring independent contract examples before source generation. Otherwise generalChecks=null. Never derive expected values from proposed implementation code.
${generalCheckLogicalRules}`;

export function createGeneralCheckBlueprint(value:unknown,intent:LaunchIntent,chainId:BuilderChainId,evmVersion:"paris"|"cancun",production?:LaunchProductionContext,previousCompiler?:ContractProject["compiler"],productBlueprintId?:`sha256:${string}`,launchInputsHash?:`sha256:${string}`):GeneralCheckBlueprint {
  if(launchInputsHash!==undefined&&!/^sha256:[a-f0-9]{64}$/u.test(launchInputsHash))return fail("launch-inputs-hash");
  builderChain(chainId);
  if(productBlueprintId!==undefined&&!/^sha256:[a-f0-9]{64}$/.test(productBlueprintId))return fail("product-identity");
  if(!intent?.id||!/^[a-f0-9]{64}$/.test(intent.revision)||intentHasOpenParts(intent)||!intent.requirements.length||intent.requirements.length>64
    ||!["paris","cancun"].includes(evmVersion)||!value||typeof value!=="object"||Array.isArray(value)
    ||![Object.prototype,null].includes(Object.getPrototypeOf(value))||new TextEncoder().encode(JSON.stringify(value)).length>96_000)return fail();
  const raw=value as Record<string,unknown>;
  if(Object.keys(raw).some(key=>!["contracts","allowedCalls","steps","world","deployment","constructorChildren","compilerProfile","productBindings"].includes(key))
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
  if(scenarios.world&&evmVersion!=="cancun")return fail("v4-world-requires-cancun");
  validateDeclaredInterfaceCalls(scenarios);
  const deployment=raw.deployment!==undefined?production?createGeneralDeploymentBlueprint(raw.deployment,entrypoints,production,intent):fail():undefined;
  validateDeclaredInterfaceCalls(scenarios,deployment);
  if(raw.productBindings!==undefined&&!productBlueprintId)return fail("product-bindings-require-product");
  const productBindings=raw.productBindings!==undefined?checkedProductBindings(raw.productBindings,scenarios,entrypoints):undefined;
  if(deployment) {
    const declared=deployment.version===2?deployment.constructorChildren:[],observed=scenarios.constructorChildren??[];
    if(declared.length!==observed.length)return fail("deployment-constructor-children-count");
    const parents=new Map(deployment.targets.map(target=>[target.id,contracts.find(fixture=>fixture.source===target.source&&fixture.contract===target.contract)?.id]));
    for(const child of declared) {
      const instance=observed.find(candidate=>candidate.parent===parents.get(child.parent)&&candidate.nonce===child.nonce);
      if(!instance||instance.source!==child.source||instance.contract!==child.contract)return fail("deployment-constructor-child-identity");
      parents.set(child.id,instance.id);
    }
  }
  if(deployment&&scenarios.world){
    const world=scenarios.world,source=(id:string)=>scenarios.contracts.find(target=>target.id===id),target=(id:string)=>deployment.targets.find(target=>target.id===id);
    const same=(example:string,deployed:string)=>source(example)?.source===target(deployed)?.source&&source(example)?.contract===target(deployed)?.contract;
    for(const role of ["token","hook"] as const)if(!same(world[role],deployment.pool[role]))return fail(`world-deployment-${role}-identity`);
    if(world.kind==="v4-protected-native-token-v1"&&!same(world.initializer,deployment.pool.initializer))return fail("world-deployment-initializer-identity");
    if(deployment.pool.fee!==world.fee||deployment.pool.tickSpacing!==world.tickSpacing||target(deployment.pool.hook)?.hookPermissions!==world.hookPermissions)return fail("world-deployment-fee-spacing-or-permissions");
  }
  const compiler=createProjectCompiler(Object.hasOwn(raw,"compilerProfile")?raw.compilerProfile:previousCompiler?projectCompilerProfile(previousCompiler):newProjectCompilerProfile(production),evmVersion);
  const body={version:1 as const,intentId:intent.id,intentRevision:intent.revision,intentHash:canonicalBrowserSha256V2("programmable.general-check-intent.v1",intent),chainId,
    compiler,entrypoints,scenarios,...(production?{production:checkedLaunchProductionContext(production,chainId)}:{}),...(deployment?{deployment}:{}),...(productBlueprintId?{productBlueprintId}:{}),...(productBindings?{productBindings}:{}),...(launchInputsHash?{launchInputsHash}:{})};
  return structuredClone({...body,id:canonicalBrowserSha256V2("programmable.general-check-blueprint.v1",body)});
}

export function generalCheckBlueprintInput(value:GeneralCheckBlueprint) {
  return {contracts:value.scenarios.contracts.map(fixture=>({...fixture,
    role:value.entrypoints.find(entry=>entry.source===fixture.source&&entry.contract===fixture.contract)?.role})),
    allowedCalls:value.scenarios.allowedCalls,steps:value.scenarios.steps,compilerProfile:projectCompilerProfile(value.compiler),...(value.scenarios.world?{world:value.scenarios.world}:{}),
    ...(value.scenarios.constructorChildren?{constructorChildren:value.scenarios.constructorChildren.map(child=>({...child,role:"auxiliary"}))}:{}),
    ...(value.deployment?{deployment:deploymentBlueprintInput(value.deployment)}:{}),...(value.productBindings?{productBindings:value.productBindings}:{})};
}

export function checkedGeneralCheckBlueprint(value:GeneralCheckBlueprint,intent:LaunchIntent):GeneralCheckBlueprint {
  if(!value||value.version!==1||!value.scenarios||!Array.isArray(value.entrypoints))return fail();
  const parsed=createGeneralCheckBlueprint(generalCheckBlueprintInput(value),intent,value.chainId,value.compiler?.evmVersion,value.production,undefined,value.productBlueprintId,value.launchInputsHash);
  // Reconstruct all fields; extra or changed metadata cannot inherit an ID.
  const {id,...body}=value;
  if(id!==parsed.id||id!==canonicalBrowserSha256V2("programmable.general-check-blueprint.v1",body))return fail();
  return parsed;
}

export function bindGeneralCheckBlueprint(blueprint:GeneralCheckBlueprint,project:ContractProject){
  projectCompilerInput(project);
  const checked=checkedGeneralCheckBlueprint(blueprint,project.intent);
  if(checked.chainId!==project.chainId||checked.compiler.version!==project.compiler.version||checked.compiler.evmVersion!==project.compiler.evmVersion
    ||checked.productBlueprintId!==project.productBlueprintId
    ||checked.production?.id!==project.production?.id
    ||checked.deployment?.id!==project.deployment?.id
    ||checked.compiler.optimizerRuns!==project.compiler.optimizerRuns||checked.compiler.viaIR!==project.compiler.viaIR
    ||canonicalBrowserSha256V2("programmable.project-entrypoints.v1",checked.entrypoints)!==canonicalBrowserSha256V2("programmable.project-entrypoints.v1",project.entrypoints))return fail();
  return createGeneralCheckPlan(checked.scenarios,project);
}
