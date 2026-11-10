import feeFlow from "./implementation-patterns/base-fee-flow-v1.json";
import nativeFeeSplit from "./implementation-patterns/native-fee-split-v1.json";
import {posix} from "node:path";
import {parseAbiItem,toFunctionSignature} from "viem";
import type {GeneralCheckBlueprint} from "./check-blueprint";
import type {ContractProject} from "./contract-project";
import type {ContractCheckFixture,ConstructorCheckChild} from "./behavior-checks";

const nativeFeeQuoteSemantics="The canonical quoteFees(amount, amountIsNet, isBuy) returns [gross, platformFee, creatorFee], not [platformFee, creatorFee, totalFee]. amountIsNet=false means amount is the gross native trade value; true means amount is net and must be grossed up. isBuy=true selects creatorBuyFeeBps, false selects creatorSellFeeBps. For a 2% total fee and 1 ETH gross input, call quoteFees(1000000000000000000,false,true): the return is [1000000000000000000,3000000000000000,17000000000000000]. The total fee is the sum of the last two values and is not a returned field. Net quotes round the gross up; each platform charge also rounds up. previewTradeFees uses the same argument order and returns [gross,platformFee,creatorFee,openingTax]. These statements describe the canonical reference, not arbitrary custom methods with the same name.";
const projectFeeAccounting="In these fee-flow references, the canonical feeVault records platform charges with recordFees(platformFee,0). Project fees fund the hook's separate liquidityReserve, buybackReserve and creatorReserve, plus holder reserves only when that reference has them. The hook's claimCreatorShare() pays creatorReserve directly to the fixed creator and clears it; no second creator balance is deposited in feeVault. feeVault.creatorAccrued() therefore stays zero and feeVault.claimCreator() reverts with NothingToClaim unless that vault actually received separate creator fees. A successful direct creator claim is the payout, not a prerequisite for a second vault claim. Fee quotes and unfunded calls do not create claimable funds. These ledger rules describe the references; custom accounting must follow its own saved requirements.";

export function interfaceKey(declaration:string):string|undefined {
  try{
    const abi=parseAbiItem(declaration);
    if(abi.type!=="function")return;
    return `${toFunctionSignature(abi)}:${abi.stateMutability}:${toFunctionSignature({...abi,name:"returns",inputs:abi.outputs})}`;
  }catch{return;}
}

/** ABI and construction knowledge only, never implementation input to the
 * independent scenario planner or a claim that arbitrary shares are supported. */
