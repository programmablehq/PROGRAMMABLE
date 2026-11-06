import { describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { createProductBlueprint } from "../lib/custom-ai/product/blueprint";
import { checkedProductBindings } from "../lib/custom-ai/product/bindings";
import { createProductImplementation } from "../lib/custom-ai/product/implementation.server";
import { cachedProductImplementation } from "../lib/custom-ai/product/implementation";
import { createGeneralCheckBlueprint, bindGeneralCheckBlueprint, checkedGeneralCheckBlueprint } from "../lib/custom-ai/check-blueprint";
import { createContractProject, GENERAL_PROJECT_COMPILER } from "../lib/custom-ai/contract-project";
import { compileContractProject } from "../lib/custom-ai/contract-project.server";
import { checkGeneralScenarios } from "../lib/custom-ai/behavior-checks.server";
import type { LaunchIntent } from "../lib/custom-ai/launch-intent";
import { interfaceSchemaForGraph } from "../lib/custom-ai/check-stage-wire";
import { declareGeneralChecks } from "../lib/custom-ai/check-declaration.server";
import { prepareSurplusSchema } from "../lib/custom-ai/surplus-schema.server";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

const intent:LaunchIntent={version:1,id:"product-vault",revision:"a".repeat(64),changes:[],unresolved:[],requirements:[
  {id:"deposit",text:"A wallet deposits native currency into its vault balance",kind:"behavior",open:null,origin:{kind:"legacy"}},
  {id:"claim",text:"A wallet claims its own deposited balance",kind:"behavior",open:null,origin:{kind:"legacy"}},
  {id:"inspect",text:"A wallet can read its balance",kind:"behavior",open:null,origin:{kind:"legacy"}},
]};
const product=createProductBlueprint({components:[{id:"vault",name:"Deposit vault",kind:"vault",purpose:"Hold and return wallet deposits",requirementIds:["deposit","claim","inspect"],dependsOn:[]}],assets:[],flows:[],services:[],interfaceActions:[
  {id:"deposit-funds",target:"vault",kind:"deposit",requirementIds:["deposit"]},
  {id:"claim-funds",target:"vault",kind:"claim",requirementIds:["claim"]},
  {id:"inspect-balance",target:"vault",kind:"inspect",requirementIds:["inspect"]},
]},intent,999);
const bindings={version:1 as const,components:[{component:"vault",contract:"vault"}],actions:[
  {action:"deposit-funds",contract:"vault",signature:"deposit()"},
  {action:"claim-funds",contract:"vault",signature:"claim()"},
  {action:"inspect-balance",contract:"vault",signature:"balances(address)"},
]};
const steps=[
  {id:"initial",signature:"balances(address)",arguments:[{account:"trader-a"}],read:true,requirementIds:["inspect"],expect:{status:"success",returns:["0"]}},
  {id:"deposit",signature:"deposit()",arguments:[],value:"1000",read:false,requirementIds:["deposit"],expect:{status:"success"}},
  {id:"funded",signature:"balances(address)",arguments:[{account:"trader-a"}],read:true,requirementIds:["deposit"],expect:{status:"success",returns:["1000"]}},
  {id:"claim",signature:"claim()",arguments:[],read:false,requirementIds:["claim"],expect:{status:"success"}},
  {id:"claimed",signature:"balances(address)",arguments:[{account:"trader-a"}],read:true,requirementIds:["claim","inspect"],expect:{status:"success",returns:["0"]}},
].map(step=>({contract:"vault",from:"trader-a",afterSeconds:0,value:"0",...step}));
const declaration={contracts:[{id:"vault",source:"Vault.sol",contract:"Vault",role:"auxiliary",arguments:[],functions:["function deposit() payable","function claim()","function balances(address) view returns(uint256)"],allowReceive:false,allowFallback:false,surfaceRequirements:[]}],allowedCalls:[{account:"trader-a"}],steps,productBindings:bindings};
const blueprint=createGeneralCheckBlueprint(declaration,intent,999,"cancun",undefined,undefined,product.id);

describe("product actions bound to independently declared contract functions",()=>{
  it("returns bindings in the existing interface stage without another model call",async()=>{
    const graph={contracts:declaration.contracts.map(({arguments:args,functions,...contract})=>{void functions;return {...contract,argumentsJson:JSON.stringify(args),value:null};}),constructorChildren:[],
      allowedCallsJson:JSON.stringify(declaration.allowedCalls),world:{kind:"none",token:"",hook:"",initializer:"",hookPermissions:0,fee:0,tickSpacing:0,sqrtPriceX96:"0",nativeUsdAnswer:"0"},compilerProfile:"preserve"};
    const envelope={interfaces:[{id:"vault",canonical:null,functions:declaration.contracts[0].functions}],deployment:null,productBindings:bindings};
    const nativeSteps=steps.map(step=>({...step,argumentsJson:JSON.stringify(step.arguments),arguments:undefined,
      expect:{status:step.expect.status,returnsJson:"returns" in step.expect?JSON.stringify(step.expect.returns):null,swapFeePpm:null,events:[]}}));
    const response=(data:unknown)=>({text:JSON.stringify(data),inputTokens:1,outputTokens:1});
    const call=vi.fn().mockResolvedValueOnce(response(graph)).mockResolvedValueOnce(response(envelope)).mockResolvedValueOnce(response({steps:nativeSteps,complete:true}));
    const result=await declareGeneralChecks({intent,chainId:999,evmVersion:"cancun",model:"test",productBlueprint:product},call);
    expect(result.productBindings).toEqual(bindings);
    expect(call.mock.calls.map(([input])=>input.task)).toEqual(["interface","interface-abi","scenarios"]);
    expect(JSON.parse(prepareSurplusSchema(call.mock.calls[1][0].schema).decode(JSON.stringify(envelope)))).toEqual(envelope);
  });
  it("retains bindings in the immutable declaration and validates the full product mapping",()=>{
    expect(checkedGeneralCheckBlueprint(blueprint,intent).id).toBe(blueprint.id);
    expect(checkedProductBindings(bindings,blueprint.scenarios,blueprint.entrypoints,product)).toEqual(bindings);
    const schema=interfaceSchemaForGraph({contracts:declaration.contracts},false,product);
    expect(schema.required).toContain("productBindings");
    expect(interfaceSchemaForGraph({contracts:declaration.contracts},false).required).not.toContain("productBindings");
  });
  it("normalizes complete function declarations to the same checked action bindings",()=>{
    const verbose={...bindings,actions:bindings.actions.map((action,index)=>({...action,signature:declaration.contracts[0].functions[index]}))};
    expect(checkedProductBindings(verbose,blueprint.scenarios,blueprint.entrypoints,product)).toEqual(bindings);
    const normalized=createGeneralCheckBlueprint({...declaration,productBindings:verbose},intent,999,"cancun",undefined,undefined,product.id);
    expect(normalized.id).toBe(blueprint.id);
    expect(normalized.productBindings).toEqual(bindings);
  });
  it("rejects an invented method, missing action, wrong component and read/write substitution",()=>{
    for(const edit of [
      (b:typeof bindings)=>{b.actions[1].signature="steal()";},
      (b:typeof bindings)=>{b.actions.pop();},
      (b:typeof bindings)=>{b.components[0].component="other";},
      (b:typeof bindings)=>{b.actions[1].signature="balances(address)";},
      (b:typeof bindings)=>{b.actions[1].signature="function balances(address) view returns (uint256)";},
      (b:typeof bindings)=>{b.actions[2].signature="function balances(uint256) view returns (uint256)";},
    ]){const b=structuredClone(bindings);edit(b);expect(()=>checkedProductBindings(b,blueprint.scenarios,blueprint.entrypoints,product)).toThrow();}
    const missing={...blueprint.scenarios,steps:blueprint.scenarios.steps.filter(step=>step.id!=="claim")};
    expect(()=>checkedProductBindings(bindings,missing,blueprint.entrypoints,product)).toThrow(/successful example/);
  });
  it("retains an optional onchain adapter without binding offchain services",()=>{
    const adapter={...product,components:product.components.map(component=>({...component,kind:"adapter" as const}))};
    expect(checkedProductBindings(bindings,blueprint.scenarios,blueprint.entrypoints,adapter)).toEqual(bindings);
    expect(checkedProductBindings({version:1,components:[],actions:[]},blueprint.scenarios,blueprint.entrypoints,adapter)).toEqual({version:1,components:[],actions:[]});
  });
});

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("a product interface resolved from actual compiled source",{timeout:60000},()=>{
  it("binds deposit, claim and inspection to the executed vault without declaring it deployed",async()=>{
    const project=createContractProject({compiler:{version:GENERAL_PROJECT_COMPILER,optimizerRuns:1000,viaIR:false,evmVersion:"cancun"},entrypoints:blueprint.entrypoints,
      sources:{"Vault.sol":{content:`pragma solidity 0.8.26; contract Vault { mapping(address=>uint256) public balances; function deposit() external payable { balances[msg.sender]+=msg.value; } function claim() external { uint256 amount=balances[msg.sender];require(amount>0);balances[msg.sender]=0;(bool ok,)=payable(msg.sender).call{value:amount}("");require(ok); } }`}}},intent,999,undefined,undefined,product.id);
    const compilation=await compileContractProject(project),scenarios=await checkGeneralScenarios(project,compilation,bindGeneralCheckBlueprint(blueprint,project));
    expect(scenarios.passed).toBe(true);
    const actual=createProductImplementation(product,blueprint,project,compilation,scenarios)!;
    expect(actual.evidence).toBe("declared-scenarios-passed");expect(actual.deployed).toBe(false);
    expect(actual.actions.map(action=>action.signature)).toEqual(["deposit()","claim()","balances(address)"]);
    expect(cachedProductImplementation(actual,actual)).toEqual(actual);
    expect(cachedProductImplementation(actual,{...actual,productBlueprintId:`sha256:${"f".repeat(64)}`})).toBeUndefined();
    expect(()=>createProductImplementation(product,blueprint,project,compilation,{...scenarios,hash:`sha256:${"f".repeat(64)}`})).toThrow(/evidence/);
    expect(createProductImplementation(product,{...blueprint,productBindings:undefined},project,compilation)).toBeUndefined();
    const {artifactHash,...changed}=structuredClone(compilation);void artifactHash;
    const unsafe=changed.contracts[0].abi.find(fn=>fn.type==="function"&&fn.name==="balances");
    if(unsafe?.type==="function")unsafe.stateMutability="nonpayable";
    expect(createProductImplementation(product,blueprint,project,{...changed,artifactHash:canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1",changed)})).toBeUndefined();
  });
});
