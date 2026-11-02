import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {graphStageSchema,graphSchemaForConstraints,interfaceStageSchema,scenarioStageSchema,nativeGraphDeclaration,nativeInterfaceMap,nativeScenarioRows,nativeDeployment,nativeFullDeclaration,correctionStageSchema,scenarioSchemaForInterface} from "../lib/custom-ai/check-stage-wire";
import {prepareSurplusSchema} from "../lib/custom-ai/surplus-schema.server";
import {createGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {declareGeneralChecks} from "../lib/custom-ai/check-declaration.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import {ModelResponseError} from "../lib/custom-ai/model-response";

const intent:LaunchIntent={version:1,id:"native-counter",revision:"a".repeat(64),unresolved:[],changes:[],requirements:[
  {id:"count",text:"Increment a counter and emit its new value",kind:"behavior",open:null,origin:{kind:"legacy"}},
  {id:"surface",text:"No owner privileges",kind:"constraint",open:null,origin:{kind:"legacy"}},
]};
const graph={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",argumentsJson:"[]",allowReceive:false,allowFallback:false,surfaceRequirements:["surface"],value:null}],
  constructorChildren:[],allowedCallsJson:"[]",world:{kind:"none",token:"",hook:"",initializer:"",hookPermissions:0,fee:0,tickSpacing:0,sqrtPriceX96:"0",nativeUsdAnswer:"0"},compilerProfile:"preserve"};
const functions=["function increment()","function count() view returns(uint256)"];
const interfaces={interfaces:[{id:"main",canonical:null,functions}],deploymentJson:"null"};
const steps=[{id:"increment",contract:"main",signature:"increment()",argumentsJson:"[]",from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:["count"],
  expect:{status:"success",returnsJson:null,swapFeePpm:null,events:[{contract:"main",signature:"event Counted(uint256 count)",argumentsJson:'["1"]'}]}},
{id:"read",contract:"main",signature:"count()",argumentsJson:"[]",from:"trader-b",afterSeconds:10,value:"0",read:true,requirementIds:["count"],
  expect:{status:"success",returnsJson:'["1"]',swapFeePpm:null,events:[]}}];
const response=(value:unknown)=>({text:JSON.stringify(value),inputTokens:1,outputTokens:1});
describe("native independent declaration transport",()=>{
  it("round-trips native arrays and numeric fields through the actual provider schema adapter",()=>{
    for(const [schema,value] of [[graphStageSchema,graph],[interfaceStageSchema,interfaces],[scenarioStageSchema,{steps,complete:true}]] as const){
      const transport=prepareSurplusSchema(schema);
      expect(JSON.parse(transport.decode(JSON.stringify(value)))).toEqual(value);
    }
    const typed=structuredClone(graph) as unknown as {world:{hookPermissions:unknown}};typed.world.hookPermissions="204";
    expect(()=>prepareSurplusSchema(graphStageSchema).decode(JSON.stringify(typed))).toThrow();
  });
  it("only permits actual constraints in interface coverage, leaving behavior proof to scenarios",()=>{
    const format=prepareSurplusSchema(graphSchemaForConstraints(["surface"]));
    expect(JSON.parse(format.decode(JSON.stringify(graph)))).toEqual(graph);
    const invalid=structuredClone(graph);invalid.contracts[0].surfaceRequirements=["count"];
    expect(()=>format.decode(JSON.stringify(invalid))).toThrow();
    const empty=structuredClone(graph);empty.contracts[0].surfaceRequirements=[];
    expect(JSON.parse(prepareSurplusSchema(graphSchemaForConstraints([])).decode(JSON.stringify(empty)))).toEqual(empty);
  });
  it("expands native stages to the identical independently validated plan",()=>{
    const proposal=nativeGraphDeclaration(graph),methods=nativeInterfaceMap({interfaces:interfaces.interfaces});
    (proposal.contracts as Record<string,unknown>[])[0].functions=methods.main;
    const native={...proposal,steps:nativeScenarioRows(steps)};
    const canonical={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",role:"auxiliary",arguments:[],functions,allowReceive:false,allowFallback:false,surfaceRequirements:["surface"]}],
      allowedCalls:[],steps:[{id:"increment",contract:"main",signature:"increment()",arguments:[],from:"trader-a",afterSeconds:0,value:"0",read:false,requirementIds:["count"],
        expect:{status:"success",events:[{contract:"main",signature:"event Counted(uint256 count)",arguments:["1"]}]}},
      {id:"read",contract:"main",signature:"count()",arguments:[],from:"trader-b",afterSeconds:10,value:"0",read:true,requirementIds:["count"],expect:{status:"success",returns:["1"]}}]};
    expect(createGeneralCheckBlueprint(native,intent,8453,"cancun")).toEqual(createGeneralCheckBlueprint(canonical,intent,8453,"cancun"));
  });
  it("runs graph, public ABI and scenarios without any full-response JSON string field",async()=>{
    const call=vi.fn().mockResolvedValueOnce(response(graph)).mockResolvedValueOnce(response(interfaces)).mockResolvedValueOnce(response({steps,complete:true}));
    const result=await declareGeneralChecks({intent,chainId:8453,evmVersion:"cancun",model:"test-model"},call);
    expect(result.scenarios.steps).toHaveLength(2);expect(result.intentRevision).toBe(intent.revision);
    expect(call.mock.calls.map(([request])=>request.task)).toEqual(["interface","interface-abi","scenarios"]);
    expect(call.mock.calls[0][0].schema.properties.contracts.type).toBe("array");
    expect(call.mock.calls[1][0].schema.properties.interfaces.type).toBe("array");
    expect(call.mock.calls[2][0].schema.properties.steps.type).toBe("array");
  });
  it("reuses the completed graph after an interrupted public-interface response",async()=>{
    const first=vi.fn().mockResolvedValueOnce(response(graph)).mockRejectedValueOnce(new ModelResponseError("output-limit",{inputTokens:3,outputTokens:4}));
    const error=await declareGeneralChecks({intent,chainId:8453,evmVersion:"cancun",model:"test-model"},first).catch(error=>error);
    expect(error.diagnostic.progress.interfacesPending).toBe(true);
    const resumed=vi.fn().mockResolvedValueOnce(response(interfaces)).mockResolvedValueOnce(response({steps,complete:true}));
    const result=await declareGeneralChecks({intent,chainId:8453,evmVersion:"cancun",model:"test-model",rejected:error.diagnostic},resumed);
    expect(result.scenarios.steps).toHaveLength(2);
    expect(resumed.mock.calls.map(([request])=>request.task)).toEqual(["interface-abi","scenarios"]);
  });
  it("keeps complete coverage checks after native expansion",async()=>{
    const invalid=structuredClone(graph);invalid.contracts[0].surfaceRequirements=[];
    const call=vi.fn().mockResolvedValueOnce(response(invalid)).mockResolvedValueOnce(response(interfaces)).mockResolvedValueOnce(response({steps,complete:true}))
      .mockResolvedValueOnce(response({generalChecks:'{"contracts":[]}'}));
    const error=await declareGeneralChecks({intent,chainId:8453,evmVersion:"cancun",model:"test-model"},call).catch(error=>error);
    expect(error.reason).toBe("correction-rejected");expect(call.mock.calls[3][0].system).toContain("missing-requirements:surface");
  });
  it("rejects duplicate interface identities and hidden or malformed value fields",()=>{
    expect(()=>nativeInterfaceMap({interfaces:[interfaces.interfaces[0],interfaces.interfaces[0]]})).toThrow("duplicate");
    expect(()=>nativeGraphDeclaration({...graph,command:"execute"})).toThrow();
    expect(()=>nativeGraphDeclaration({...graph,world:{...graph.world,token:"main"}})).toThrow("absent world");
    expect(()=>nativeScenarioRows([{...steps[0],argumentsJson:'{"not":"array"}'}])).toThrow("array");
    expect(()=>nativeScenarioRows([{...steps[0],expect:{...steps[0].expect,hidden:true}}])).toThrow();
  });
  it("normalizes function declaration spelling without changing the called signature",()=>{
    const rows=nativeScenarioRows([{...steps[1],signature:"function count() view returns(uint256)"}]) as {signature:string}[];
    expect(rows[0].signature).toBe("count()");
    expect(nativeScenarioRows([{...steps[1],argumentsJson:""}])).toEqual(nativeScenarioRows([steps[1]]));
    expect(()=>nativeScenarioRows([{...steps[1],signature:"balanceOf(address)",argumentsJson:""}])).toThrow();
    expect(()=>nativeScenarioRows([{...steps[1],signature:"event Counted(uint256 count)"}])).toThrow();
  });
  it("rejects calls that are absent from the agreed interface before source generation",()=>{
    const full={...graph,...interfaces,steps:[{...steps[0],signature:"inventedSwap()"},steps[1]]};
    expect(()=>createGeneralCheckBlueprint(nativeFullDeclaration(full),intent,8453,"cancun")).toThrow("absent from the declared interface");
    const badReturns={...graph,...interfaces,steps:[steps[0],{...steps[1],expect:{...steps[1].expect,returnsJson:'["1","2"]'}}]};
    expect(()=>createGeneralCheckBlueprint(nativeFullDeclaration(badReturns),intent,8453,"cancun")).toThrow("expected 1 return values");
  });
  it("admits only real contract/function pairs and expands them without changing arguments",()=>{
    const plan={contracts:[{id:"main",functions}],world:{kind:"v4-protected-native-token-v1"}};
    const schema=scenarioSchemaForInterface(plan),transport=prepareSurplusSchema(schema);
    const {contract,signature,...step}=steps[0],wire=[step.id,`${contract}:${signature}`,step.argumentsJson,step.from,step.afterSeconds,step.value,step.read,step.requirementIds,step.expect];
    expect(nativeScenarioRows([wire])).toEqual(nativeScenarioRows([steps[0]]));
    expect(JSON.parse(transport.decode(JSON.stringify({steps:[wire],complete:false})))).toEqual({steps:[wire],complete:false});
    expect(()=>transport.decode(JSON.stringify({steps:[[wire[0],"main:swapCount()",...wire.slice(2)]],complete:false}))).toThrow();
    expect(schema.properties.steps.items.items[1].enum).toContain("v4-router:nativeBalance(address)");
    expect(schema.properties.steps.items.items[1].enum).not.toContain("main:nativeBalance(address)");
  });
  it("keeps a native correction subject to the same complete validation",()=>{
    const full={...graph,...interfaces,steps};
    expect(JSON.parse(prepareSurplusSchema(correctionStageSchema(["surface"])).decode(JSON.stringify(full)))).toEqual(full);
    expect(createGeneralCheckBlueprint(nativeFullDeclaration(full),intent,8453,"cancun").scenarios.steps).toHaveLength(2);
    expect(()=>nativeFullDeclaration({...full,interfaces:[]})).toThrow("interface");
  });
  it("compresses only deployment identities and topology without inheriting local values",()=>{
    const local={contracts:[{id:"main",source:"Counter.sol",contract:"Counter",arguments:[{account:"creator"}]}],
      constructorChildren:[{id:"child",source:"Child.sol",contract:"Child",parent:"main",creation:"create",nonce:"1",arguments:[{contract:"main"}]}]};
    const wire={format:"fixture-refs-v1",targets:[{id:"main",arguments:[{input:"controller"}],initializer:null,deploymentValue:"0",initializerValue:"0",hookPermissions:null}],
      constructorChildren:[{id:"child",arguments:[{target:"main"}],value:"0"}],pool:{token:"token",hook:"main",initializer:"liquidity",platformFeeBinding:"main",fee:0,tickSpacing:60}};
    const expanded=nativeDeployment(JSON.stringify(wire),local) as {targets:unknown[];constructorChildren:unknown[]};
    expect(expanded.targets).toEqual([{id:"main",source:"Counter.sol",contract:"Counter",constructorArguments:[{input:"controller"}],initializer:null,deploymentValue:"0",initializerValue:"0",hookPermissions:null}]);
    expect(expanded.constructorChildren).toEqual([{id:"child",source:"Child.sol",contract:"Child",parent:"main",creation:"create",nonce:"1",constructorArguments:[{target:"main"}],value:"0"}]);
    expect(JSON.stringify(expanded)).not.toContain("account");
    expect(nativeDeployment(JSON.stringify({...wire,targets:[{...wire.targets[0],source:"Counter.sol",contract:"Counter"}]}),local)).toEqual(expanded);
    expect(()=>nativeDeployment(JSON.stringify({...wire,targets:[{...wire.targets[0],id:"unknown"}]}),local)).toThrow("identity");
    expect(()=>nativeDeployment(JSON.stringify({...wire,targets:[{...wire.targets[0],source:"Other.sol"}]}),local)).toThrow();
  });
});
