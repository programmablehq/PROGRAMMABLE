import "server-only";
import type { AIStore } from "../store.server";
import type { FeedSnapshot } from "../rule-evaluator";
import { createJSONDataAdapter, readJSONObservation, type JSONDataAdapter } from "./json.server";

type RecordValue={version:1;scope:"public-json-read-only";adapter:JSONDataAdapter;observation:FeedSnapshot;responseHash:`sha256:${string}`;checkedAt:string};
type Store=Pick<AIStore,"readObject"|"saveObject"|"listObjects">;
const kind="data-adapter";
function checked(value:RecordValue):RecordValue {
  const adapter=createJSONDataAdapter(value.adapter?.definition);
  const sample=value.observation;
  if(value.version!==1||value.scope!=="public-json-read-only"||adapter.id!==value.adapter.id||adapter.implementationHash!==value.adapter.implementationHash
    ||sample?.feedId!==adapter.id||sample.sourceVersion!==adapter.implementationHash
    ||!/^\d{1,20}$/.test(sample.sequence)||!/^\d{1,20}$/.test(sample.transitionSequence)||BigInt(sample.sequence)<1n||BigInt(sample.sequence)>=(1n<<64n)||BigInt(sample.transitionSequence)>BigInt(sample.sequence)
    ||!(/^-?\d{1,78}$/).test(sample.value)||!(/^-?\d{1,78}$/).test(sample.previousValue)
    ||BigInt(sample.value)<BigInt(adapter.definition.minimum)||BigInt(sample.value)>BigInt(adapter.definition.maximum)
    ||!Number.isSafeInteger(sample.observedAt)||sample.observedAt<0||!Number.isSafeInteger(sample.changedAt)||sample.changedAt<0||sample.changedAt>sample.observedAt
    ||sample.validUntil!==sample.observedAt+adapter.definition.maxAgeSeconds||sample.fresh!==true
    ||!/^sha256:[a-f0-9]{64}$/.test(value.responseHash)||!Number.isFinite(Date.parse(value.checkedAt)))throw Error("The saved data adapter does not match its verified definition.");
  return structuredClone(value);
}
function view(value:RecordValue){
  return {id:value.adapter.id,implementationHash:value.adapter.implementationHash,name:value.adapter.definition.name,
    scope:value.scope,definition:value.adapter.definition,observation:value.observation,checkedAt:value.checkedAt,
    qualification:"parsed-observation-only" as const,onchainBinding:"not-configured" as const,transactions:false as const};
}
export function createDataAdapterLibrary(store:Store,owner:string,read=readJSONObservation){
  if(!owner)throw Error("An owned chat is required for data adapters.");
  const load=async(id:string)=>{
    if(!/^adapter-[a-f0-9]{56}$/.test(id))throw Error("Choose a data adapter from this chat's library.");
    const row=await store.readObject<RecordValue>(owner,kind,id);
    if(!row)throw Error("That data adapter was not found in this account.");
    const value=checked(row.value);if(value.adapter.id!==id)throw Error("The saved adapter identity changed.");
    return {...row,value};
  };
  return {
    owner,
    async create(definition:unknown,signal?:AbortSignal){
      signal?.throwIfAborted();const adapter=createJSONDataAdapter(definition);
      const prior=await store.readObject<RecordValue>(owner,kind,adapter.id);
      if(prior){const value=checked(prior.value);if(value.adapter.id!==adapter.id)throw Error("The saved adapter identity changed.");return {...view(value),reused:true};}
      const {observation,responseHash}=await read(adapter,undefined,signal);signal?.throwIfAborted();
      const record:RecordValue={version:1,scope:"public-json-read-only",adapter,observation,responseHash,checkedAt:new Date().toISOString()};
      checked(record);
      try{await store.saveObject(owner,kind,adapter.id,record,0);}
      catch(error){
        if((error as {code?:string})?.code!=="conflict")throw error;
        return {...view((await load(adapter.id)).value),reused:true};
      }
      return {...view(record),reused:false};
    },
    async read(id:string,signal?:AbortSignal){
      signal?.throwIfAborted();const prior=await load(id);
      const {observation,responseHash}=await read(prior.value.adapter,prior.value.observation,signal);signal?.throwIfAborted();
      const record:RecordValue={...prior.value,observation,responseHash,checkedAt:new Date().toISOString()};checked(record);
      if(JSON.stringify(observation)!==JSON.stringify(prior.value.observation)){
        try{await store.saveObject(owner,kind,id,record,prior.revision);}
        catch(error){
          if((error as {code?:string})?.code!=="conflict")throw error;
          const current=(await load(id)).value;
          if(current.observation.observedAt!==observation.observedAt||current.observation.value!==observation.value)throw Error("The data source changed during this read. Keep the newer saved observation.");
          return view(current);
        }
      }
      return view(record);
    },
    async list(after?:string){
      if(after!==undefined&&!/^adapter-[a-f0-9]{56}$/.test(after))throw Error("Choose a valid adapter page cursor.");
      const entries=await store.listObjects<RecordValue>(owner,kind,21,after??"");
      return {items:entries.slice(0,20).map(value=>{
        const item=checked(value);return {id:item.adapter.id,name:item.adapter.definition.name,implementationHash:item.adapter.implementationHash,scope:item.scope,checkedAt:item.checkedAt};
      }),hasMore:entries.length>20,nextCursor:entries.length>20?checked(entries[19]).adapter.id:null};
    },
  };
}
export type DataAdapterLibrary=ReturnType<typeof createDataAdapterLibrary>;
