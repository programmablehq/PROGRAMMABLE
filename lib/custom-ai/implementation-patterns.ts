import feeFlow from "./implementation-patterns/base-fee-flow-v1.json";
import {parseAbiItem,toFunctionSignature} from "viem";
import type {GeneralCheckBlueprint} from "./check-blueprint";
import type {ContractProject} from "./contract-project";
import type {ContractCheckFixture,ConstructorCheckChild} from "./behavior-checks";

function interfaceKey(declaration:string):string|undefined {
  try{
    const abi=parseAbiItem(declaration);
    if(abi.type!=="function")return;
    return `${toFunctionSignature(abi)}:${abi.stateMutability}:${toFunctionSignature({...abi,name:"returns",inputs:abi.outputs})}`;
  }catch{return;}
}

/** ABI and construction knowledge only, never implementation input to the
 * independent scenario planner or a claim that arbitrary shares are supported. */
export function implementationPatternReferences(chainId:number){
  return [1,4663,8453,999].includes(chainId)?[{id:"native-fee-flow-with-owned-liquidity-v1",
    description:"Reference architecture for collected-fee allocation to creator-owned liquidity, buyback and burn, daily top-ten holder claims and a fixed creator. All shares, rates, timing, eligibility and failure behavior still come from the saved intent.",
    contracts:feeFlow.contracts,
    semantics:{
      observations:"A complete price interval spans at least 3600 seconds. Let a price-moving funding trade settle for a complete stable interval before a small observation trade and a positive execution case.",
      executeLiquidity:"Returns false when funds, price history, current price, hourly timing or execution are ineligible. Success creates real creator-owned liquidity, may retain unspent reserve, and can collect fresh project fees through its internal swap.",
      executeBuyback:"Returns false when ineligible. Success spends collected fees through the bound executor and burns received tokens. Its swap pays platform and project fees, so other reserve buckets can receive fresh funds.",
      snapshots:"IDs are zero-based. snapshotCount is a count: one completed snapshot has ID 0. Its eligible balances were captured before the first new-UTC-day balance change. Snapshot IDs are not day numbers.",
      claimCreatorShare:"Permissionless payout to the fixed creator. A positive reserve is paid and cleared; an empty reserve reverts with NothingClaimable. It does not return zero on a second empty claim.",
      claimHolder:"Permissionless payout to the named eligible snapshot holder, once per snapshot. An unknown, excluded, newly ineligible or already-paid holder has zero claimable balance and the claim reverts.",
      holderClaimable:"The view returns zero for an unknown snapshot, ineligible holder or completed claim. This zero-valued view does not mean a claim transaction succeeds.",
    },
    construction:"Keep the canonical initializer and protected token launch sequence. The generated hook creates the fee vault, protection module and opening-tax vault at CREATE nonces 1, 2, 3, then the creator-owned liquidity/execution vault at nonce 4 with (poolManager, hook, token, creator). The hook binds itself to the token during beforeInitialize; the immutable initializer does not call new custom methods. Internal swaps run through the separate execution vault so mandatory hook callbacks still run. Snapshot IDs are zero-based: snapshotCount 1 means completed snapshot ID 0. The observation needs at least one hour of history; a successful action also needs the current price within the slippage band. These are editable source references, not immutable deployed contracts or approval evidence."}]:[];
}

/** Reusable editable mechanics. The original intent still has to pass source
 * review and independent behavior checks; matching an ABI grants no approval. */
export function matchImplementationPattern(blueprint:GeneralCheckBlueprint,paths:readonly string[],canonical?:{
  sources:ContractProject["sources"];references:readonly {source:string;contract:string}[];
}):ContractProject["sources"]|undefined {
  if(![1,4663,8453,999].includes(blueprint.chainId)||paths.length!==feeFlow.contracts.length)return;
  const kernel=canonical?.references.find(item=>item.contract.endsWith("ProtectedNative30HookV1"));
  const protection=canonical?.references.find(item=>item.contract.endsWith("LaunchProtectionModuleV1"));
  const canonicalSource=kernel&&canonical?.sources[kernel.source]?.content;
  const boundManager=blueprint.production?.version===3?blueprint.production.protectionBindings?.poolManagerAddress:undefined;
  const manager=boundManager&&canonicalSource?.toLowerCase().includes(boundManager.toLowerCase())?boundManager
    :canonicalSource?.match(/CANONICAL_POOL_MANAGER\s*=\s*(0x[a-fA-F0-9]{40})\s*;/)?.[1];
  if(blueprint.chainId!==feeFlow.chainId&&(!kernel||!protection||!manager))return;
  const targets:(ContractCheckFixture|ConstructorCheckChild)[]=[...blueprint.scenarios.contracts,...(blueprint.scenarios.constructorChildren??[])];
  const functions=new Map(targets.map(target=>[target,new Set(target.functions.map(interfaceKey))]));
  const mapping=new Map<string,typeof targets[number]>();
  for(const entry of feeFlow.contracts){
    const matches=targets.filter(target=>paths.includes(target.source)&&blueprint.entrypoints.some(point=>point.source===target.source&&point.contract===target.contract&&point.role===entry.role)
      &&target.arguments.length===entry.argumentCount&&entry.functions.every(fn=>{const key=interfaceKey(fn);return key!==undefined&&functions.get(target)!.has(key);}));
    if(matches.length!==1)return;
    mapping.set(entry.id,matches[0]);
  }
  if(new Set([...mapping.values()].map(target=>target.source)).size!==paths.length)return;
  for(const entry of feeFlow.contracts){
    if(!("parent" in entry))continue;
    const target=mapping.get(entry.id)!;
    if(!("parent" in target)||target.parent!==mapping.get(entry.parent!)?.id||target.nonce!==entry.nonce)return;
  }
  const output:ContractProject["sources"]={};
  for(const entry of feeFlow.contracts){
    let content=feeFlow.sources[entry.source as keyof typeof feeFlow.sources].content;
    for(const peer of feeFlow.contracts){
      const target=mapping.get(peer.id)!;
      content=content.split(peer.source).join(target.source).replace(new RegExp(`\\b${peer.contract}\\b`,"g"),target.contract);
    }
    if(protection&&manager){
      content=content.replaceAll("src/base-custom-v1/BaseLaunchProtectionModuleV1.sol",protection.source)
        .replace(/\bBaseLaunchProtectionModuleV1\b/g,protection.contract)
        .replace(/CANONICAL_POOL_MANAGER = 0x[a-fA-F0-9]{40};/,`CANONICAL_POOL_MANAGER = ${manager};`)
        .replaceAll("block.chainid != 8453",`block.chainid != ${blueprint.chainId}`);
    }
    output[mapping.get(entry.id)!.source]={content};
  }
  return output;
}
