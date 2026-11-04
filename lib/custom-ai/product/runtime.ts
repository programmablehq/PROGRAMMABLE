import type {Address, Hex} from "viem";
import type {BuilderChainId} from "../execution-routing";

/** A time-stamped contract observation, not proof that every future action succeeds. */
export type ProductRuntime = {
  version:1; state:"contracts-observed"; sourceId:string; preparationId:string;
  sourceBinding:string; implementationId:string; chainId:BuilderChainId;
  transactionHash:Hex; launchId:Hex; checkedAt:string;
  block:{number:string;hash:Hex}; providerCount:2;
  components:{id:string;name:string;address:Address;runtimeCodeHash:Hex}[];
  actions:{id:string;kind:string;address:Address;signature:string;mutability:"pure"|"view"|"nonpayable"|"payable";readInput?:"none"|"wallet"}[];
};

export function readProductRuntime(value:unknown,expected:{preparationId:string;sourceId:string;chainId:number}):ProductRuntime{
  const view=value as ProductRuntime,hex=(v:unknown,size:number)=>typeof v==="string"&&new RegExp(`^0x[0-9a-f]{${size}}$`,"i").test(v);
  const text=(v:unknown,max:number)=>typeof v==="string"&&v.length>0&&v.length<=max;
  if(!view||typeof view!=="object"||JSON.stringify(view).length>64_000||view.version!==1||view.state!=="contracts-observed"||view.providerCount!==2
    ||view.preparationId!==expected.preparationId||view.sourceId!==expected.sourceId||view.chainId!==expected.chainId
    ||!text(view.sourceBinding,80)||!text(view.implementationId,80)||!hex(view.transactionHash,64)||!hex(view.launchId,64)
    ||!text(view.checkedAt,32)||!Number.isFinite(Date.parse(view.checkedAt))||!view.block||!/^\d{1,30}$/.test(view.block.number)||!hex(view.block.hash,64)
    ||!Array.isArray(view.components)||view.components.length<1||view.components.length>64||view.components.some(item=>!item||!text(item.id,64)||!text(item.name,600)||!hex(item.address,40)||!hex(item.runtimeCodeHash,64))
    ||!Array.isArray(view.actions)||view.actions.length>64||view.actions.some(item=>!item||!text(item.id,64)||!["claim","deposit","withdraw","vote","inspect"].includes(item.kind)
      ||!hex(item.address,40)||!view.components.some(component=>component.address.toLowerCase()===item.address.toLowerCase())
      ||!text(item.signature,800)||!["pure","view","nonpayable","payable"].includes(item.mutability)
      ||item.readInput!==undefined&&(!["none","wallet"].includes(item.readInput)||!["view","pure"].includes(item.mutability))))throw Error("This contract snapshot does not match the saved product.");
  return view;
}
