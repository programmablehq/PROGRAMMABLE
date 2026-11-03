import {parseAbi,parseAbiItem,toFunctionSignature} from "viem";
import {V4_WORLD_STEP_SIGNATURES} from "./behavior-world";
import {bindCanonicalTokenMetadata} from "./deployment-metadata";

/** Native stage envelopes keep the response itself structured. Only constructor
 * values and the separately documented deployment graph need JSON value text.
 * Canonical token metadata binds to the selected coin details; the remaining
 * expansion retains the supplied values and never confers semantic approval. */
const string=(maxLength=8000)=>({type:"string",maxLength});
const identifier={type:"string",maxLength:64,pattern:"^[a-z][a-z0-9-]{0,63}$"};
const optionalIdentifier={type:"string",maxLength:64,pattern:"^(?:[a-z][a-z0-9-]{0,63})?$"};
const array=<T extends object>(items:T,maxItems:number)=>({type:"array",items,maxItems});
const object=<T extends Record<string,object>>(properties:T)=>({type:"object",properties,required:Object.keys(properties),additionalProperties:false});
const fixture={id:identifier,source:string(200),contract:string(100),role:{type:"string",enum:["token","hook","liquidity","auxiliary"]},
  argumentsJson:string(12000),allowReceive:{type:"boolean"},allowFallback:{type:"boolean"},surfaceRequirements:array(identifier,64),value:{type:["string","null"],maxLength:30}};
const world=object({kind:{type:"string",enum:["none","v4-native-token-v1","v4-protected-native-token-v1"]},
  token:optionalIdentifier,hook:optionalIdentifier,hookPermissions:{type:"integer",minimum:0,maximum:16383},fee:{type:"integer",minimum:0},
  tickSpacing:{type:"integer",minimum:0},sqrtPriceX96:string(80),initializer:optionalIdentifier,nativeUsdAnswer:string(80)});
export const graphStageSchema=object({contracts:array(object(fixture),16),
  constructorChildren:array(object({...fixture,role:{type:"string",enum:["auxiliary"]},parent:identifier,creation:{type:"string",enum:["create"]},nonce:string(30),value:string(30)}),16),
  allowedCallsJson:string(16000),world,compilerProfile:{type:"string",enum:["preserve","standard-v1","viair-200-v1"]}});
export function graphSchemaForConstraints(ids:readonly string[]){
  const scoped={...fixture,surfaceRequirements:ids.length?array({type:"string",enum:[...ids]},64):array(identifier,0)};
  return object({...graphStageSchema.properties,contracts:array(object(scoped),16),
    constructorChildren:array(object({...scoped,role:{type:"string",enum:["auxiliary"]},parent:identifier,creation:{type:"string",enum:["create"]},nonce:string(30),value:string(30)}),16)});
}
export const interfaceStageSchema=object({interfaces:array(object({id:identifier,canonical:{type:["string","null"],maxLength:100},functions:array(string(2000),128)}),16),deploymentJson:string(64000)});
const nativeFunding={type:"string",enum:["0","funding"]};
const nativeTarget={id:identifier,argumentsJson:string(12000),initializerFunction:{type:["string","null"],maxLength:100},
  initializerArgumentsJson:string(12000),deploymentValue:nativeFunding,initializerValue:nativeFunding,
  hookPermissions:{type:["integer","null"],minimum:0,maximum:16383}};
const nativeChild={id:identifier,argumentsJson:string(12000),value:string(30)};
/** Keep the production envelope typed as well. A string containing a second
 * schema cannot be validated by the provider adapter before expansion. */
