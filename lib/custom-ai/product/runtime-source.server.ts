import "server-only";
import type { Address, Hex } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import type { AIStore } from "../store.server";
import { CustomAIError } from "../types";
import { checkedProductBlueprint } from "./blueprint";
import { createProductImplementation } from "./implementation.server";

const unavailable=():never=>{throw new CustomAIError("product-runtime-source","The original product and deployment package could not be matched.",409);};
export type ProductRuntimeTarget={id:string;address:Address;runtimeCodeHash:Hex;parent:string|null;nonce:string|null};

/** Private input for onchain inspection. Predicted addresses in this result
 * are not exposed as deployed, and cannot authorize a wallet transaction. */
export async function readProductRuntimeSource(store:AIStore,owner:string,preparationId:string){
  const {record,pack}=await store.projects.preparations.readRuntimeInputs(owner,preparationId);
  const id=record.selection.id;
  const [job,source,declared]=await Promise.all([store.read(owner,id),store.projects.read(owner,id),store.projects.readBlueprint(owner,id)]);
  if(!job||job.state!=="completed"||!source?.compilation?.compiled||!source.scenarios?.passed||!declared
    ||source.requestId!==id||source.payloadHash!==job.payloadHash||declared.payloadHash!==source.payloadHash
    ||source.project.hash!==record.selection.projectHash||source.compilation.artifactHash!==record.selection.artifactHash
    ||source.project.chainId!==record.chainId||source.project.production?.id!==record.productionId
    ||job.request?.conversation?.id!==record.selection.conversation
    ||job.request.conversation.account.toLowerCase()!==record.account.toLowerCase()
    ||!job.result?.productBlueprint||!job.result.generalProject?.implementation)return unavailable();
  const product=checkedProductBlueprint(job.result.productBlueprint,source.project.intent,record.chainId);
  const implementation=createProductImplementation(product,declared.blueprint,source.project,source.compilation,source.scenarios);
  if(!implementation||implementation.id!==job.result.generalProject.implementation.id||implementation.checkBlueprintId!==source.blueprintId)return unavailable();
  const deployment=source.project.deployment;
  const runtime=pack.route==="plan-v1"?pack.runtimeMaterialization:pack.constructorMaterialization;
  if(!runtime)throw new CustomAIError("product-runtime-legacy","This saved launch has no contract snapshot. Open its original submission to inspect it.",409);
  if(!deployment||runtime.projectHash!==source.project.hash||runtime.artifactHash!==source.compilation.artifactHash)return unavailable();
  const targets:ProductRuntimeTarget[]=runtime.targets.map(target=>{
    const compiled=runtime.contracts.find(contract=>contract.id===target.id);
    if(!compiled)return unavailable();
    return {id:target.id,address:target.address,runtimeCodeHash:compiled.runtimeCodeHash,parent:null,nonce:null};
  });
  for(const child of runtime.children??[])targets.push({id:child.id,address:child.address,runtimeCodeHash:child.runtimeCodeHash,parent:child.parent,nonce:child.nonce});
  if(targets.length<1||targets.length>16||new Set(targets.map(target=>target.id)).size!==targets.length)return unavailable();
  const fixtureToTarget=new Map<string,string>();
  for(const fixture of declared.blueprint.scenarios.contracts){
    const matches=deployment.targets.filter(target=>target.source===fixture.source&&target.contract===fixture.contract);
    const exact=matches.filter(target=>target.id===fixture.id),chosen=exact.length===1?exact:matches;
    if(chosen.length!==1)return unavailable();
    fixtureToTarget.set(fixture.id,chosen[0].id);
  }
  for(const fixture of declared.blueprint.scenarios.constructorChildren??[]){
    const matches=deployment.version===2?deployment.constructorChildren.filter(child=>child.source===fixture.source&&child.contract===fixture.contract
      &&child.parent===fixtureToTarget.get(fixture.parent)&&child.nonce===fixture.nonce):[];
    if(matches.length!==1)return unavailable();
    fixtureToTarget.set(fixture.id,matches[0].id);
  }
  const components=implementation.components.map(component=>{
    const target=targets.find(target=>target.id===fixtureToTarget.get(component.fixture));
    if(!target)return unavailable();
    return {id:component.id,targetId:target.id,address:target.address,runtimeCodeHash:target.runtimeCodeHash};
  });
  const body={version:1 as const,preparationId:record.id,sourceId:id,resourceId:record.submission!.resourceId!,chainId:record.chainId,
    controller:record.account,requestHash:record.requestHash!,packHash:pack.hash,implementationId:implementation.id,
    requestSha256:record.requestSha256!,launchProfileHash:record.launchProfileHash??null,launchIntentHash:record.launchIntentHash??null,
    productionId:record.productionId,executor:source.project.production!.executor,
    poolManager:source.project.production!.poolManager,
    planHash:pack.route==="plan-v1"?pack.planHash:null,manifestDigest:source.project.production!.manifestDigest,
    token:targets.find(target=>target.id===deployment.pool.token)?.address??unavailable(),
    hook:targets.find(target=>target.id===deployment.pool.hook)?.address??unavailable(),targets,components,
    state:"requires-onchain-observation" as const,readOnly:true as const};
  return { ...body,id:canonicalBrowserSha256V2("programmable.product-runtime-source.v1",body),product,implementation,
    // The exact ABI is kept on the authenticated server for later typed reads.
    contracts:source.compilation.contracts,fixtureToTarget:Object.fromEntries(fixtureToTarget) };
}

export type ProductRuntimeSource=Awaited<ReturnType<typeof readProductRuntimeSource>>;
