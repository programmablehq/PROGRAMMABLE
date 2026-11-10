import "server-only";
import type {Hex} from "viem";
import {readCustomGraphFinalizedTransactionV3} from "@/lib/custom-launch/wallet-handoff-v3";
import {readLaunchPlanResourceV1} from "@/lib/custom-launch/wallet-handoff-plan-v1";
import type {BackendLaunchReply} from "../backend-launch.server";
import type {ProductRuntimeSource} from "./runtime-source.server";
import {CustomAIError} from "../types";

const fail=():never=>{throw new CustomAIError("product-launch-unconfirmed","This product's original launch is not confirmed yet.",409);};
const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const same=(a:unknown,b:string)=>typeof a==="string"&&a.toLowerCase()===b.toLowerCase();

/** The private backend establishes the request identity. Chain observations
 * must still verify this receipt and its actual component stamps. */
export function productRuntimeAnchor(reply:BackendLaunchReply,source:ProductRuntimeSource):{transactionHash:Hex;launchId:Hex|null}{
  if(reply.httpStatus!==200||reply.location!==null)return fail();
  if(source.chainId===4663){
    const plan=readLaunchPlanResourceV1(reply.value);
    if(plan.planId!==source.resourceId||plan.planHash!==source.requestHash||plan.rawRequestSha256!==source.requestSha256
      ||!same(plan.plan.controller.address,source.controller)||!["final","source_verified","indexed","publicly_visible"].includes(plan.status)
      ||plan.steps.length===0||plan.steps.some(step=>step.status!=="final"))return fail();
    const hashes=[...new Set(plan.steps.flatMap(step=>step.transactionHash?[step.transactionHash]:[]))];
    if(hashes.length!==1||!/^0x[a-f0-9]{64}$/i.test(hashes[0]))return fail();
    return {transactionHash:hashes[0],launchId:null};
  }
  const record=object(reply.value),output=object(record?.output),onchain=object(output?.onchain);
  if(!record||record.schemaVersion!=="programmable.custom-launch.v3"||record.routeId!=="custom-launch:create:v3"
    ||record.launchId!==source.resourceId||record.requestHash!==source.requestHash||!same(record.ownerWallet,source.controller)
    ||record.launchProfileHash!==source.launchProfileHash||record.launchIntentHash!==source.launchIntentHash||record.status!=="finalized"
    ||typeof record.onchainLaunchId!=="string"||!/^0x[a-f0-9]{64}$/i.test(record.onchainLaunchId)
    ||!output||output.schemaVersion!=="programmable.custom-launch-authorization-result.v3"||output.integrationState!=="ready"
    ||output.stage!=="onchain-observation"||output.actionRequired!==null||!onchain||!same(onchain.token,source.token)||!same(onchain.hook,source.hook))return fail();
  const launchId=record.onchainLaunchId as Hex;
  return {transactionHash:readCustomGraphFinalizedTransactionV3(onchain,{chainId:String(source.chainId) as "1"|"8453"|"999"|"99901",onchainLaunchId:launchId}),launchId};
}