export function interfaceSchemaForGraph(graph:Record<string,unknown>,production:boolean){
  const ids=(key:string)=>(graph[key] as Record<string,unknown>[]|undefined)?.map(item=>String(item.id))??[];
  const roots=ids("contracts"),children=ids("constructorChildren");
  const allIds=[...roots,...children];
  const idSchema=(values:string[])=>values.length?{type:"string",enum:values}:identifier;
  const deployment=object({format:{type:"string",enum:["fixture-refs-v2"]},
    targets:{...array(object({...nativeTarget,id:idSchema(roots)}),16),minItems:roots.length,maxItems:roots.length},
    constructorChildren:{...array(object({...nativeChild,id:idSchema(children)}),16),minItems:children.length,maxItems:children.length},
    pool:object({token:idSchema(roots),hook:idSchema(roots),initializer:idSchema(roots),platformFeeBinding:idSchema(roots),
      fee:{type:"integer",minimum:0,maximum:8388608},tickSpacing:{type:"integer",minimum:1,maximum:32767}}),
    fees:{anyOf:[{type:"null"},object({buyPpm:{type:"integer",minimum:0,maximum:100000},sellPpm:{type:"integer",minimum:0,maximum:100000}})]},
    liquidityModel:{type:["string","null"],enum:[null,"external-concentrated-liquidity","launch-seeded-concentrated-liquidity","hook-inventory-custom-accounting"]},
    openingPrice:{anyOf:[{type:"null"},object({supply:string(40),targetFdvUsd:string(40)})]}});
  return object({interfaces:{...array(object({...interfaceStageSchema.properties.interfaces.items.properties,id:idSchema(allIds)}),16),minItems:allIds.length,maxItems:allIds.length},
    deployment:production?deployment:{type:"null"}});
}
const event=object({contract:identifier,signature:string(2000),argumentsJson:string(12000)});
export const scenarioStageSchema=object({steps:array(object({id:identifier,contract:identifier,signature:string(2000),argumentsJson:string(12000),
  from:{type:"string",enum:["creator","trader-a","trader-b"]},afterSeconds:{type:"integer",minimum:0},value:string(30),read:{type:"boolean"},
  requirementIds:array(identifier,64),expect:object({status:{type:"string",enum:["success","revert"]},returnsJson:{type:["string","null"],maxLength:12000},
    swapFeePpm:{type:["integer","null"],minimum:0,maximum:1000000},events:array(event,32)})}),32),complete:{type:"boolean"}});
