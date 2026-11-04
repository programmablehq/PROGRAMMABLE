import "server-only";
import { defineTool } from "../definition.server";

const stringPath={type:"array",minItems:1,maxItems:16,items:{type:"string",minLength:1,maxLength:120}};
export const dataAdapterDefinitionSchema={type:"object",properties:{version:{const:1},name:{type:"string",minLength:1,maxLength:120},url:{type:"string",maxLength:2048},
  valuePath:stringPath,timestampPath:stringPath,timestampFormat:{enum:["unix-seconds","unix-milliseconds","iso8601"]},decimals:{type:"integer",minimum:0,maximum:18},
  minimum:{type:"string",pattern:"^-?(0|[1-9][0-9]{0,76})$"},maximum:{type:"string",pattern:"^-?(0|[1-9][0-9]{0,76})$"},maxAgeSeconds:{type:"integer",minimum:1,maximum:86400},
  values:{anyOf:[{type:"null"},{type:"object",maxProperties:64,additionalProperties:{type:"string",maxLength:50}}]}},
  required:["version","name","url","valuePath","timestampPath","timestampFormat","decimals","minimum","maximum","maxAgeSeconds","values"],additionalProperties:false};

export default defineTool("data_adapter","Create, read or list a private, versioned adapter for a public HTTPS JSON source. Create supplies a declarative field/unit/timestamp mapping and validates an actual bounded observation before saving. No generated code executes; no keys, custom headers, external writes or onchain transactions. Reuse the returned adapter id on read. Parsing one observation is not proof of oracle truth or a live onchain feed. A data source that has no trustworthy timestamp needs another integration; never invent its timestamp.",async(input,context)=>{
  if(!context.dataAdapters||context.dataAdapters.owner!==context.owner)throw Error("Data adapters need an owned chat.");
  const value=input as {action:"create";definition:unknown}|{action:"read";id:string}|{action:"list";after?:string};
  let facts:Awaited<ReturnType<typeof context.dataAdapters.create>>|Awaited<ReturnType<typeof context.dataAdapters.read>>|Awaited<ReturnType<typeof context.dataAdapters.list>>;
  try{facts=value.action==="create"?await context.dataAdapters.create(value.definition,context.signal)
    :value.action==="read"?await context.dataAdapters.read(value.id,context.signal):await context.dataAdapters.list(value.after);}
  catch(error){
    context.signal?.throwIfAborted();
    if(error instanceof TypeError)return {status:"adapter-definition-incomplete",facts:"The returned JSON does not match the selected fields, exact units, timestamp or bounds. Preserve the source requirement; correct its documented mapping before using it.",sources:[]};
    throw error;
  }
  const source="definition" in facts?facts.definition.url:undefined;
  return {status:value.action==="list"?"private-data-adapters":"data-adapter-observation",facts,
    sources:source?[{title:"Public JSON data observation",url:source,retrievedAt:"checkedAt" in facts?facts.checkedAt:new Date().toISOString()}]:[]};
},context=>Boolean(context.dataAdapters&&context.dataAdapters.owner===context.owner),{oneOf:[
  {type:"object",properties:{action:{const:"create"},definition:dataAdapterDefinitionSchema},required:["action","definition"],additionalProperties:false},
  {type:"object",properties:{action:{const:"read"},id:{type:"string",pattern:"^adapter-[a-f0-9]{56}$"}},required:["action","id"],additionalProperties:false},
  {type:"object",properties:{action:{const:"list"},after:{type:"string",pattern:"^adapter-[a-f0-9]{56}$"}},required:["action"],additionalProperties:false},
]});
