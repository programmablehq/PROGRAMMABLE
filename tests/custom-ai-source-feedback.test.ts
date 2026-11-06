import {it,expect} from "vitest";
import {parseAbi} from "viem";
import {sourceCorrectionFeedback} from "../lib/custom-ai/source-feedback";
import type {GeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import type {CompiledProject} from "../lib/custom-ai/contract-project.server";

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
