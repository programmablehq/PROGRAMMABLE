import {platformContract,platformContractBlueprint} from "../../lib/custom-ai/platform/contract-plan.server";
import {compileContractProject} from "../../lib/custom-ai/contract-project.server";
import {bindGeneralCheckBlueprint} from "../../lib/custom-ai/check-blueprint";
import {checkGeneralScenarios} from "../../lib/custom-ai/behavior-checks.server";
import {auditGeneralSource} from "../../lib/custom-ai/source-audit.server";
import {sourceAuditModelReply} from "./custom-ai-source-audit";
import type {ProjectRevision} from "../../lib/custom-ai/platform/types";
export const platformContractDocument={title:"Counter",files:{"Counter.sol":"pragma solidity 0.8.26; contract Counter { uint public value; }"},requirements:[{id:"zero",text:"The value starts at zero",kind:"behavior" as const,open:null,origin:{kind:"legacy" as const}}],dependencies:{},architecture:{kind:"contract",chainId:1,contractChecks:{contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function value() view returns (uint256)"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],steps:[{id:"zero",contract:"main",signature:"value()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["zero"],expect:{status:"success",returns:["0"]}}]}}};
/** Real compiler/EVM, explicitly simulated inference for storage/adapter tests. */
export async function checkedPlatformFixture(revision:ProjectRevision){
 const project=platformContract(revision),blueprint=platformContractBlueprint(revision),compilation=await compileContractProject(project);
 const scenarios=await checkGeneralScenarios(project,compilation,bindGeneralCheckBlueprint(blueprint,project));
 const audit=await auditGeneralSource(project,undefined,{call:async()=>sourceAuditModelReply(project)});
 return {project,blueprint,compilation,scenarios,audit};
}