export function implementationPatternReferences(chainId:number){
  const references=[1,4663,8453,999,99901].includes(chainId)?[{id:"native-fee-flow-with-owned-liquidity-v1",
    description:"Reference architecture for collected-fee allocation to creator-owned liquidity, buyback and burn, daily top-ten holder claims and a fixed creator. All shares, rates, timing, eligibility and failure behavior still come from the saved intent.",
    contracts:feeFlow.contracts,
    semantics:{
      feeQuotes:nativeFeeQuoteSemantics,
      feeAccounting:projectFeeAccounting,
      observations:"A complete price interval spans at least 3600 seconds. Let a price-moving funding trade settle for a complete stable interval before a small observation trade and a positive execution case.",
      executeLiquidity:"Returns false when funds, price history, current price, hourly timing or execution are ineligible. Success creates real creator-owned liquidity, may retain unspent reserve, and can collect fresh project fees through its internal swap.",
      executeBuyback:"Returns false when ineligible. Success spends collected fees through the bound executor and burns received tokens. Its swap pays platform and project fees, so other reserve buckets can receive fresh funds.",
      snapshots:"IDs are zero-based. snapshotCount is a count: one completed snapshot has ID 0. Its eligible balances were captured before the first new-UTC-day balance change. Snapshot IDs are not day numbers.",
      claimCreatorShare:"Permissionless payout to the fixed creator. A positive reserve is paid and cleared; an empty reserve reverts with NothingClaimable. It does not return zero on a second empty claim.",
      claimHolder:"Permissionless payout to the named eligible snapshot holder, once per snapshot. An unknown, excluded, newly ineligible or already-paid holder has zero claimable balance and the claim reverts.",
      holderClaimable:"The view returns zero for an unknown snapshot, ineligible holder or completed claim. This zero-valued view does not mean a claim transaction succeeds.",
    },
    construction:"Keep the canonical initializer and protected token launch sequence. The generated hook creates the fee vault, protection module and opening-tax vault at CREATE nonces 1, 2, 3, then the creator-owned liquidity/execution vault at nonce 4 with (poolManager, hook, token, creator). The hook binds itself to the token during beforeInitialize; the immutable initializer does not call new custom methods. Internal swaps run through the separate execution vault so mandatory hook callbacks still run. Snapshot IDs are zero-based: snapshotCount 1 means completed snapshot ID 0. The observation needs at least one hour of history; a successful action also needs the current price within the slippage band. These are editable source references, not immutable deployed contracts or approval evidence."}]:[];
  if(chainId===1)references.unshift({id:"native-fee-split-with-locked-liquidity-v1",
    description:"Smaller reference for project fees split between locked liquidity, buyback and burn, and a fixed creator. Uses the plain protected launch token without holder snapshots. Requested rates, shares, timing and limits still come from the saved intent.",
    contracts:nativeFeeSplit.contracts,
    semantics:{
      feeQuotes:nativeFeeQuoteSemantics,
      feeAccounting:projectFeeAccounting,
      observations:"A complete price interval spans at least 3600 seconds. Let a price-moving funding trade settle for a complete stable interval before a small observation trade and a positive execution case.",
      executeLiquidity:"The vault owns the locked v4 position; owner() is the fixed recipient of earned position fees. liquidityPositionOwner() returns the vault. No principal withdrawal exists. The reference limits successful executions to one per elapsed 24 hours and spends only funded project-fee reserves.",
      executeBuyback:"Spends the funded buyback reserve through the separate vault and burns actual received tokens. It has a separate elapsed-24-hour limit. A failed swap reverts funding and execution together. A callable action is not proof that a scheduled executor is connected.",
      snapshots:"Not present in this plain-token reference.",
      claimCreatorShare:"Permissionless payout of the creator reserve to the fixed creator. An empty reserve reverts. Lifetime collected fees stay cumulative when reserves are paid or spent.",
      claimHolder:"Not present in this plain-token reference.",
      holderClaimable:"Not present in this plain-token reference.",
    },
    construction:"The hook creates the canonical fee vault, launch-protection module and opening-tax vault at CREATE nonces 1, 2 and 3, followed by the liquidity/execution vault at nonce 4. The plain protected token uses the canonical five constructor arguments and needs no bindHook method. Internal swaps use the separate vault. ABI and construction references are not implementation approval; the complete saved behavior is independently checked."});
  return references;
}

type ImplementationPattern={chainId:number;contracts:{id:string;role:string;source:string;contract:string;functions:string[];
  argumentCount:number;allowReceive:boolean;allowFallback:boolean;parent?:string;nonce?:string}[];sources:ContractProject["sources"]};

/** Reusable editable mechanics. The original intent still has to pass source
 * review and independent behavior checks; matching an ABI grants no approval. */
export function matchImplementationPattern(blueprint:GeneralCheckBlueprint,paths:readonly string[],canonical?:{
  sources:ContractProject["sources"];references:readonly {source:string;contract:string}[];
},allowAdditionalInterface=false):ContractProject["sources"]|undefined {
  if(![1,4663,8453,999,99901].includes(blueprint.chainId))return;
  // Prefer the smaller, complete fee-split reference over trimming a holder
  // registry that the user never asked for. New references retain their own
  // chain boundary; only the existing Base reference has cross-chain adapters.
  for(const pattern of [nativeFeeSplit,feeFlow]){
    const matched=matchPattern(pattern,blueprint,paths,canonical,allowAdditionalInterface);
    if(matched)return matched;
  }
}

