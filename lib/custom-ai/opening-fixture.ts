import {protectedOpeningPriceV1} from "@/packages/launch/src/protected-opening-price.mjs";
import type {BuilderChainId} from "./execution-routing";

type RecordValue=Record<string,unknown>;
export type OpeningFixtureInputs={source:"pinned-protected-opening-price";synthetic:true;tick:string;sqrtPriceX96:string;fdvUsd:string;supply:string;targetFdvUsd:string;nativeUsdAnswer:string};
export function openingFixtureInputs(proposal:RecordValue,chainId:BuilderChainId):OpeningFixtureInputs|undefined{
  const world=proposal.world as RecordValue|undefined,opening=(proposal.deployment as RecordValue|undefined)?.openingPrice as RecordValue|undefined;
  if(world?.kind!=="v4-protected-native-token-v1"||!opening)return;
  if(typeof opening.supply!=="string"||typeof opening.targetFdvUsd!=="string"||typeof world.nativeUsdAnswer!=="string"||!/^\d{1,38}$/u.test(world.nativeUsdAnswer))throw new TypeError("Declare bounded synthetic opening inputs.");
  const price=protectedOpeningPriceV1({supply:opening.supply,targetFdvUsd:opening.targetFdvUsd,answer:BigInt(world.nativeUsdAnswer),feedDecimals:chainId===999?18:8});
  return {source:"pinned-protected-opening-price",synthetic:true,tick:String(price.initialTick),sqrtPriceX96:String(price.sqrtPriceX96),fdvUsd:String(price.openingFdvUsd),supply:opening.supply,targetFdvUsd:opening.targetFdvUsd,nativeUsdAnswer:world.nativeUsdAnswer};
}
export function resolveOpeningFixtureValue(value:unknown,inputs?:OpeningFixtureInputs,depth=0,nodes={count:0}):unknown{
  if(depth>24||++nodes.count>12000)throw new TypeError("Opening references exceed the declaration bounds.");
  if(Array.isArray(value))return value.map(item=>resolveOpeningFixtureValue(item,inputs,depth+1,nodes));
  if(value&&typeof value==="object"){
    const object=value as RecordValue;
    if(Object.hasOwn(object,"opening")){
      if(Object.keys(object).length!==1||!inputs||!["tick","sqrtPriceX96","fdvUsd"].includes(String(object.opening)))throw new TypeError("Use a declared synthetic opening calculation.");
      return inputs[object.opening as "tick"|"sqrtPriceX96"|"fdvUsd"];
    }
    return Object.fromEntries(Object.entries(object).map(([key,item])=>[key,resolveOpeningFixtureValue(item,inputs,depth+1,nodes)]));
  }
  return value;
}
/** Only an explicit marker selects calculated prices. Numeric fixtures and
 * arbitrary custom economics are never silently repriced. */
export function resolveOpeningFixture(proposal:RecordValue,chainId:BuilderChainId){
  const inputs=openingFixtureInputs(proposal,chainId),world=proposal.world as RecordValue|undefined;
  if(world?.sqrtPriceX96==="from-opening-inputs"){
    if(!inputs)throw new TypeError("The calculated fixture needs its independent deployment opening inputs.");
    return {proposal:{...proposal,world:{...world,sqrtPriceX96:inputs.sqrtPriceX96},
      contracts:resolveOpeningFixtureValue(proposal.contracts,inputs),
      ...(proposal.constructorChildren?{constructorChildren:resolveOpeningFixtureValue(proposal.constructorChildren,inputs)}:{})},inputs};
  }
  return {proposal,inputs:inputs&&world?.sqrtPriceX96===inputs.sqrtPriceX96?inputs:undefined};
}
export const openingFixtureInstructions=`For canonical protected native launches, use world.sqrtPriceX96:'from-opening-inputs' and constructor value {opening:'sqrtPriceX96'} instead of guessing a price. The server calculates the exact synthetic price from deployment.openingPrice and world.nativeUsdAnswer using the pinned launch SDK. Scenario arguments may use {opening:'tick'} or {opening:'sqrtPriceX96'}; expected values may use {opening:'fdvUsd'}. These are explicit local calculations, not oracle observations. Native input and raw token minTokenOut have different units. The canonical protected token uses 18 decimals: one token is 1000000000000000000 raw units. Choose meaningful buy/sell sizes at the calculated price, never a token dust amount whose native output rounds below one wei. Approvals and sell amounts must use the same raw token units. Choose a positive, independently justified token minimum after accounting for fees; never copy native input as minTokenOut.`;
