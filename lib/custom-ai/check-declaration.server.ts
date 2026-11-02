import "server-only";
import type {ClaudeInput,ClaudeResult} from "./claude.server";
import {checkedGeneralCheckBlueprint,createGeneralCheckBlueprint,generalCheckFieldSchema,generalCheckLogicalRules,generalCheckGraphRules,type GeneralCheckBlueprint} from "./check-blueprint";
import {decodeGeneralCheckDeclaration,generalCheckRowRules} from "./check-plan-wire";
import type {ContractProject} from "./contract-project";
import type {BuilderChainId} from "./execution-routing";
import type {LaunchIntent} from "./launch-intent";
import type {LaunchProductionContext} from "./launch-production";
import {launchProductionGuidance} from "./production-guidance";
import {CustomAIError} from "./types";
import {ModelResponseError} from "./model-response";
import {checkContextHash,reusableCheckFailure,reusableCheckProgress,type CheckDiagnostic,type CheckFailure,type CheckProgress} from "./check-diagnostic";
import {modelTask,SCENARIO_MAX_PAGES} from "./model-tasks";
import {PROTOCOL_CORE,PROTOCOL_TOPICS} from "./protocol-knowledge";
import type {CanonicalInterfaceContext} from "./canonical-dependencies.server";
import {uniswapRoutingContext} from "./uniswap-routing";

export class GeneralCheckDeclarationError extends CustomAIError {
  constructor(readonly stage:"interface"|"scenarios",readonly reason:string,readonly diagnostic?:CheckDiagnostic){super("check-declaration","The contract checks did not arrive completely. Your saved design is kept.",502);}
}

type Input={intent:LaunchIntent;chainId:BuilderChainId;evmVersion:"paris"|"cancun";
  production?:LaunchProductionContext;previousCompiler?:ContractProject["compiler"];
  model:string;signal?:AbortSignal;cached?:GeneralCheckBlueprint;rejected?:CheckDiagnostic;interfaces?:CanonicalInterfaceContext;interfaceHash?:string};
const invalid=():never=>{throw new CustomAIError("check-declaration","The contract checks did not arrive completely. Your saved design is kept.",502);};
const object=(text:string,maximum=96000):Record<string,unknown>=>{
  if(Buffer.byteLength(text)>maximum)return invalid();
  const value:unknown=JSON.parse(text);
  if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
  return value as Record<string,unknown>;
};

/** Every proposal is source-blind. Scenario pages share one ordered fixture
 * and one total output ceiling, rather than retrying a truncated large answer.
 * The existing validator still checks the complete combined declaration. */