function matchPattern(pattern:ImplementationPattern,blueprint:GeneralCheckBlueprint,paths:readonly string[],canonical:{
  sources:ContractProject["sources"];references:readonly {source:string;contract:string}[];
}|undefined,allowAdditionalInterface:boolean):ContractProject["sources"]|undefined {
  if(!paths.length||paths.length>pattern.contracts.length||pattern!==feeFlow&&blueprint.chainId!==pattern.chainId)return;
  const kernel=canonical?.references.find(item=>item.contract.endsWith("ProtectedNative30HookV1"));
  const protection=canonical?.references.find(item=>item.contract.endsWith("LaunchProtectionModuleV1"));
  const canonicalSource=kernel&&canonical?.sources[kernel.source]?.content;
  const boundManager=blueprint.production?.version===3?blueprint.production.protectionBindings?.poolManagerAddress:undefined;
  const manager=boundManager&&canonicalSource?.toLowerCase().includes(boundManager.toLowerCase())?boundManager
    :canonicalSource?.match(/CANONICAL_POOL_MANAGER\s*=\s*(0x[a-fA-F0-9]{40})\s*;/)?.[1];
  if(blueprint.chainId!==pattern.chainId&&(!kernel||!protection||!manager))return;
  const targets:(ContractCheckFixture|ConstructorCheckChild)[]=[...blueprint.scenarios.contracts,...(blueprint.scenarios.constructorChildren??[])];
  const functions=new Map(targets.map(target=>[target,new Set(target.functions.map(interfaceKey))]));
  const mapping=new Map<string,typeof targets[number]>();
  for(const entry of pattern.contracts){
    const referenceFunctions=new Set(entry.functions.map(interfaceKey));
    const matches=targets.filter(target=>(paths.includes(target.source)||Boolean(canonical?.sources[target.source]
      &&canonical.references.some(reference=>reference.source===target.source&&reference.contract===target.contract)))
      &&blueprint.entrypoints.some(point=>point.source===target.source&&point.contract===target.contract&&point.role===entry.role)
      &&target.arguments.length===entry.argumentCount&&target.allowReceive===entry.allowReceive&&target.allowFallback===entry.allowFallback
      &&(allowAdditionalInterface
        ?functions.get(target)!.size>0&&[...functions.get(target)!].every(key=>key!==undefined&&referenceFunctions.has(key))
        :functions.get(target)!.size===entry.functions.length&&entry.functions.every(fn=>{const key=interfaceKey(fn);return key!==undefined&&functions.get(target)!.has(key);})));
    if(matches.length!==1)return;
    mapping.set(entry.id,matches[0]);
  }
  const mappedSources=new Set([...mapping.values()].map(target=>target.source));
  if(mappedSources.size!==pattern.contracts.length||paths.some(path=>!mappedSources.has(path)))return;
  for(const entry of pattern.contracts){
    if(!entry.parent)continue;
    const target=mapping.get(entry.id)!;
    if(!("parent" in target)||target.parent!==mapping.get(entry.parent!)?.id||target.nonce!==entry.nonce)return;
  }
  const output:ContractProject["sources"]={};
  for(const entry of pattern.contracts){
    // A compatible canonical component is already fixed in the compiler
    // input. Reuse its identity for bindings without returning editable bytes.
    if(!paths.includes(mapping.get(entry.id)!.source))continue;
    // Relative imports resolve from the reference file, not from a generated
    // user's renamed directory.
    let content=pattern.sources[entry.source].content
      .replace(/(\bfrom\s*|\bimport\s*)(["'])(\.[^"']+)\2/g,(_match,prefix,quote,relative)=>
        `${prefix}${quote}${posix.normalize(posix.join(posix.dirname(entry.source),relative))}${quote}`);
    for(const peer of pattern.contracts){
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
