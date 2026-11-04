import "server-only";
import {getAddress,toFunctionSignature,type Address} from "viem";
import {canonicalBrowserSha256V2} from "@/lib/custom-launch/browser-authority-v2";
import type {ProductRuntimeSource} from "./runtime-source.server";
import {encodeProductFunctionInput} from "./action-input";

/** Exact saved function and typed inputs. A subsequent provider observation
 * and current wallet confirmation are required before this can be used. */
export function prepareProductActionInput(source:ProductRuntimeSource,actionId:string,caller:Address,raw:unknown,valueWei:unknown="0"){
  const action=source.implementation.actions.find(item=>item.id===actionId);
  const component=action&&source.implementation.components.find(item=>item.id===action.target&&item.fixture===action.fixture);
  const target=action&&source.components.find(item=>item.id===action.target);
  const contract=component&&source.contracts.find(item=>item.source===component.source&&item.contract===component.contract);
  const fn=contract?.abi.find(item=>item.type==="function"&&toFunctionSignature(item)===action?.signature);
  if(!action||!component||!target||!fn||fn.type!=="function"||fn.stateMutability!==action.mutability)throw new TypeError("Open an action from this product's saved contract interface.");
  const input=encodeProductFunctionInput(fn,raw,valueWei);
  const body={version:1 as const,state:"inputs-encoded" as const,sourceBinding:source.id,implementationId:source.implementationId,
    actionId,chainId:source.chainId,caller:getAddress(caller),target:getAddress(target.address),...input,authorized:false as const};
  return {...body,id:canonicalBrowserSha256V2("programmable.product-action-input.v1",body)};
}
