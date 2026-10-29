import { createHash } from "node:crypto";
const integer = (value, min = 0, max = 315360000) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error("Invalid rule integer"); return String(value);
};
export const ruleSpecHash = spec => createHash("sha256").update(JSON.stringify(spec)).digest("hex");
export function composableModuleSource(spec, feeds) {
  if (spec.version !== 2 || !Array.isArray(spec.phases) || spec.phases.length < 1 || spec.phases.length > 16 || !Array.isArray(feeds) || feeds.length > 4) throw Error("Invalid composition");
  const functions = []; let next = 0, count = 0;
  const safeFeed = feeds.map((feed, index) => {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(feed.id) || !/^0x[0-9a-fA-F]{40}$/.test(feed.address) || !/^0x[0-9a-fA-F]{64}$/.test(feed.runtimeHash)) throw Error("Invalid bound feed");
    integer(feed.maxAge, 1, 86400);
    functions.push(`function _feed${index}() private view returns (bool,int256,uint64,uint64) {
      address target=address(uint160(${BigInt(feed.address)}));
      if(target.codehash!=${feed.runtimeHash}) return(false,0,0,0);
      (bool ok,bytes memory data)=target.staticcall{gas:18000}(abi.encodeWithSignature("latestSnapshot()"));
      if(!ok||data.length!=256) return(false,0,0,0);
      (uint64 seq,uint64 transition,int256 val,,uint64 changed,uint64 observed,uint64 until,bool fresh)=abi.decode(data,(uint64,uint64,int256,int256,uint64,uint64,uint64,bool));
      if(!fresh||seq==0||observed>block.timestamp||until<block.timestamp||block.timestamp-observed>${feed.maxAge}) return(false,0,0,0);
      return(true,val,transition,changed);
    }`);
    return feed;
  });
  const node = depth => { if (++count > 32 || depth > 8) throw Error("Rule complexity exceeded"); };
  function condition(c, depth = 0) {
    node(depth); const name=`_c${next++}`;
    if(c.kind==="feed") {
      const index=safeFeed.findIndex(f=>f.id===c.feedId); if(index<0 || !/^-?\d{1,30}$/.test(c.value)) throw Error("Unbound rule feed");
      const expression={lt:`val<${c.value}`,gte:`val>=${c.value}`,eq:`val==${c.value}`,changed:"transition>0&&changed>=launched"}[c.operator];
      if(!expression) throw Error("Invalid comparison");
      functions.push(`function ${name}(uint64 launched) private view returns(bool,bool,bytes32){(bool known,int256 val,uint64 transition,uint64 changed)=_feed${index}();return(known,known&&(${expression}),keccak256(abi.encode(${index},transition)));}`);
    } else {
      if(!["all","any"].includes(c.kind)||!Array.isArray(c.conditions)||!c.conditions.length||c.conditions.length>4)throw Error("Invalid rule condition");
      const children=c.conditions.map(x=>condition(x,depth+1)); const decide=c.kind==="all"?"false":"true";
      functions.push(`function ${name}(uint64 launched) private view returns(bool,bool,bytes32){bool unknown;bytes32 eventId;
        ${children.map(child=>`{(bool known,bool matched,bytes32 e)=${child}(launched);if(known&&matched==${decide})return(true,${decide},e);if(!known)unknown=true;eventId=keccak256(abi.encode(eventId,e));}`).join("\n")}
        return(!unknown,${c.kind==="all"?"true":"false"},eventId);}`);
    }
    return name;
  }
  function fee(f, depth = 0) {
    node(depth); const name=`_f${next++}`; let body;
    if(f.kind==="fixed")body=`return buy?${integer(f.buyBps,50,1500)}:${integer(f.sellBps,50,1500)};`;
    else if(f.kind==="ramp"){
      const duration=integer(f.durationSeconds,1),a=integer(f.fromBuyBps,50,1500),b=integer(f.toBuyBps,50,1500),c=integer(f.fromSellBps,50,1500),d=integer(f.toSellBps,50,1500);
      body=`int256 from=buy?int256(${a}):int256(${c});int256 target=buy?int256(${b}):int256(${d});uint256 t=elapsed>${duration}?${duration}:elapsed;return uint16(uint256(from+(target-from)*int256(t)/${duration}));`;
    } else if(f.kind==="conditional"){
      const test=condition(f.when,depth+1),yes=fee(f.then,depth+1),no=fee(f.otherwise,depth+1);
      body=`(bool known,bool matched,)=${test}(launched);if(!known)return 50;return matched?${yes}(elapsed,buy,launched):${no}(elapsed,buy,launched);`;
    } else throw Error("Invalid fee rule");
    functions.push(`function ${name}(uint256 elapsed,bool buy,uint64 launched) private view returns(uint16){${body}}`); return name;
  }
  const phases=spec.phases.map(p=>({start:integer(p.startsAtSeconds),end:p.endsAtSeconds===null?null:integer(p.endsAtSeconds,1),fn:fee(p.fee)}));
  const usesChange=c=>Boolean(c&&(c.kind==="feed"?c.operator==="changed":c.conditions.some(usesChange)));
  const actions=(spec.actions??[]).map(action=>{
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(action.id))throw Error("Invalid action id");
    const fn=action.when?condition(action.when):null;
    return `if(actionId==keccak256(bytes("${action.id}"))){if(block.timestamp<uint256(launched)+${integer(action.startsAtSeconds??0)})return(false,bytes32(0),0);${fn?`(bool known,bool matched,bytes32 e)=${fn}(launched);return(known&&matched,keccak256(abi.encode(configurationHash,actionId,e${usesChange(action.when)?"":`,block.timestamp/${integer(action.intervalSeconds,60,31536000)}`})),uint64(block.timestamp));`:`return(true,keccak256(abi.encode(configurationHash,actionId,block.timestamp/${integer(action.intervalSeconds,60,31536000)})),uint64(block.timestamp));`}}`;
  });
  const hash=ruleSpecHash(spec);
  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import { ICustomAIFeeModuleV1 } from "./ICustomAIFeeModuleV1.sol";
