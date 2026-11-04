import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import type { ContractCheckStep } from "../lib/custom-ai/behavior-checks";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

const intent:LaunchIntent={version:1,id:"independent-events",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
  {id:"counter",kind:"behavior",text:"Increment once and emit SwapCounted with the caller and new counter on every call",open:null,origin:{kind:"legacy"}},
  {id:"surface",kind:"constraint",text:"Only the agreed interface exists",open:null,origin:{kind:"legacy"}},
]};
const signature="event SwapCounted(address indexed sender,uint256 count)";
const common={source:"Counter.sol",allowReceive:false,allowFallback:false,surfaceRequirements:["surface"]};
function declaration(nested=false) {
  const main={...common,id:"counter",contract:"Counter",role:"hook",arguments:nested?[]:[{contract:"peer"}],
    functions:["function count() view returns(uint256)","function peer() view returns(address)","function increment()"]};
  const peer={...common,id:"peer",contract:"EventSource",role:"auxiliary",arguments:[],functions:["function emitCount(address,uint256)"]};
  const steps:ContractCheckStep[]=(["trader-a","trader-b"] as const).flatMap((from,index)=>[
    {id:`increment-${index}`,contract:"counter",signature:"increment()",arguments:[],from,afterSeconds:0,value:"0",read:false,requirementIds:["counter"],
      expect:{status:"success",events:[{contract:"counter",signature,arguments:[{account:from},String(index+1)]}]}},
    {id:`read-${index}`,contract:"counter",signature:"count()",arguments:[],from,afterSeconds:0,value:"0",read:true,requirementIds:["counter"],expect:{status:"success",returns:[String(index+1)]}},
  ]);
  return {contracts:nested?[main]:[peer,main],...(nested?{constructorChildren:[{...peer,parent:"counter",creation:"create",nonce:"1",value:"0"}]}:{}),
    allowedCalls:[{contract:"peer"}],steps};
}
function source(body:string,nested=false,event=signature.replace(/^event /,"")) {
  return `pragma solidity 0.8.26;
contract EventSource { event SwapCounted(address indexed sender,uint256 count); function emitCount(address sender,uint256 value) external {emit SwapCounted(sender,value);} }
contract Counter { uint256 public count; EventSource public immutable peer; event ${event};
${nested?"constructor(){peer=new EventSource();}":"constructor(EventSource p){peer=p;}"}
function increment() external {count++;${body}}
}`;
}
function project(content:string,blueprint:ReturnType<typeof createGeneralCheckBlueprint>) {
  return createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},
    sources:{"Counter.sol":{content}},entrypoints:blueprint.entrypoints},intent,999);
}

