import {it,expect} from "vitest";
import {parseAbi} from "viem";
import {sourceCorrectionFeedback} from "../lib/custom-ai/source-feedback";
import type {GeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import type {CompiledProject} from "../lib/custom-ai/contract-project.server";
import type {GeneralScenarioReport} from "../lib/custom-ai/behavior-checks.server";

it("identifies exact unwanted powers and missing functions without changing a failed check",()=>{
  const blueprint={scenarios:{contracts:[{id:"token",source:"Token.sol",contract:"Token",functions:["function balanceOf(address) view returns(uint256)","function burn(uint256)"]}]}} as unknown as GeneralCheckBlueprint;
  const compilation={contracts:[{source:"Token.sol",contract:"Token",abi:parseAbi(["function balanceOf(address) view returns(uint256)","function seize(address)"])}]} as unknown as CompiledProject;
  const failure={caseId:"surface:token",code:"unexpected-interface",message:"Interface mismatch."};
  const result=sourceCorrectionFeedback(blueprint,compilation,[failure]);
  expect(result[0]).toMatchObject({caseId:failure.caseId,code:failure.code});
  expect(result[0].message).toContain("burn(uint256)");expect(result[0].message).toContain("seize(address)");
  expect(result[0].message).not.toContain("balanceOf");expect(failure.message).toBe("Interface mismatch.");
});

it("keeps return types and mutability significant and leaves other failures alone",()=>{
  const blueprint={scenarios:{contracts:[{id:"hook",source:"Hook.sol",contract:"Hook",functions:["function count() view returns(uint256)"]}]}} as unknown as GeneralCheckBlueprint;
  const compilation={contracts:[{source:"Hook.sol",contract:"Hook",abi:parseAbi(["function count() pure returns(bool)"])}]} as unknown as CompiledProject;
  const other={caseId:"step:1",code:"return-value",message:"Expected one."};
  const result=sourceCorrectionFeedback(blueprint,compilation,[{caseId:"surface:hook",code:"unexpected-interface",message:"Mismatch"},other]);
  expect(result[0].message).toContain("view -> returns(uint256)");expect(result[0].message).toContain("pure -> returns(bool)");
  expect(result[1]).toBe(other);
});

it("passes the actual failed call and expected value to the repair without mutating evidence",()=>{
  const step={id:"position-owner",contract:"hook",signature:"liquidityPositionOwner()",from:"creator",afterSeconds:3600,value:"0",read:true,
    expect:{status:"success",returns:[{contract:"liquidity-vault"}]}};
  const blueprint={scenarios:{contracts:[],steps:[step]}} as unknown as GeneralCheckBlueprint;
  const execution={steps:[{...step,status:"success",outputs:[{name:"owner",type:"address",value:"0x1000000000000000000000000000000000000001",truncated:false}],nativeChanges:[],detailsComplete:true}]} as unknown as GeneralScenarioReport["execution"];
  const failure={caseId:step.id,code:"return-value",message:"The declared return value did not match."};
  const before=JSON.stringify({blueprint,execution,failure});
  const result=sourceCorrectionFeedback(blueprint,{contracts:[]} as unknown as CompiledProject,[failure],execution);
  expect(result[0]).toMatchObject({caseId:step.id,code:failure.code});
  expect(result[0].message).toContain("liquidityPositionOwner()");
  expect(result[0].message).toContain("liquidity-vault");
  expect(result[0].message).toContain("0x1000000000000000000000000000000000000001");
  expect(JSON.stringify({blueprint,execution,failure})).toBe(before);
  const unrelated={...execution!,steps:[{...execution!.steps[0],afterSeconds:7200}]};
  expect(sourceCorrectionFeedback(blueprint,{contracts:[]} as unknown as CompiledProject,[failure],unrelated)[0]).toBe(failure);
});

it("keeps fee quote booleans and amount available when diagnosing a return mismatch",()=>{
  const step={id:"quote-buy-fees",contract:"hook",signature:"quoteFees(uint256,bool,bool)",arguments:["1000000000000000000",true,false],
    from:"trader-a",afterSeconds:400,value:"0",read:true,expect:{status:"success",returns:["3000000000000000","17000000000000000","20000000000000000"]}};
  const blueprint={scenarios:{contracts:[],steps:[step]}} as unknown as GeneralCheckBlueprint;
  const execution={steps:[{...step,status:"success",outputs:[{name:"gross",type:"uint256",value:"1020408163265306123",truncated:false}],nativeChanges:[],detailsComplete:true}]} as unknown as GeneralScenarioReport["execution"];
  const failure={caseId:step.id,code:"return-value",message:"The declared return value did not match."};
  const original=JSON.stringify({blueprint,execution,failure});
  const [feedback]=sourceCorrectionFeedback(blueprint,{contracts:[]} as unknown as CompiledProject,[failure],execution);
  expect(feedback.message).toContain('"arguments":["1000000000000000000",true,false]');
  expect(feedback.message).toContain('"value":"1020408163265306123"');
  expect(JSON.stringify({blueprint,execution,failure})).toBe(original);
});
