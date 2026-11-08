import {describe,expect,it,vi} from "vitest";
import {formatAbi} from "abitype";
import {createContractProject,GENERAL_PROJECT_COMPILER} from "../lib/custom-ai/contract-project";
import {compileContractProject} from "../lib/custom-ai/contract-project.server";
import {createGeneralCheckPlan} from "../lib/custom-ai/behavior-checks";
import {createGeneralCheckBlueprint,bindGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {checkGeneralScenarios} from "../lib/custom-ai/behavior-checks.server";
import library from "../lib/custom-ai/platform/game-events-code.json";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
vi.mock("server-only",()=>({}));

const binding="0x"+"01".repeat(32),playerId="0x"+"02".repeat(32),nonce="0x"+"03".repeat(32),eventId="0x"+"04".repeat(32);
const player={account:"signer-player-a"};
const linkValues=[binding,player,playerId,nonce,"1800000300"];
const eventValues=[binding,eventId,playerId,player,"1","1","1800000000","1800000300"];
const signature=(kind:string,signer:string,values:unknown[],extra={})=>({signature:{kind,signer,contract:"game",values,...extra}});
const intent:LaunchIntent={version:1,id:"signed-game-fixture",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
 {id:"signed-results",kind:"behavior",text:"Only authentic player links and issuer results apply, with replay and domain separation.",open:null,origin:{kind:"legacy"}},
]};
const step=(id:string,signature:string,args:unknown[],status="success",returns?:unknown[])=>({id,contract:"game",signature,arguments:args,from:"signer-player-a",afterSeconds:0,value:"0",read:returns!==undefined,requirementIds:["signed-results"],expect:{status,...(returns?{returns}:{})}});

describe("local signature declaration boundaries",()=>{
 const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},sources:{"Fixture.sol":{content:"pragma solidity 0.8.26; contract Fixture {function check(bytes calldata) external pure returns(bool){return true;}}"}},entrypoints:[{source:"Fixture.sol",contract:"Fixture",role:"auxiliary"}]},intent,4663);
 const declaration=(signed:unknown)=>({contracts:[{id:"game",source:"Fixture.sol",contract:"Fixture",arguments:[],functions:["function check(bytes) pure returns(bool)"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[],steps:[step("check","check(bytes)",[signed],"success",[true])]});
 it("accepts only a declared fixed test actor and canonical typed fields",()=>{
  expect(()=>createGeneralCheckPlan(declaration(signature("wallet-link","signer-player-a",linkValues)),project)).not.toThrow();
  for(const bad of [
   signature("wallet-link","creator",linkValues),
   signature("personal-message","signer-player-a",linkValues),
   signature("wallet-link","signer-player-a",linkValues,{privateKey:"untrusted"}),
   signature("wallet-link","signer-player-a",linkValues,{contract:"missing"}),
   signature("wallet-link","signer-player-a",linkValues,{chainId:0}),
   signature("wallet-link","signer-player-a",[...linkValues.slice(0,4),(2n**64n).toString()]),
   signature("wallet-link","signer-player-a",["not-bytes32",...linkValues.slice(1)]),
  ])expect(()=>createGeneralCheckPlan(declaration(bad),project)).toThrow();
 });
 it("rejects signature requests in deployment arguments or recipient lists",()=>{
  const signed=signature("wallet-link","signer-player-a",linkValues);
  for(const mutate of [
   (raw:ReturnType<typeof declaration>)=>({...raw,allowedCalls:[signed]}),
   (raw:ReturnType<typeof declaration>)=>({...raw,contracts:[{...raw.contracts[0],arguments:[signed]}]}),
  ])expect(()=>createGeneralCheckPlan(mutate(declaration(signed)),project)).toThrow();
 });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("isolated game signature fixtures",{timeout:90000},()=>{
 it.each([1,2])("executes genuine EIP712 recovery, wrong-key/domain rejection and replay protection in worker v%i",async version=>{
  const sources=Object.fromEntries(Object.entries(library.sources).map(([path,file])=>[path,{content:file.content}]));
  const entrypoints=[{source:"src/custom-ai/ProjectPlayerGameEventsV1.sol",contract:"ProjectPlayerGameEventsV1",role:"auxiliary" as const}];
  if(version===2){
   sources["Witness.sol"]={content:"pragma solidity 0.8.26; contract Witness {} contract Parent { constructor(){new Witness();} }"};
   entrypoints.push({source:"Witness.sol",contract:"Parent",role:"auxiliary"},{source:"Witness.sol",contract:"Witness",role:"auxiliary"});
  }
  const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:200,viaIR:true,evmVersion:"cancun"},sources,entrypoints},intent,4663);
  const compiled=await compileContractProject(project);expect(compiled.compiled,JSON.stringify(compiled.diagnostics)).toBe(true);
  const artifact=compiled.contracts.find(c=>c.contract==="ProjectPlayerGameEventsV1")!;
  const common={allowReceive:false,allowFallback:false,surfaceRequirements:[]};
  const declaration={contracts:[{...common,id:"game",source:entrypoints[0].source,contract:entrypoints[0].contract,arguments:[binding,{account:"signer-issuer"},"600","1"],functions:formatAbi(artifact.abi).filter(s=>s.startsWith("function "))},
    ...(version===2?[{...common,id:"parent",source:"Witness.sol",contract:"Parent",arguments:[],functions:[]}]:[])],
   ...(version===2?{constructorChildren:[{...common,id:"witness",source:"Witness.sol",contract:"Witness",parent:"parent",creation:"create",nonce:"1",value:"0",arguments:[],functions:[]}]}:{}),
   allowedCalls:[],steps:[
    step("link","bindPlayer(address,bytes32,bytes32,uint64,bytes,bytes)",[player,playerId,nonce,"1800000300",signature("wallet-link","signer-player-a",linkValues),signature("wallet-link","signer-issuer",linkValues)]),
    step("bound","walletForPlayer(bytes32)",[playerId],"success",[player]),
    step("wrong-key","submitEvent((bytes32,bytes32,bytes32,address,uint64,uint256,uint64,uint64),bytes)",[eventValues,signature("game-event","signer-player-b",eventValues)],"revert"),
    step("wrong-chain","submitEvent((bytes32,bytes32,bytes32,address,uint64,uint256,uint64,uint64),bytes)",[eventValues,signature("game-event","signer-issuer",eventValues,{chainId:1})],"revert"),
    step("no-score","playerScore(address)",[player],"success",["0"]),
    step("win","submitEvent((bytes32,bytes32,bytes32,address,uint64,uint256,uint64,uint64),bytes)",[eventValues,signature("game-event","signer-issuer",eventValues)]),
    step("score","playerScore(address)",[player],"success",["1"]),
    step("replay","submitEvent((bytes32,bytes32,bytes32,address,uint64,uint256,uint64,uint64),bytes)",[eventValues,signature("game-event","signer-issuer",eventValues)],"revert"),
   ]};
  const blueprint=createGeneralCheckBlueprint({...declaration,compilerProfile:"viair-200-v1",
    contracts:declaration.contracts.map(item=>({...item,role:"auxiliary"})),
    ...(version===2?{constructorChildren:declaration.constructorChildren!.map(item=>({...item,role:"auxiliary"}))}:{})},intent,4663,"cancun");
  const plan=bindGeneralCheckBlueprint(blueprint,project);
  const report=await checkGeneralScenarios(project,compiled,plan);
  expect(report).toMatchObject({passed:true,launchReady:false});expect(report.failures).toEqual([]);
  expect(report.execution?.steps).toHaveLength(8);
  expect(report.execution?.networkAccess).toBe(false);
 });
});