describe("independent event declarations",()=>{
  it("hashes the expected emitter, indexed layout and values before source exists",()=>{
    const raw=declaration(),blueprint=createGeneralCheckBlueprint(raw,intent,999,"cancun");
    for(const edit of [
      (item:NonNullable<ContractCheckStep["expect"]["events"]>[number])=>{item.contract="peer";},
      (item:NonNullable<ContractCheckStep["expect"]["events"]>[number])=>{item.arguments[1]="99";},
      (item:NonNullable<ContractCheckStep["expect"]["events"]>[number])=>{item.signature="event SwapCounted(address sender,uint256 indexed count)";},
    ]) {const changed=structuredClone(raw);edit(changed.steps[0].expect.events![0]);expect(createGeneralCheckBlueprint(changed,intent,999,"cancun").id).not.toBe(blueprint.id);}
  });
  it("preserves the legacy canonical plan when no events were declared",()=>{
    const raw=declaration();for(const step of raw.steps)delete step.expect.events;
    const blueprint=createGeneralCheckBlueprint(raw,intent,999,"cancun"),p=project(source(""),blueprint),plan=bindGeneralCheckBlueprint(blueprint,p);
    const legacy={version:1,projectHash:p.hash,intentRevision:intent.revision,contracts:blueprint.scenarios.contracts,allowedCalls:blueprint.scenarios.allowedCalls,steps:raw.steps};
    expect(plan.id).toBe(canonicalBrowserSha256V2("programmable.general-declared-checks.v1",legacy));
    expect(plan.steps.every(step=>!Object.hasOwn(step.expect,"events"))).toBe(true);
  });
  it("counts real event assertions as observations, but not a bare successful call",()=>{
    const raw=declaration();raw.steps=raw.steps.filter(step=>!step.read);
    expect(()=>createGeneralCheckBlueprint(raw,intent,999,"cancun")).not.toThrow();
    for(const step of raw.steps)delete step.expect.events;
    expect(()=>createGeneralCheckBlueprint(raw,intent,999,"cancun")).toThrow();
  });
  it.each([
    {events:[]},
    {events:[{contract:"missing",signature,arguments:[{account:"trader-a"},"1"]}]},
    {events:[{contract:"counter",signature:"function SwapCounted(address,uint256)",arguments:[{account:"trader-a"},"1"]}]},
    {events:[{contract:"counter",signature,arguments:["1"]}]},
    {events:[{contract:"counter",signature:"event Bad(uint256[] indexed items)",arguments:[["1"]]}]},
    {events:[{contract:"counter",signature:"event Bad(address indexed a,address indexed b,address indexed c,address indexed d)",arguments:["0","0","0","0"]}]},
  ])("rejects malformed or unsupported event examples before execution (%#)",patch=>{
    const raw=declaration();Object.assign(raw.steps[0].expect,patch);expect(()=>createGeneralCheckBlueprint(raw,intent,999,"cancun")).toThrow();
  });
  it("rejects event assertions on reads and reverts",()=>{
    for(const patch of [{read:true},{expect:{status:"revert",events:declaration().steps[0].expect.events}}]) {
      const raw=declaration();Object.assign(raw.steps[0],patch);expect(()=>createGeneralCheckBlueprint(raw,intent,999,"cancun")).toThrow();
    }
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("actual compiled event logs",{timeout:60_000},()=>{
  async function report(body:string,nested=false,raw=declaration(nested),event?:string) {
    const blueprint=createGeneralCheckBlueprint(raw,intent,999,"cancun"),p=project(source(body,nested,event),blueprint);
    return checkGeneralScenarios(p,await compileContractProject(p),bindGeneralCheckBlueprint(blueprint,p));
  }
  it.each([false,true])("checks actual emitters, callers and counts in worker V2=%s",async nested=>{
    const actual=await report("emit SwapCounted(msg.sender,count);",nested);
    expect(actual).toMatchObject({version:nested?2:1,passed:true,cases:8,launchReady:false,failures:[]});
    const events=actual.execution?.steps.flatMap(step=>step.events)??[];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({contract:"counter",name:"SwapCounted",arguments:[{name:"sender"},{name:"count",value:"1"}]});
  });
  it.each([
    ["missing","",undefined],
    ["wrong sender","emit SwapCounted(address(0),count);",undefined],
    ["wrong value","emit SwapCounted(msg.sender,count+1);",undefined],
    ["duplicate","emit SwapCounted(msg.sender,count);emit SwapCounted(msg.sender,count);",undefined],
    ["wrong emitter","peer.emitCount(msg.sender,count);",undefined],
    ["wrong indexed layout","emit SwapCounted(msg.sender,count);","SwapCounted(address sender,uint256 indexed count)"],
  ])("rejects %s emission even when the counter and interface are correct",async (_label,body,event)=>{
    for(const nested of [false,true]) {
      const actual=await report(body!,nested,declaration(nested),event);
      expect(actual.passed).toBe(false);expect(actual.failures[0].code).toBe("event-log");expect(actual.launchReady).toBe(false);
    }
  });
  it("checks order and count across repeated event signatures",async()=>{
    const raw=declaration();for(const [index,step] of raw.steps.filter(step=>!step.read).entries())step.expect.events!.push({contract:"counter",signature,arguments:[{account:step.from},String(index+101)]});
    expect((await report("emit SwapCounted(msg.sender,count);emit SwapCounted(msg.sender,count+100);",false,raw)).passed).toBe(true);
    expect((await report("emit SwapCounted(msg.sender,count+100);emit SwapCounted(msg.sender,count);",false,raw)).failures[0].code).toBe("event-log");
  });
  it("supports indexed dynamic hashes and non-indexed arrays, ignoring unrelated events",async()=>{
    const raw=declaration();for(const step of raw.steps.filter(step=>!step.read))step.expect.events=[{contract:"counter",signature:"event Tagged(string indexed tag,bytes payload,uint256[] values)",arguments:["swap","0x1234",["1","2"]]}];
    const body='uint256[] memory values=new uint256[](2);values[0]=1;values[1]=2;emit SwapCounted(msg.sender,count);emit Tagged("swap",hex"1234",values);';
    const blueprint=createGeneralCheckBlueprint(raw,intent,999,"cancun");
    const p=project(source(body).replace("event SwapCounted(address indexed sender,uint256 count);\n", "event SwapCounted(address indexed sender,uint256 count);event Tagged(string indexed tag,bytes payload,uint256[] values);\n"),blueprint);
    expect((await checkGeneralScenarios(p,await compileContractProject(p),bindGeneralCheckBlueprint(blueprint,p))).passed).toBe(true);
  });
});
