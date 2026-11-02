import { describe, expect, it } from "vitest";
import { decodeGeneralCheckDeclaration } from "../lib/custom-ai/check-plan-wire";
import { createGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";

const intent:LaunchIntent={version:1,id:"wire-counter",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
  {id:"count",text:"Increment a public counter and emit its new value",kind:"behavior",open:null,origin:{kind:"legacy"}},
  {id:"surface",text:"Only the agreed public interface exists",kind:"constraint",open:null,origin:{kind:"legacy"}},
]};
function fixture() {
  const canonical={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"hook",arguments:[],functions:["function count() view returns(uint256)","function increment()"],
    allowReceive:false,allowFallback:false,surfaceRequirements:["surface"]}],allowedCalls:[],steps:[
    {id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:["count"],expect:{status:"success",events:[{contract:"main",signature:"event Counted(uint256 count)",arguments:["1"]}]}},
    {id:"read",contract:"main",signature:"count()",arguments:[],from:"trader-b",afterSeconds:10,value:"0",read:true,requirementIds:["count"],expect:{status:"success",returns:["1"]}},
  ]};
  const compact={format:"compact-v1",contracts:canonical.contracts.map(c=>[c.id,c.source,c.contract,c.role,c.arguments,c.functions,c.allowReceive,c.allowFallback,c.surfaceRequirements]),allowedCalls:[],
    steps:canonical.steps.map(s=>[s.id,s.contract,s.signature,s.arguments,s.from,s.afterSeconds,s.value,s.read,s.requirementIds,s.expect])};
  return {canonical,compact};
}
describe("lossless compact contract check transport",()=>{
  it("expands to the same complete declaration and frozen blueprint hash",()=>{
    const {canonical,compact}=fixture(),decoded=decodeGeneralCheckDeclaration(JSON.stringify(compact));
    expect(decoded).toEqual(canonical);
    expect(createGeneralCheckBlueprint(decoded,intent,999,"cancun")).toEqual(createGeneralCheckBlueprint(canonical,intent,999,"cancun"));
    expect(decodeGeneralCheckDeclaration(JSON.stringify(canonical))).toEqual(canonical);
  });
  it("substantially reduces repeated wire fields without dropping scenarios",()=>{
    const {canonical,compact}=fixture();
    canonical.steps=Array.from({length:80},(_,i)=>({...canonical.steps[i%2],id:`case-${i}`}));
    compact.steps=canonical.steps.map(s=>[s.id,s.contract,s.signature,s.arguments,s.from,s.afterSeconds,s.value,s.read,s.requirementIds,s.expect]);
    const compactBytes=JSON.stringify({generalChecks:JSON.stringify(compact)}).length;
    expect(compactBytes).toBeLessThan(JSON.stringify({generalChecks:JSON.stringify(canonical)}).length*0.7);
    expect(decodeGeneralCheckDeclaration(JSON.stringify(compact))).toEqual(canonical);
  });
  it("preserves canonical object rows without accepting extra fields",()=>{
    const {canonical,compact}=fixture();
    expect(decodeGeneralCheckDeclaration(JSON.stringify({...compact,contracts:canonical.contracts,steps:canonical.steps}))).toEqual(canonical);
    expect(()=>decodeGeneralCheckDeclaration(JSON.stringify({...compact,contracts:[{...canonical.contracts[0],unknown:true}]}))).toThrow();
  });
  it("preserves constructor child identities and explicit funding without adding defaults",()=>{
    const {compact}=fixture();
    const child=["child","Child.sol","Child","auxiliary",[{contract:"main"}],[],false,false,["surface"],"main","create","1","0"];
    const decoded=decodeGeneralCheckDeclaration(JSON.stringify({...compact,contracts:[compact.contracts[0].concat("10")],constructorChildren:[child]})) as {contracts:unknown[];constructorChildren:unknown[]};
    expect(decoded.contracts[0]).toMatchObject({id:"main",value:"10"});
    expect(decoded.constructorChildren).toEqual([{id:"child",source:"Child.sol",contract:"Child",role:"auxiliary",arguments:[{contract:"main"}],functions:[],allowReceive:false,allowFallback:false,surfaceRequirements:["surface"],parent:"main",creation:"create",nonce:"1",value:"0"}]);
    const withoutValue=decodeGeneralCheckDeclaration(JSON.stringify({...compact,contracts:[[...compact.contracts[0],null]]})) as {contracts:object[]};
    expect(withoutValue.contracts[0]).not.toHaveProperty("value");
  });
  it("rejects truncated, extended or unsupported row formats",()=>{
    const {compact}=fixture();
    for(const raw of [
      {...compact,format:"compact-v2"},
      {...compact,contracts:[compact.contracts[0].slice(0,8)]},
      {...compact,steps:[compact.steps[0].slice(0,9)]},
      {...compact,steps:[compact.steps[0].concat("extra")]},
      {...compact,constructorChildren:[[]]},
    ])expect(()=>decodeGeneralCheckDeclaration(JSON.stringify(raw))).toThrow();
  });
  it("retains the original reference, coverage and byte limits after expansion",()=>{
    const {compact}=fixture();
    for(const patch of [{allowedCalls:[{contract:"missing"}]},{command:"anything"},
      {steps:[[...compact.steps[0].slice(0,8),[],{status:"success"}]]}])
      expect(()=>createGeneralCheckBlueprint(decodeGeneralCheckDeclaration(JSON.stringify({...compact,...patch})),intent,999,"cancun")).toThrow();
    const large={...compact,steps:Array.from({length:180},(_,i)=>[`case-${i}`,"main","f"+"x".repeat(350)+"()",[],"trader-a",0,"0",true,["count"],{status:"success",returns:["1"]}])};
    expect(JSON.stringify(large).length).toBeLessThan(96_000);
    expect(()=>createGeneralCheckBlueprint(decodeGeneralCheckDeclaration(JSON.stringify(large)),intent,999,"cancun")).toThrow();
    expect(()=>decodeGeneralCheckDeclaration(" ".repeat(96_001))).toThrow();
  });
});
