import "server-only";
import { concatHex, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, getCreate2Address, keccak256,
  parseAbiParameters, zeroAddress, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2, fileSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { CustomLaunchPlanV1, LaunchActionV1, LaunchControllerV1, LaunchEffectV1 } from "@/lib/custom-launch/launch-plan-v1";
import { generalSourcePackInputs, type GeneralPackInput } from "./general-pack-config.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction } from "./runtime-materialization.server";
import { ROBINHOOD_PLAN_DEPLOYER } from "./plan-deployer";
import { CustomAIError } from "./types";

const invalid=(message="This saved source needs a complete Robinhood Launch Plan before it can be prepared."):never=>{
  throw new CustomAIError("launch-plan-pack",message,422);
};
const MAX_TOTAL_GAS=16_000_000n,OUTER_GAS_RESERVE=250_000n;
const callbackNames=["beforeInitialize","afterInitialize","beforeAddLiquidity","afterAddLiquidity","beforeRemoveLiquidity",
  "afterRemoveLiquidity","beforeSwap","afterSwap","beforeDonate","afterDonate"];
type Prediction=GeneralDeploymentPrediction & {initCode:Hex;applicantSalt:Hex};

/** Exact modern Plan bytes from the same owned source/declaration and actual
 * constructor worker. No V4 graph conversion, live observation or admission.
 * The caller supplies a declared controller kind; it is not inferred from an
 * address. Contract wallets require their own current authority snapshot. */
export async function packGeneralRobinhoodPlan(input:GeneralPackInput,controller:LaunchControllerV1,signal?:AbortSignal) {
  signal?.throwIfAborted();
  const nativeFundingWei=input.nativeFundingWei;
  const base=generalSourcePackInputs(input,"plan"),{source,production,recipe,values,identity,exported,settings,image}=base;
  controller=structuredClone(controller);
  if(source.project.chainId!==4663 || production.route!=="plan-v1" || !production.manifestDigest || production.version!==2
    || getAddress(controller.address)!==base.controller || controller.kind!=="eoa" || Object.keys(controller).sort().join()!=="address,kind")
    return invalid("This Plan needs the selected Robinhood controller and its current wallet kind. Keep contract-wallet authority explicit.");
  if(BigInt(identity.deadline)<=BigInt(identity.validAfter)||BigInt(identity.deadline)-BigInt(identity.validAfter)>3600n)return invalid();
  const stop=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(75_000)]);
  const predicted=new Map<string,Prediction>();
  function resolve(value:unknown):unknown {
    if(Array.isArray(value))return value.map(resolve);
    if(value&&typeof value==="object") {
      if(Object.keys(value).join()!=="target"||!("target" in value)||typeof value.target!=="string")return invalid();
      return predicted.get(value.target)?.predictedAddress??invalid();
    }
    return value;
  }
  // The canonical source declaration already requires constructor references
  // to precede their consumers. Only the permission address search is mined.
  for(const target of values.targets) {
    const artifact=source.compilation.contracts.find(c=>c.source===target.source&&c.contract===target.contract)!;
    const initCode=encodeDeployData({abi:artifact.abi,bytecode:artifact.creationBytecode,args:target.constructorArguments.map(resolve)});
    let found:Prediction|undefined;
    for(let attempt=0;attempt<(target.role==="hook"?262144:1);attempt++) {
      if(attempt%512===0){stop.throwIfAborted();await new Promise<void>(done=>setImmediate(done));}
      const salt=keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,bytes32,string,uint256"),
        [4663n,base.controller,identity.nonce,target.id,BigInt(attempt)]));
      const address=getCreate2Address({from:ROBINHOOD_PLAN_DEPLOYER.address,salt,bytecodeHash:keccak256(initCode)});
      if(target.role!=="hook"||Number(BigInt(address)&16383n)===target.hookPermissions) {
        found={targetId:target.id,predictedAddress:address,effectiveSalt:salt,applicantSalt:salt,initCode,
          resolvedConstructorArguments:`0x${initCode.slice(artifact.creationBytecode.length)}`};break;
      }
    }
    if(!found)return invalid("The bounded hook address search did not finish. Your exact source and preparation identity are kept.");
    predicted.set(target.id,found);
  }
  const runtime=await materializeGeneralRuntime(source.project,source.compilation,{controller:base.controller,settings:values.settings,
    ...(nativeFundingWei===undefined?{}:{nativeFundingWei}),planDeployer:ROBINHOOD_PLAN_DEPLOYER},[...predicted.values()],stop);
  stop.throwIfAborted();
  const compilationBytes=base.files.find(file=>file.path==="input.json")!.bytes;
  const verificationBundle={schemaVersion:"programmable.exact-source-verification-bundle.v2",compilationUnits:[{
    compilationUnitId:"project",compilerVersion:source.compilation.compiler.replace(/\.Emscripten\.clang$/u,""),
    standardJsonInputBase64:Buffer.from(compilationBytes).toString("base64"),standardJsonInputSha256:fileSha256V2(compilationBytes),
  }],components:values.targets.map(target=>{
    const artifact=source.compilation.contracts.find(c=>c.source===target.source&&c.contract===target.contract)!,actual=runtime.contracts.find(c=>c.id===target.id)!;
    return {targetId:target.id,compilationUnitId:"project",sourcePath:target.source,contractName:target.contract,
      constructorArguments:predicted.get(target.id)!.resolvedConstructorArguments,runtimeMaterialization:{
        immutableReferences:Object.entries(artifact.immutableReferences).sort(([a],[b])=>BigInt(a)<BigInt(b)?-1:1)
          .map(([immutableId,ranges])=>({immutableId,ranges:[...ranges].sort((a,b)=>a.start-b.start)})),
        runtimeImmutables:actual.runtimeImmutables,
        deployedRuntimeCodeBase64:Buffer.from(actual.runtimeCode.slice(2),"hex").toString("base64"),deployedRuntimeCodeHash:actual.runtimeCodeHash,
      }};
  }).sort((a,b)=>a.targetId<b.targetId?-1:a.targetId>b.targetId?1:0)};
  const effects:LaunchEffectV1[]=runtime.contracts.map(c=>({effectId:`${c.id}-runtime`,kind:"runtime",criticality:"critical",
    target:{componentId:c.id},runtimeCodeHash:c.runtimeCodeHash}));
  const deploymentGas=new Map(values.targets.map(target=>{
    const observed=runtime.constructionGas!.find(gas=>gas.targetId===target.id)!;
    // A bounded planning allowance, not a live transaction gas estimate. The
    // canonical backend still simulates the complete actual execution.
    const limit=(BigInt(observed.maximumGasUsed)*130n+99n)/100n+97_000n+BigInt((predicted.get(target.id)!.initCode.length-2)/2)*16n;
    return [target.id,limit] as const;
  }));
  const remaining=MAX_TOTAL_GAS-OUTER_GAS_RESERVE-[...deploymentGas.values()].reduce((sum,gas)=>sum+gas,0n);
  const initializationCount=values.targets.filter(target=>target.initializer).length;
  if(remaining<0n || initializationCount>0&&remaining/BigInt(initializationCount)<100_000n)
    return invalid("This exact deployment needs a separate gas-budget assessment. No components or rules were dropped.");
  const initializationGas=initializationCount?remaining/BigInt(initializationCount):0n;
  const actions:LaunchActionV1[]=values.targets.map((target,index)=>{
    const prediction=predicted.get(target.id)!;
    return {actionId:`deploy-${target.id}`,kind:"deployCreate2",componentId:target.id,factory:{address:ROBINHOOD_PLAN_DEPLOYER.address},
      salt:prediction.effectiveSalt,initCode:prediction.initCode,execution:{target:{address:ROBINHOOD_PLAN_DEPLOYER.address},
        data:concatHex([prediction.effectiveSalt,prediction.initCode]),value:target.deploymentValueWei,gasLimit:deploymentGas.get(target.id)!.toString()},
      dependsOn:index?[`deploy-${values.targets[index-1].id}`]:[],authority:{kind:"controller"},preconditions:[],postconditions:[`${target.id}-runtime`]};
  });
  for(const target of values.targets) {
    if(!target.initializer)continue;
    const artifact=source.compilation.contracts.find(c=>c.source===target.source&&c.contract===target.contract)!;
    // Reuse the exact ABI and symbolic target resolution. No alternate call or
    // omitted initializer may be substituted when source packing fails.
    const fn=artifact.abi.find(item=>item.type==="function"&&item.name===target.initializer!.function);
    if(!fn||fn.type!=="function")return invalid();
    actions.push({actionId:`initialize-${target.id}`,kind:"call",dependsOn:[actions.at(-1)!.actionId],authority:{kind:"controller"},preconditions:[],postconditions:[],
      execution:{target:{componentId:target.id},data:encodeFunctionData({abi:[fn],functionName:fn.name,args:target.initializer.arguments.map(resolve)}),
        value:target.initializerValueWei,gasLimit:initializationGas.toString()}});
  }
  const totalGas=actions.reduce((sum,action)=>sum+("execution" in action?BigInt(action.execution.gasLimit):0n),0n);
  if(totalGas+OUTER_GAS_RESERVE>MAX_TOTAL_GAS)return invalid();
  const marketId="primary",tokenAddress=predicted.get(recipe.pool.token)!.predictedAddress;
  const tokenFirst=BigInt(tokenAddress)<BigInt(values.quoteCurrency);
  const hookArtifact=source.compilation.contracts.find(c=>c.source===values.targets.find(t=>t.id===recipe.pool.hook)!.source
    &&c.contract===values.targets.find(t=>t.id===recipe.pool.hook)!.contract)!;
  const plan:CustomLaunchPlanV1={schemaVersion:"programmable.custom-launch-plan.v1",chainId:"4663",manifestDigest:production.manifestDigest,
    controller,executor:"atomic_execute_and_stamp_v2",admissionPolicy:"programmable.custom-launch-policy.provenance.v1",verificationBundle,
    components:values.targets.map(target=>({componentId:target.id,artifactId:target.id,expectedAddress:predicted.get(target.id)!.predictedAddress,
      runtimeCodeHash:runtime.contracts.find(c=>c.id===target.id)!.runtimeCodeHash})),actions,
    markets:[{marketId,kind:"uniswap_v4",poolManager:production.poolManager.address,
      currency0:tokenFirst?{componentId:recipe.pool.token}:{address:values.quoteCurrency},
      currency1:tokenFirst?{address:values.quoteCurrency}:{componentId:recipe.pool.token},fee:recipe.pool.fee,tickSpacing:recipe.pool.tickSpacing,hooks:{componentId:recipe.pool.hook}}],
    hookBindings:[{componentId:recipe.pool.hook,poolManager:production.poolManager.address,permissions:values.targets.find(t=>t.id===recipe.pool.hook)!.hookPermissions!,
      callbackAbi:hookArtifact.abi.filter(item=>item.type==="function"&&callbackNames.includes(item.name)) as CustomLaunchPlanV1["hookBindings"][number]["callbackAbi"]}],
    dependencies:[{dependencyId:"create2-factory",chainId:"4663",address:ROBINHOOD_PLAN_DEPLOYER.address,runtimeCodeHash:ROBINHOOD_PLAN_DEPLOYER.runtimeCodeHash},
      {dependencyId:"pool-manager",chainId:"4663",...production.poolManager}],expectedEffects:effects,
    budgets:{maxTotalValue:values.nativeValueWei,maxTotalGas:MAX_TOTAL_GAS.toString(),validAfter:identity.validAfter,deadline:identity.deadline},
    feeObligations:[],claimDescriptors:[],distributionPreferences:[],publication:{visibility:"listed",primaryComponentId:recipe.pool.token,primaryMarketId:marketId,
      name:settings.name,symbol:settings.symbol,...(settings.description?.trim()?{description:settings.description.normalize("NFC").replace(/\r\n?/gu,"\n").trim()}:{}),imageUrl:image.url,
      links:[settings.website,settings.x].filter((uri):uri is string=>Boolean(uri?.trim())).map(uri=>new URL(uri.trim()).href)}};
  // Plan V1 HTTP accepts the exact canonical JSON bytes, without the V3
  // graph packer's trailing newline. The signed raw-body hash retains that.
  const requestBody=canonicalBrowserJsonV2(plan);
  if(Buffer.byteLength(requestBody)>16_777_216 || values.quoteCurrency!==zeroAddress)return invalid();
  const requestSha256=fileSha256V2(Buffer.from(requestBody)),planHash=canonicalBrowserSha256V2("programmable.custom-launch-plan.v1",plan);
  const body={version:1 as const,route:"plan-v1" as const,chainId:4663 as const,bindingHash:source.bindingHash,projectHash:source.project.hash,
    artifactHash:source.compilation.artifactHash,productionId:production.id,publicSourceId:exported.id,identity,requestBody,requestSha256,planHash,
    receipt:{schemaVersion:"programmable.custom-ai-plan-pack-receipt.v1",manifestDigest:production.manifestDigest,requestSha256,planHash,
      deployer:ROBINHOOD_PLAN_DEPLOYER,runtimeMaterializationHash:runtime.hash,componentCount:plan.components.length,actionCount:actions.length},
    reproducibleConfig:{version:1,controller,identity,deployer:ROBINHOOD_PLAN_DEPLOYER,sourceId:exported.id,
      targets:[...predicted.values()].map(({targetId,effectiveSalt,predictedAddress,resolvedConstructorArguments})=>({targetId,effectiveSalt,predictedAddress,resolvedConstructorArguments}))},
    runtimeMaterialization:runtime,launchReady:false as const};
  return {...body,hash:canonicalBrowserSha256V2("programmable.custom-ai-general-plan-pack.v1",body)};
}