import { CustomAITypesV1 as T } from "./CustomAITypesV1.sol";
contract GeneratedFeeModule is ICustomAIFeeModuleV1 {
  bytes32 public immutable configurationHash;
  constructor(){configurationHash=keccak256(abi.encode(T.VERSION_ID,bytes32(0x${hash})${safeFeed.map(f=>`,address(uint160(${BigInt(f.address)})),bytes32(${f.runtimeHash})`).join("")}));}
  function quoteFee(T.SwapContext calldata c) external view returns(bytes4,uint16,uint64,bytes32){
    if(block.timestamp<c.launchTimestamp)return(this.quoteFee.selector,0,type(uint64).max,configurationHash);
    uint256 elapsed=block.timestamp-c.launchTimestamp;uint16 total=50;
    ${phases.map((p,i)=>`${i?"else ":""}if(elapsed>=${p.start}${p.end?`&&elapsed<${p.end}`:""})total=${p.fn}(elapsed-${p.start},c.buy,c.launchTimestamp);`).join("\n")}
    return(this.quoteFee.selector,total-50,type(uint64).max,configurationHash);
  }
  function actionState(bytes32 actionId,uint64 launched) external view returns(bool,bytes32,uint64){
    if(launched>block.timestamp)return(false,bytes32(0),0);
    ${actions.join("\n")}
    return(false,bytes32(0),0);
  }
  ${functions.join("\n")}
}
`;
}

export async function seedComposableFeeds(requireTool,vm,binding,timestamp,snapshots=[]) {
  const {createAddressFromString,hexToBytes}=requireTool("@ethereumjs/util");
  const word=n=>hexToBytes(`0x${BigInt.asUintN(256,BigInt(n)).toString(16).padStart(64,"0")}`);
  for(const feed of binding.feeds){
    const address=createAddressFromString(feed.address),state=snapshots.find(s=>s.feedId===feed.id);
    await vm.stateManager.putCode(address,hexToBytes(feed.runtimeCode));
    // V2 packs sequence/transition/changed/observed in slot 2 after EIP712's two fallback slots.
    const fresh=state?.fresh??true,observed=state?.observedAt??Number(timestamp),until=fresh?(state?.validUntil??Number(timestamp)+feed.maxAge):Number(timestamp)-1;
    const seq=BigInt(state?.sequence??1),transition=BigInt(state?.transitionSequence??0),changed=BigInt(state?.changedAt??0);
    await vm.stateManager.putStorage(address,word(2),word(seq|(transition<<64n)|(changed<<128n)|(BigInt(observed)<<192n)));
    await vm.stateManager.putStorage(address,word(3),word(until));
    await vm.stateManager.putStorage(address,word(4),word(state?.value??feed.minimum??0));
    await vm.stateManager.putStorage(address,word(5),word(state?.previousValue??state?.value??0));
  }
}