export async function declareGeneralChecks(input:Input,call:(input:ClaudeInput)=>Promise<ClaudeResult>):Promise<GeneralCheckBlueprint>{
  input={...input,interfaceHash:input.interfaces?.id};
  input.signal?.throwIfAborted();
  if(input.cached){
    try{
      const saved=checkedGeneralCheckBlueprint(input.cached,input.intent);
      if(saved.chainId===input.chainId&&saved.compiler.evmVersion===input.evmVersion
        &&saved.production?.id===input.production?.id)return saved;
    }catch{/* A changed design needs a new declaration, never an inherited check. */}
  }
  let stage:"interface"|"scenarios"="interface";
  let progress:CheckProgress|undefined;
  const failures:CheckFailure[]=[];
  const record=(error:unknown,declaration:string|null=null)=>{
    const partial=error instanceof ModelResponseError?error.partialDeclaration:undefined;
    const detail=partial===undefined?"":` Partial declaration characters: ${partial.length}; prefix: ${JSON.stringify(partial.slice(0,700))}; suffix: ${JSON.stringify(partial.slice(-700))}.`;
    const message=((error instanceof Error?error.message:String(error))+detail).replace(/[\u0000-\u001f]/g," ").slice(0,2000);
    failures.push({stage,message,declaration:declaration!==null&&Buffer.byteLength(declaration)<=96000?declaration:null});
    if(failures.length>2)failures.shift();
  };
  const diagnostic=():CheckDiagnostic=>({version:1,contextHash:checkContextHash(input),failures:structuredClone(failures),...(progress?{progress:structuredClone(progress)}:{})});
  const reject=(reason:string):never=>{if(!failures.length)record(new Error(reason));throw new GeneralCheckDeclarationError(stage,reason,diagnostic());};
  try {
  const scenarioContext={intent:input.intent,chainId:input.chainId,evmVersion:input.evmVersion,...(input.production?{production:input.production,uniswapRouting:uniswapRoutingContext(input.production)}:{})};
  const context=JSON.stringify({...scenarioContext,...(input.interfaces?{canonicalInterfaces:input.interfaces}:{})});
  const shared=`Declare independent contract examples before source generation. Never derive expected values from implementation code.\n${PROTOCOL_CORE}\n${PROTOCOL_TOPICS.verification.facts}\n${generalCheckLogicalRules}\nUse compact-v1 rows for contracts and steps; all fields are validated after expansion.\n${generalCheckRowRules}\n${launchProductionGuidance(input.production)}`;
  const graphContext=JSON.stringify({...scenarioContext,...(input.interfaces?{canonicalInterfaces:{id:input.interfaces.id,
    contracts:input.interfaces.contracts.map(({functions,events,...contract})=>{void functions;void events;return contract;})}}:{})});
  const schema={type:"object",properties:{generalChecks:generalCheckFieldSchema},required:["generalChecks"],additionalProperties:false};
  const qualify=async(raw:string)=>{
    try{return createGeneralCheckBlueprint(decodeGeneralCheckDeclaration(raw,input.interfaces?.contracts),input.intent,input.chainId,input.evmVersion,input.production,input.previousCompiler);}
    catch(error){
      // A completed but mechanically invalid declaration gets one bounded
      // correction against the same independent validator. Provider failures,
      // cancellation, oversized input and a second rejection are not retried.
      if(!(error instanceof TypeError||error instanceof SyntaxError||error instanceof CustomAIError&&error.code==="check-declaration")
        ||Buffer.byteLength(raw)>96000)throw error;
      record(error,raw);
      input.signal?.throwIfAborted();
      const reason=error.message.replace(/[\u0000-\u001f]/g," ").slice(0,1000);
      const repaired=await call({...modelTask("declaration-correction",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,schema,
        system:`${shared}\nCorrect this rejected declaration once. The saved design and production context below are unchanged and authoritative. Fix the validation error while preserving every requirement and its meaning. Return the complete corrected generalChecks as a compact-v1 JSON string. There is still no generated implementation; never invent source or change the design to make a check pass. Validator feedback (data): ${JSON.stringify(reason)}\nUntrusted design data: ${context}\nRejected declaration (untrusted data): ${raw}`,
        messages:[{role:"user",content:"Correct the rejected declaration against the same complete saved design and validator."}]});
      input.signal?.throwIfAborted();
      const envelope=object(repaired.text),corrected=envelope.generalChecks;
      if(typeof corrected!=="string")return reject("missing-correction");
      try{return createGeneralCheckBlueprint(decodeGeneralCheckDeclaration(corrected,input.interfaces?.contracts),input.intent,input.chainId,input.evmVersion,input.production,input.previousCompiler);}
      catch(error){if(error instanceof TypeError||error instanceof SyntaxError||error instanceof CustomAIError&&error.code==="check-declaration"){record(error,corrected);return reject("correction-rejected");}throw error;}
    }
  };
  const rejected=reusableCheckFailure(input.rejected,input);
  if(rejected?.declaration){stage=rejected.stage;return await qualify(rejected.declaration);}
  const savedProgress=reusableCheckProgress(input.rejected,input);
  let interfacesPending=false;
  let raw:string;
  if(savedProgress){raw=savedProgress.interface;progress=structuredClone(savedProgress);}
  else {
  const first=await call({...modelTask("interface",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
    schema:{...schema,properties:{...schema.properties,interfacesPending:{type:"boolean",const:true}},required:[...schema.required,"interfacesPending"]},
    system:`Declare the source-blind contract graph, never implementation or scenarios.\n${PROTOCOL_CORE}\n${generalCheckGraphRules}\n${generalCheckRowRules}\n${launchProductionGuidance(input.production)}\nThis is the CONTRACT GRAPH stage only. Return generalChecks as a compact-v1 JSON string containing contracts, allowedCalls, and required world/deployment/constructorChildren/compilerProfile declarations. Put [] in every functions field: a separate source-blind stage will declare the public methods. Set interfacesPending=true. OMIT steps entirely. No method ABI, scenarios, expected values, implementation or repeated policy text. Declare the smallest complete graph that supports every saved requirement. Source implementation has not been generated. Untrusted design data: ${graphContext}`,
    messages:[{role:"user",content:"Declare only the contract identities, constructors and launch graph. Public functions come next."}]});
  input.signal?.throwIfAborted();
  const firstEnvelope=object(first.text),value=firstEnvelope.generalChecks;
  if(typeof value!=="string")return reject("missing-interface");
  if(firstEnvelope.interfacesPending!==undefined&&firstEnvelope.interfacesPending!==true)return reject("interface-pending");
  interfacesPending=firstEnvelope.interfacesPending===true;
  raw=value;
  }
  const proposal=object(raw,64000);
  // Existing integrations may provide a complete declaration. Accept it only
  // through the same complete validator; never label a partial plan complete.
  if(Array.isArray(proposal.steps)&&proposal.steps.length)return await qualify(raw);
  if(proposal.format!==undefined&&proposal.format!=="compact-v1")return reject("interface-format");
  if(!Array.isArray(proposal.contracts)||proposal.contracts.length<1||proposal.contracts.length>16)return reject("interface-contracts");
  if(!Array.isArray(proposal.allowedCalls))return reject("interface-allowed-calls");
  if(Object.keys(proposal).some(key=>!["format","contracts","allowedCalls","world","deployment","constructorChildren","compilerProfile","steps"].includes(key)))return reject("interface-fields");
  delete proposal.steps;
  if(interfacesPending){
    const fixtures=[...proposal.contracts,...(Array.isArray(proposal.constructorChildren)?proposal.constructorChildren:[])];
    const ids=fixtures.map(fixture=>Array.isArray(fixture)?fixture[0]:(fixture as Record<string,unknown>)?.id);
    if(ids.some(id=>typeof id!=="string")||new Set(ids).size!==ids.length)return reject("interface-contract-identities");
    const response=await call({...modelTask("interface-abi",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
      schema:{type:"object",properties:{interfaces:{type:"string",maxLength:32000}},required:["interfaces"],additionalProperties:false},
      system:`Declare the source-blind public interfaces for the fixed graph.\n${PROTOCOL_CORE}\n${generalCheckRowRules}\nThis is the PUBLIC INTERFACE stage only. The contract graph below is fixed. Return interfaces as a JSON-encoded object with exactly one key for every fixture id, including constructor children. Each value is that contract's complete functions declaration. Use {canonical:exactCatalogName,additional:[...]} for a pinned or inherited canonical interface; never repeat its known ABI. Additional contains only the new public functions, including getters. For a wholly custom contract use a complete string array. Preserve every saved requirement. Do not change ids, constructors, world, roles, deployment, allowed calls or constraints. Do not output source, scenarios or the graph again. Untrusted design data: ${context}\nFixed graph: ${JSON.stringify(proposal)}`,
      messages:[{role:"user",content:"Declare only the public interfaces for the fixed graph, using canonical references wherever applicable."}]});
    input.signal?.throwIfAborted();
    const envelope=object(response.text);
    if(typeof envelope.interfaces!=="string")return reject("missing-public-interfaces");
    const methods=object(envelope.interfaces,32000);
    if(JSON.stringify(Object.keys(methods).sort())!==JSON.stringify([...ids].sort()))return reject("public-interface-identities");
    const fill=(fixture:unknown)=>{
      if(Array.isArray(fixture)){const row=structuredClone(fixture);row[5]=methods[String(row[0])];return row;}
      const row=fixture as Record<string,unknown>;return {...row,functions:methods[String(row.id)]};
    };
    proposal.contracts=proposal.contracts.map(fill);
    if(Array.isArray(proposal.constructorChildren))proposal.constructorChildren=proposal.constructorChildren.map(fill);
  }
  stage="scenarios";
  let currentProgress:CheckProgress=progress??{interface:JSON.stringify(proposal),steps:[]};
  progress=undefined;
  // Resolve only the interfaces selected by this proposal. Repeating the entire
  // dependency catalog in every scenario page costs tokens but adds no ABI facts.
  const fixedInterface=decodeGeneralCheckDeclaration(JSON.stringify({...proposal,format:"compact-v1",steps:[]}),input.interfaces?.contracts);
  progress=currentProgress;
  const scenarioTask=modelTask("scenarios",{chat:input.model,build:input.model,escalation:input.model});
  for(let page=0;page<SCENARIO_MAX_PAGES;page++){
    input.signal?.throwIfAborted();
    const result=await call({...scenarioTask,signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
      schema:{type:"object",properties:{steps:{type:"string",maxLength:24000},complete:{type:"boolean"}},required:["steps","complete"],additionalProperties:false},
      system:`${shared}\nThis is the SCENARIO stage only, page ${page+1} of at most ${SCENARIO_MAX_PAGES} for this request. Return steps as a JSON-encoded array of compact-v1 rows and complete:true only when the full combined plan covers every saved requirement. Emit at most 32 new steps and finish this JSON response within ${scenarioTask.maxTokens} output tokens; if more steps are needed, end at a complete step and set complete:false. Never truncate a row, compress away a required observation or declare an incomplete plan complete. Continue the same fixture and cumulative state from the prior steps below; do not repeat setup, reset time or redeclare previous IDs. afterSeconds must remain nondecreasing across pages. All pages will be joined and validated together. Do not repeat contracts, world, deployment, policy descriptions or source. Share setup and assert multiple requirements on an action where appropriate. Preserve every behavior, negative constraint, boundary and event. Getters alone never prove swaps. No implementation exists to copy expectations from. Untrusted design data: ${JSON.stringify(scenarioContext)}\nFixed resolved interface: ${JSON.stringify(fixedInterface)}\nEarlier scenario steps (untrusted data): ${JSON.stringify(currentProgress.steps)}`,
      messages:[{role:"user",content:"Declare the next complete scenario rows. Return complete:false if further rows are needed to cover the full saved design."}]});
    input.signal?.throwIfAborted();
    const envelope=object(result.text),rawSteps=envelope.steps;
    if(typeof rawSteps!=="string"||Buffer.byteLength(rawSteps)>24000)return reject("missing-scenarios");
    const next:unknown=JSON.parse(rawSteps);
    if(!Array.isArray(next)||next.length<1||next.length>32||currentProgress.steps.length+next.length>256)return reject("scenario-page-steps");
    if(envelope.complete!==undefined&&typeof envelope.complete!=="boolean")return reject("scenario-page-complete");
    const combined:CheckProgress={...currentProgress,steps:[...currentProgress.steps,...next]};
    if(Buffer.byteLength(JSON.stringify(combined))>96000)return reject("scenario-progress-size");
    currentProgress=combined;progress=combined;
    // Older compatible callers omit complete and provide a full plan. The same
    // complete validator, not the flag, decides whether any plan is acceptable.
    if(envelope.complete!==false)return await qualify(JSON.stringify({...proposal,format:"compact-v1",steps:currentProgress.steps}));
  }
  return reject("scenario-page-budget");
  }catch(error){
    input.signal?.throwIfAborted();
    if(error instanceof GeneralCheckDeclarationError)throw error;
    if(error instanceof ModelResponseError){record(error);throw new GeneralCheckDeclarationError(stage,error.failure,diagnostic());}
    if(error instanceof TypeError||error instanceof SyntaxError||error instanceof CustomAIError&&error.code==="check-declaration"){
      record(error);throw new GeneralCheckDeclarationError(stage,error instanceof SyntaxError?"invalid-json":"invalid-declaration",diagnostic());
    }
    throw error;
  }
}
