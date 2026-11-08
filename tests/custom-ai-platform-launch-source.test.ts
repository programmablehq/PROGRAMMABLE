import {it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {checkedPlatformLaunchSource} from "../lib/custom-ai/platform/launch-source.server";
import {platformContract,platformContractBlueprint} from "../lib/custom-ai/platform/contract-plan.server";
import {projectHash} from "../lib/custom-ai/platform/document";
import {compileContractProject} from "../lib/custom-ai/contract-project.server";
import {bindGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {checkGeneralScenarios} from "../lib/custom-ai/behavior-checks.server";
import {auditGeneralSource} from "../lib/custom-ai/source-audit.server";
import {sourceAuditModelReply} from "./fixtures/custom-ai-source-audit";
import type {ProjectRevision} from "../lib/custom-ai/platform/types";

it("adapts only exact verified source to the existing launch authority and rejects stale or altered proof",async()=>{
 vi.stubEnv("CUSTOM_AI_PROVIDER","surplus");
 try{
  const requirements=[{id:"zero",text:"The value starts at zero",kind:"behavior" as const,open:null,origin:{kind:"legacy" as const}}];
  const contractChecks={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions:["function value() view returns (uint256)"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],steps:[{id:"zero",contract:"main",signature:"value()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:true,requirementIds:["zero"],expect:{status:"success",returns:["0"]}}]};
  const document={title:"Counter",files:{"Counter.sol":"pragma solidity 0.8.26; contract Counter { uint public value; }"},requirements,dependencies:{},architecture:{kind:"contract",chainId:1,contractChecks}};
  const revision:ProjectRevision={ownerId:"alice",projectId:"11111111-1111-4111-8111-111111111111",revisionId:projectHash(document),parentRevisionId:null,ordinal:1,createdAt:new Date(0).toISOString(),requirementsHash:projectHash(requirements),fileTreeHash:projectHash(document.files),dependencyLockHash:projectHash({}),architectureHash:projectHash(document.architecture),document};
  const project=platformContract(revision),compilation=await compileContractProject(project),scenarios=await checkGeneralScenarios(project,compilation,bindGeneralCheckBlueprint(platformContractBlueprint(revision),project));
  // This isolates bridge validation. Live model review remains a separate acceptance case.
  const audit=await auditGeneralSource(project,undefined,{call:async()=>sourceAuditModelReply(project)});
  const draft={revision:1,sourceRevision:revision.revisionId,account:`0x${"a".repeat(40)}`,settings:{name:"Counter",symbol:"CNT",chainId:1 as const,pairToken:"ETH",initialBuy:"0.01"}};
  const input={revision,draft,compilation,scenarios,audit},source=checkedPlatformLaunchSource(input);
  expect(source.project.hash).toBe(project.hash);expect(source.launchReady).toBe(false);expect(source.binding.account).toBe(draft.account);
  expect(()=>checkedPlatformLaunchSource({...input,draft:{...draft,sourceRevision:`sha256:${"0".repeat(64)}`}})).toThrow();
  expect(()=>checkedPlatformLaunchSource({...input,compilation:{...compilation,artifactHash:`sha256:${"0".repeat(64)}`}})).toThrow();
  expect(()=>checkedPlatformLaunchSource({...input,audit:{...audit,status:"changes_required"}})).toThrow();
 }finally{vi.unstubAllEnvs();}
},60000);
