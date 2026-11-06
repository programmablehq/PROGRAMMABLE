import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {graphStageSchema,graphSchemaForConstraints,interfaceStageSchema,interfaceSchemaForGraph,scenarioStageSchema,nativeGraphDeclaration,nativeInterfaceMap,nativeScenarioRows,nativeDeployment,nativeFullDeclaration,correctionStageSchema,scenarioSchemaForInterface} from "../lib/custom-ai/check-stage-wire";
import {checkedCheckDiagnostic,reusableCheckFailure} from "../lib/custom-ai/check-diagnostic";
import {prepareSurplusSchema} from "../lib/custom-ai/surplus-schema.server";
import {createGeneralCheckBlueprint} from "../lib/custom-ai/check-blueprint";
import {declareGeneralChecks} from "../lib/custom-ai/check-declaration.server";
import type {LaunchIntent} from "../lib/custom-ai/launch-intent";
import {ModelResponseError} from "../lib/custom-ai/model-response";
import {projectLaunchProductionContext} from "../lib/custom-ai/launch-production.server";
import captured from "./fixtures/custom-ai-launch-discovery.json";

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
    const call=vi.fn().mockResolvedValueOnce(response(graph)).mockResolvedValueOnce(response({interfaces:interfaces.interfaces,deployment:null})).mockResolvedValueOnce(response({steps,complete:true}));
    const result=await declareGeneralChecks({intent,chainId:8453,evmVersion:"cancun",model:"test-model"},call);
    expect(result.scenarios.steps).toHaveLength(2);expect(result.intentRevision).toBe(intent.revision);
    expect(call.mock.calls.map(([request])=>request.task)).toEqual(["interface","interface-abi","scenarios"]);
    expect(call.mock.calls[0][0].schema.properties.contracts.type).toBe("array");
    expect(call.mock.calls[1][0].schema.properties.interfaces.type).toBe("array");
    expect(call.mock.calls[1][0].schema.properties.deployment.type).toBe("null");
    expect(call.mock.calls[1][0].schema.properties).not.toHaveProperty("deploymentJson");
    expect(call.mock.calls[2][0].schema.properties.steps.type).toBe("array");
  });
  it("declares a small graph's interfaces and production values once and preserves them on interruption",async()=>{
    const production=projectLaunchProductionContext(captured.chains["1"],1);
    const deployment={format:"fixture-refs-v2",targets:[{id:"main",argumentsJson:"[]",initializerFunction:null,
      initializerArgumentsJson:"[]",deploymentValue:"0",initializerValue:"0",hookPermissions:null}],constructorChildren:[],
      pool:{token:"main",hook:"main",initializer:"main",platformFeeBinding:"main",fee:0,tickSpacing:60},fees:null,liquidityModel:null,openingPrice:null};
    const call=vi.fn().mockResolvedValueOnce(response(graph))
      .mockResolvedValueOnce(response({interfaces:interfaces.interfaces,deployment}))
      .mockRejectedValueOnce(new ModelResponseError("timeout",{inputTokens:0,outputTokens:0}));
    const input={intent,chainId:1 as const,evmVersion:"paris" as const,model:"test-model",production};
    const error=await declareGeneralChecks(input,call).catch(error=>error);
    expect(call.mock.calls.map(([request])=>request.task)).toEqual(["interface","interface-abi","scenarios"]);
    expect(call.mock.calls[1][0]).toMatchObject({maxTokens:4000});
    expect(call.mock.calls[1][0].schema.properties.deployment.type).toBe("object");
    const saved=JSON.parse(error.diagnostic.progress.interface);
    expect(saved.contracts[0].functions).toEqual(functions);
    expect(saved.deployment.targets[0]).toMatchObject({id:"main",source:"Counter.sol",contract:"Counter",constructorArguments:[]});
    const resumed=vi.fn().mockRejectedValue(new ModelResponseError("timeout",{inputTokens:0,outputTokens:0}));
    await declareGeneralChecks({...input,rejected:error.diagnostic},resumed).catch(()=>undefined);
    expect(resumed.mock.calls.map(([request])=>request.task)).toEqual(["scenarios"]);
  });
  it("keeps separate stages for larger generated graphs without repeating unused catalog entries in deployment",async()=>{
    const production=projectLaunchProductionContext(captured.chains["1"],1);
    const contracts=Array.from({length:4},(_,index)=>({...graph.contracts[0],id:`counter-${index}`,source:`Counter${index}.sol`,contract:`Counter${index}`}));
    const catalog={id:`sha256:${"b".repeat(64)}`,contracts:[{source:"Unused.sol",contract:"UnusedDependency",functions:["function unusedMarker()"]}]} as never;
    const call=vi.fn().mockResolvedValueOnce(response({...graph,contracts}))
      .mockResolvedValueOnce(response({interfaces:contracts.map(({id})=>({id,canonical:null,functions})),deployment:null}))
      .mockRejectedValueOnce(new ModelResponseError("timeout",{inputTokens:0,outputTokens:0}));
    const error=await declareGeneralChecks({intent,chainId:1,evmVersion:"paris",model:"test-model",production,interfaces:catalog},call).catch(error=>error);
    expect(error.stage).toBe("interface");
    expect(call.mock.calls.map(([request])=>request.task)).toEqual(["interface","interface-abi","interface-deployment"]);
    expect(call.mock.calls[1][0].schema.properties.deployment.type).toBe("null");
    expect(call.mock.calls[1][0].system).toContain("UnusedDependency");
    expect(call.mock.calls[2][0].system).not.toContain("UnusedDependency");
    expect(call.mock.calls[2][0].system).toContain("function count()");
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
  it("expands older compact graph rows before building the typed interface schema",async()=>{
    const legacy={format:"compact-v1",contracts:[["main","Counter.sol","Counter","auxiliary",[],[],false,false,["surface"]]],allowedCalls:[]};
    const call=vi.fn().mockResolvedValueOnce(response({generalChecks:JSON.stringify(legacy),interfacesPending:true}))
      .mockResolvedValueOnce(response({interfaces:interfaces.interfaces,deployment:null})).mockResolvedValueOnce(response({steps,complete:true}));
    const result=await declareGeneralChecks({intent,chainId:8453,evmVersion:"cancun",model:"test-model"},call);
    expect(result.scenarios.steps).toHaveLength(2);
    expect(call.mock.calls[1][0].schema.properties.interfaces.items.properties.id.enum).toEqual(["main"]);
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
    expect(nativeScenarioRows([{...steps[0],expect:{...steps[0].expect,returnsJson:"null"}}])).toEqual(nativeScenarioRows([steps[0]]));
    expect(()=>createGeneralCheckBlueprint(nativeFullDeclaration({...graph,...interfaces,steps:[{...steps[1],expect:{...steps[1].expect,returnsJson:"null"}}]}),intent,8453,"cancun")).toThrow();
    const values='[{"pool":true},["true","-1000","4295128740"],"0x"]';
    const extraEscaped=JSON.stringify(values).slice(1,-1);
    const restored=nativeScenarioRows([{...steps[0],argumentsJson:extraEscaped}]) as {arguments:unknown[]}[];
    expect(restored[0].arguments).toEqual(JSON.parse(values));
    // Syntactic repair must never coerce a quoted boolean into a real bool.
    expect((restored[0].arguments[1] as unknown[])[0]).toBe("true");
    const literal='["\\\"quoted\\\"","C:\\\\path"]';
    expect((nativeScenarioRows([{...steps[0],argumentsJson:literal}]) as {arguments:unknown[]}[])[0].arguments).toEqual(JSON.parse(literal));
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
    const envelope=`<invoke name="structured_output"><parameter name="steps">${JSON.stringify([wire])}</parameter><parameter name="complete">false</parameter></invoke>`;
    const decoded=JSON.parse(transport.decode(envelope));
    expect(decoded).toEqual({steps:[wire],complete:false});
    expect(nativeScenarioRows(decoded.steps)).toEqual(nativeScenarioRows([steps[0]]));
    expect(()=>transport.decode(JSON.stringify({steps:[[wire[0],"main:swapCount()",...wire.slice(2)]],complete:false}))).toThrow();
    const tupleSchema=schema.properties.steps.items.anyOf[0] as {items:readonly {enum?:string[]}[]};
    expect(tupleSchema.items[1].enum).toContain("v4-router:nativeBalance(address)");
    expect(tupleSchema.items[1].enum).not.toContain("main:nativeBalance(address)");
  });
  it("admits a larger bounded scenario page without changing its values or accepting an oversized page",()=>{
    const transport=prepareSurplusSchema(scenarioSchemaForInterface({contracts:[{id:"main",functions}]}));
    const page=Array.from({length:24},(_,index)=>{const {contract,signature,...step}=steps[1];
      return {...step,id:`read-${index}`,call:`${contract}:${signature}`};});
    const decoded=JSON.parse(transport.decode(JSON.stringify({steps:page,complete:true})));
    expect(nativeScenarioRows(decoded.steps)).toEqual(nativeScenarioRows(page));
    expect(()=>transport.decode(JSON.stringify({steps:[...page,{...page[0],id:"extra"}],complete:true}))).toThrow();
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
    const native={format:"fixture-refs-v2",targets:[{id:"main",argumentsJson:'[{"input":"controller"}]',initializerFunction:null,initializerArgumentsJson:"[]",deploymentValue:"0",initializerValue:"0",hookPermissions:null}],
      constructorChildren:[{id:"child",argumentsJson:'[{"target":"main"}]',value:"0"}],pool:{...wire.pool,token:"main",initializer:"main"},fees:null,liquidityModel:null,openingPrice:null};
    const envelope={interfaces:[{id:"main",canonical:null,functions:[]},{id:"child",canonical:null,functions:[]}],deployment:native};
    const transport=prepareSurplusSchema(interfaceSchemaForGraph(local,true),true);
    expect(JSON.parse(transport.decode(JSON.stringify(envelope)))).toEqual(envelope);
    expect(nativeDeployment(native,local)).toEqual({...expanded,pool:native.pool});
    const missing=structuredClone(envelope) as unknown as {deployment:{targets:Record<string,unknown>[]}};
    delete missing.deployment.targets[0].initializerValue;
    expect(()=>transport.decode(JSON.stringify(missing))).toThrow();
    const retargeted=structuredClone(envelope);retargeted.deployment.targets[0].id="another";
    expect(()=>transport.decode(JSON.stringify(retargeted))).toThrow();
    const unfunded=structuredClone(native);unfunded.targets[0].initializerArgumentsJson='["unexpected"]';
    expect(()=>nativeDeployment(unfunded,local)).toThrow("absent initializer");
    const feesOnly={...native,fees:{buyPpm:0,sellPpm:0}};
    expect(()=>nativeDeployment(feesOnly,local)).toThrow("declared together");
  });
  it("retains the exact rejected stage privately without treating it as a complete declaration",async()=>{
    const rejected={interfaces:interfaces.interfaces,deployment:{format:"fixture-refs-v1",targets:[{id:"main",wrong:[]}],pool:{}}};
    const input={intent,chainId:8453 as const,evmVersion:"cancun" as const,model:"test-model"};
    const call=vi.fn().mockResolvedValueOnce(response(graph)).mockResolvedValueOnce(response(rejected));
    const error=await declareGeneralChecks(input,call).catch(error=>error);
    expect(call).toHaveBeenCalledTimes(2);
    expect(error.diagnostic.failures[0]).toMatchObject({declaration:null,response:JSON.stringify(rejected)});
    expect(error.diagnostic.failures[0].message).toContain("received id,wrong");
    expect(checkedCheckDiagnostic(error.diagnostic)).toEqual(error.diagnostic);
    expect(reusableCheckFailure(error.diagnostic,input)).toBeUndefined();
    expect(()=>checkedCheckDiagnostic({...error.diagnostic,failures:[{...error.diagnostic.failures[0],response:"x".repeat(96_001)}]})).toThrow();
  });
});