export function scenarioSchemaForInterface(plan:Record<string,unknown>){
  const fixtures=[...(plan.contracts as Record<string,unknown>[]),...((plan.constructorChildren??[]) as Record<string,unknown>[])];
  const calls=fixtures.flatMap(fixture=>parseAbi(fixture.functions as string[]).filter(item=>item.type==="function").map(item=>`${fixture.id}:${toFunctionSignature(item)}`));
  if(plan.world){calls.push(...V4_WORLD_STEP_SIGNATURES.map(signature=>`v4-router:${signature}`));
    if((plan.world as {kind?:string}).kind==="v4-protected-native-token-v1")calls.push("v4-router:nativeBalance(address)");}
  if(!calls.length)throw new TypeError("The agreed interface declares no callable function.");
  const {contract,signature,...fields}=scenarioStageSchema.properties.steps.items.properties;void contract;void signature;
  const tuple=[fields.id,{type:"string",enum:[...new Set(calls)]},fields.argumentsJson,fields.from,fields.afterSeconds,fields.value,fields.read,fields.requirementIds,fields.expect] as const;
  const admittedCall={type:"string",enum:[...new Set(calls)]};
  // Both documented wire forms expand to the same checked scenario. Some
  // providers switch to named fields on later pages; retaining field names
  // must not discard a complete, otherwise identical observation.
  const named=object({...fields,call:admittedCall});
  return object({steps:array({anyOf:[{type:"array",items:tuple,minItems:9,maxItems:9,additionalItems:false},named]},12),complete:{type:"boolean"}});
}
const fail=(message:string):never=>{throw new TypeError(`Invalid native check stage: ${message}.`);};
const shape=(value:unknown,keys:string[])=>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())return fail(`expected ${keys.join(",")}; received ${value&&typeof value==="object"&&!Array.isArray(value)?Object.keys(value).join(",").slice(0,800):typeof value}`);
  return value as Record<string,unknown>;
};
const json=(value:unknown,max=64000)=>{
  if(typeof value!=="string"||new TextEncoder().encode(value).length>max)return fail("bounded JSON value required");
  try{return JSON.parse(value) as unknown;}
  catch(error){
    // Some sellers escape an already encoded value once more. Remove only
    // that syntactic layer after ordinary JSON parsing failed. Values and
    // types remain untouched and pass the complete semantic validator later.
    const decoded:unknown=JSON.parse('"'+value+'"');
    if(typeof decoded!=="string"||!/^\s*[[{]/u.test(decoded))throw error;
    return JSON.parse(decoded) as unknown;
  }
};
const list=(value:unknown,max=12000)=>{const parsed=json(value,max);if(!Array.isArray(parsed))return fail("JSON array required");return parsed;};
const strings=(value:unknown)=>{if(!Array.isArray(value)||value.some(item=>typeof item!=="string"))return fail("string array required");return value as string[];};
function callSignature(value:unknown){
  if(typeof value!=="string")return fail("function signature");
  const abi=parseAbiItem(value.startsWith("function ")?value:`function ${value}`);
  if(abi.type!=="function")return fail("call must identify a function");
  return toFunctionSignature(abi);
}
export function nativeGraphDeclaration(value:unknown):Record<string,unknown>{
  const data=shape(value,Object.keys(graphStageSchema.properties));
  if(!Array.isArray(data.contracts)||!data.contracts.length||data.contracts.length>16||!Array.isArray(data.constructorChildren)||data.contracts.length+data.constructorChildren.length>16)return fail("contract count");
  const convert=(value:unknown,child=false)=>{
    const item=shape(value,[...Object.keys(fixture),...(child?["parent","creation","nonce"]:[])]);
    const {argumentsJson,value:constructorValue,...fields}=item;
    if(constructorValue!==null&&typeof constructorValue!=="string"||child&&constructorValue===null)return fail("constructor value");
    strings(item.surfaceRequirements);
    return {...fields,arguments:list(argumentsJson),functions:[],...(constructorValue!==null?{value:constructorValue}:{})};
  };
  const w=shape(data.world,Object.keys(world.properties));
  let declaredWorld:Record<string,unknown>|undefined;
  if(w.kind==="none"){
    if(w.token!==""||w.hook!==""||w.initializer!==""||w.hookPermissions!==0||w.fee!==0||w.tickSpacing!==0||w.sqrtPriceX96!=="0"||w.nativeUsdAnswer!=="0")return fail("absent world has values");
  }else if(w.kind==="v4-native-token-v1"||w.kind==="v4-protected-native-token-v1"){
    const {initializer,nativeUsdAnswer,...fields}=w;
    if(w.kind==="v4-native-token-v1"&&(initializer!==""||nativeUsdAnswer!=="0"))return fail("unprotected world has protected fields");
    declaredWorld={...fields,...(w.kind==="v4-protected-native-token-v1"?{initializer,nativeUsdAnswer}:{})};
  }else return fail("world kind");
  if(!["preserve","standard-v1","viair-200-v1"].includes(String(data.compilerProfile)))return fail("compiler profile");
  return {contracts:data.contracts.map(item=>convert(item)),allowedCalls:list(data.allowedCallsJson,16000),
    ...(data.constructorChildren.length?{constructorChildren:data.constructorChildren.map(item=>convert(item,true))}:{}),
    ...(declaredWorld?{world:declaredWorld}:{}),
    ...(data.compilerProfile!=="preserve"?{compilerProfile:data.compilerProfile}:{})};
}
/** Compact production wire inherits identities/topology only. Arguments and
 * funding are still explicitly declared in the production reference vocabulary.
 * Never promote local fixture addresses/accounts into production values. */
export function nativeDeployment(value:unknown,graph:Record<string,unknown>):unknown{
  let raw=typeof value==="string"?json(value):value;
  if(raw===null)return null;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return fail("deployment object");
  if((raw as Record<string,unknown>).format==="fixture-refs-v2"){
    const typed=shape(raw,["format","targets","constructorChildren","pool","fees","liquidityModel","openingPrice"]);
    if(!Array.isArray(typed.targets)||!Array.isArray(typed.constructorChildren))return fail("deployment collections");
    const funding=(value:unknown)=>value==="0"?"0":value==="funding"?{input:"funding"}:fail("native funding must be 0 or funding");
    const targets=typed.targets.map(value=>{
      const target=shape(value,Object.keys(nativeTarget));
      const args=list(target.initializerArgumentsJson);
      if(target.initializerFunction===null&&(args.length||target.initializerValue!=="0"))return fail("absent initializer has arguments or funding");
      return {id:target.id,arguments:list(target.argumentsJson),initializer:target.initializerFunction===null?null:{function:target.initializerFunction,arguments:args},
        deploymentValue:funding(target.deploymentValue),initializerValue:funding(target.initializerValue),hookPermissions:target.hookPermissions};
    });
    if((typed.fees===null)!==(typed.liquidityModel===null))return fail("fees and liquidity model must be declared together");
    raw={format:"fixture-refs-v1",targets,constructorChildren:typed.constructorChildren.map(value=>{
      const child=shape(value,Object.keys(nativeChild));return {id:child.id,arguments:list(child.argumentsJson),value:child.value};}),pool:typed.pool,
      ...(typed.fees!==null?{fees:typed.fees,liquidityModel:typed.liquidityModel}:{}),...(typed.openingPrice!==null?{openingPrice:typed.openingPrice}:{})};
  }
  const data=raw as Record<string,unknown>;
  if(data.format!=="fixture-refs-v1")return raw;
  const keys=["format","targets","pool",...(["constructorChildren","fees","liquidityModel","openingPrice"].filter(key=>Object.hasOwn(data,key)))];
  shape(data,keys);
  const roots=graph.contracts as Record<string,unknown>[];
  const children=(graph.constructorChildren??[]) as Record<string,unknown>[];
  if(!Array.isArray(data.targets)||!data.targets.length||data.targets.length>16)return fail("deployment targets");
  const targets=data.targets.map(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return fail("deployment target");
    const {source:sourceName,contract:contractName,...fields}=value as Record<string,unknown>;
    const target=shape(fields,["id","arguments","initializer","deploymentValue","initializerValue","hookPermissions"]);
    const source=roots.find(root=>root.id===target.id);
    if(!source)return fail("deployment target identity");
    if(sourceName!==undefined&&sourceName!==source.source||contractName!==undefined&&contractName!==source.contract)return fail("deployment target identity");
    const {arguments:args,...targetFields}=target;
    return {...targetFields,source:source.source,contract:source.contract,constructorArguments:args};
  });
  const childList=data.constructorChildren;
  if(childList!==undefined&&(!Array.isArray(childList)||childList.length>16))return fail("deployment children");
  const instances=(childList as unknown[]|undefined)?.map(value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return fail("deployment child");
    const {source:sourceName,contract:contractName,parent,creation,nonce,...fields}=value as Record<string,unknown>;
    const child=shape(fields,["id","arguments","value"]),source=children.find(item=>item.id===child.id);
    if(!source)return fail("deployment child identity");
    if([[sourceName,source.source],[contractName,source.contract],[parent,source.parent],[creation,source.creation],[nonce,source.nonce]]
      .some(([given,expected])=>given!==undefined&&given!==expected))return fail("deployment child identity");
    return {id:child.id,source:source.source,contract:source.contract,parent:source.parent,creation:source.creation,nonce:source.nonce,constructorArguments:child.arguments,value:child.value};
  });
  const {format,constructorChildren:ignored,targets:ignoredTargets,...body}=data;
  void format;void ignored;void ignoredTargets;
  return bindCanonicalTokenMetadata({...body,targets,...(instances?{constructorChildren:instances}:{})}).value;
}
export function nativeInterfaceMap(value:unknown):Record<string,unknown>{
  const data=shape(value,["interfaces"]);
  if(!Array.isArray(data.interfaces)||!data.interfaces.length||data.interfaces.length>16)return fail("interface count");
  const entries=data.interfaces.map(value=>{
    const item=shape(value,["id","canonical","functions"]);
    if(typeof item.id!=="string"||item.canonical!==null&&typeof item.canonical!=="string")return fail("interface identity");
    const functions=strings(item.functions);
    return [item.id,item.canonical===null?functions:{canonical:item.canonical,additional:functions}] as const;
  });
  if(new Set(entries.map(([id])=>id)).size!==entries.length)return fail("duplicate interface");
  return Object.fromEntries(entries);
}
export function nativeScenarioRows(value:unknown,maximum=32):unknown[]{
  if(!Array.isArray(value)||!value.length||value.length>maximum)return fail("scenario count");
  return value.map(value=>{
    if(Array.isArray(value)){
      if(value.length!==9)return fail("scenario tuple requires nine fields");
      value=Object.fromEntries(["id","call","argumentsJson","from","afterSeconds","value","read","requirementIds","expect"].map((key,index)=>[key,value[index]]));
    }
    const packed=Boolean(value&&typeof value==="object"&&Object.hasOwn(value,"call"));
    const wire=shape(value,["id",...(packed?["call"]:["contract","signature"]),"argumentsJson","from","afterSeconds","value","read","requirementIds","expect"]);
    let step=wire;
    if(packed){
      if(typeof wire.call!=="string"||!wire.call.includes(":"))return fail("call reference");
      const {call,...fields}=wire,delimiter=call.indexOf(":");
      step={...fields,contract:call.slice(0,delimiter),signature:call.slice(delimiter+1)};
    }
    const expected=shape(step.expect,["status","returnsJson","swapFeePpm","events"]);
    if(!Array.isArray(expected.events)||expected.events.length>32)return fail("event count");
    const events=expected.events.map(value=>{const item=shape(value,["contract","signature","argumentsJson"]);
      return {contract:item.contract,signature:item.signature,arguments:list(item.argumentsJson)};});
    const {argumentsJson,...fields}=step;
    const signature=callSignature(step.signature);
    // An empty argument string for a genuinely parameterless function has
    // one unambiguous meaning. Never infer a value for a parameter or return.
    const args=argumentsJson===""&&signature.endsWith("()")?[]:list(argumentsJson);
    const noReturns=expected.returnsJson===null||typeof expected.returnsJson==="string"&&expected.returnsJson.trim()==="null";
    return {...fields,signature,arguments:args,expect:{status:expected.status,
      ...(!noReturns?{returns:list(expected.returnsJson)}:{}),
      ...(expected.swapFeePpm!==null?{swapFeePpm:expected.swapFeePpm}:{}),...(events.length?{events}:{})}};
  });
}
export function correctionStageSchema(constraints:readonly string[]){
  return object({...graphSchemaForConstraints(constraints).properties,...interfaceStageSchema.properties,
    steps:{...scenarioStageSchema.properties.steps,maxItems:256}});
}
export function nativeFullDeclaration(value:unknown):Record<string,unknown>{
  const data=shape(value,[...Object.keys(graphStageSchema.properties),"interfaces","deploymentJson","steps"]);
  const graph=nativeGraphDeclaration(Object.fromEntries(Object.keys(graphStageSchema.properties).map(key=>[key,data[key]])));
  const methods=nativeInterfaceMap({interfaces:data.interfaces});
  const fixtures=[...(graph.contracts as Record<string,unknown>[]),...((graph.constructorChildren??[]) as Record<string,unknown>[])];
  if(JSON.stringify(fixtures.map(item=>item.id).sort())!==JSON.stringify(Object.keys(methods).sort()))return fail("full interface identities");
  for(const fixture of fixtures)fixture.functions=methods[String(fixture.id)];
  const deployment=nativeDeployment(data.deploymentJson,graph);
  return {...graph,...(deployment!==null?{deployment}:{}),steps:nativeScenarioRows(data.steps,256)};
}
export const nativeStageInstructions=`Return one ordinary JSON object matching the stage schema. Do not encode or escape the whole response as a string. Fixture, step and requirement IDs use lower-case letters, digits and hyphens, never camelCase. Only fields whose name ends in Json contain a JSON-encoded value. argumentsJson and allowedCallsJson encode arrays using the documented value/reference shapes. Numeric schema fields such as hookPermissions, fee, tickSpacing and afterSeconds are JSON numbers, never quoted strings. Constructor and wei amounts remain decimal strings. For no world use kind:'none', empty identity strings, zero numeric fields and '0' amount strings. For an unprotected world use initializer:'' and nativeUsdAnswer:'0'. Root constructor value:null means omitted; constructor children must supply their explicit value. Empty constructorChildren means none. compilerProfile:'preserve' omits a change to the existing/default profile. Keep every rule and exact reference; expansion is checked by the same complete validator.`;
export const nativeDeploymentInstructions=`The public interface stage returns {interfaces, deployment}. deployment is a native JSON object, never a JSON-encoded string; it is null only when no production context exists. The current schema is authoritative for field names, while the logical deployment rules below describe their meaning. Use format:'fixture-refs-v2' and every required schema field. Each target has id, argumentsJson, initializerFunction, initializerArgumentsJson, deploymentValue, initializerValue, hookPermissions. argumentsJson and initializerArgumentsJson encode only their value arrays. An absent initializer has initializerFunction:null, initializerArgumentsJson:'[]' and initializerValue:'0'. Native deploymentValue and initializerValue are the literal strings '0' or 'funding'; 'funding' expands to {input:'funding'} and may be consumed only once. Non-hook hookPermissions is null. Each child has exactly id, argumentsJson, value. The server takes source/contract and child parent/creation/nonce from the same id in the fixed graph; do not repeat them. Include fees, liquidityModel and openingPrice as native objects or null, never omit them. fees and liquidityModel must both be null or both declared. Every production argument and value stays explicit using target/input/binding references, never local account/fixture values. Reuse exactly the fixed graph identities; this is lossless compression of topology, not automatic conversion of test values to production.`;
