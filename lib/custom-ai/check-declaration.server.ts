import "server-only";
import type {ClaudeInput,ClaudeResult} from "./claude.server";
import {checkedGeneralCheckBlueprint,createGeneralCheckBlueprint,generalCheckFieldSchema,generalCheckLogicalRules,type GeneralCheckBlueprint} from "./check-blueprint";
import {decodeGeneralCheckDeclaration,generalCheckRowRules} from "./check-plan-wire";
import type {ContractProject} from "./contract-project";
import type {BuilderChainId} from "./execution-routing";
import type {LaunchIntent} from "./launch-intent";
import type {LaunchProductionContext} from "./launch-production";
import {launchProductionGuidance} from "./production-guidance";
import {CustomAIError} from "./types";
import {ModelResponseError} from "./model-response";
import {checkContextHash,reusableCheckFailure,type CheckDiagnostic,type CheckFailure} from "./check-diagnostic";
import {modelTask} from "./model-tasks";
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

/** Both proposals are source-blind. Splitting the small interface/launch graph
 * from its scenarios prevents one large response exhausting the output budget.
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
  const failures:CheckFailure[]=[];
  const record=(error:unknown,declaration:string|null=null)=>{
    const message=(error instanceof Error?error.message:String(error)).replace(/[\u0000-\u001f]/g," ").slice(0,2000);
    failures.push({stage,message,declaration:declaration!==null&&Buffer.byteLength(declaration)<=96000?declaration:null});
    if(failures.length>2)failures.shift();
  };
  const diagnostic=():CheckDiagnostic=>({version:1,contextHash:checkContextHash(input),failures:structuredClone(failures)});
  const reject=(reason:string):never=>{if(!failures.length)record(new Error(reason));throw new GeneralCheckDeclarationError(stage,reason,diagnostic());};
  try {
  const context=JSON.stringify({intent:input.intent,chainId:input.chainId,evmVersion:input.evmVersion,...(input.production?{production:input.production,uniswapRouting:uniswapRoutingContext(input.production)}:{}),...(input.interfaces?{canonicalInterfaces:input.interfaces}:{})});
  const shared=`Declare independent contract examples before source generation. Never derive expected values from implementation code.\n${PROTOCOL_CORE}\n${PROTOCOL_TOPICS.verification.facts}\n${generalCheckLogicalRules}\nUse compact-v1 rows for contracts and steps; all fields are validated after expansion.\n${generalCheckRowRules}\n${launchProductionGuidance(input.production)}`;
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
      const repaired=await call({...modelTask("declaration-correction",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",schema,
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
  const first=await call({...modelTask("interface",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",schema,
    system:`${shared}\nThis is the INTERFACE stage only. Return generalChecks as a compact-v1 JSON string containing contracts, allowedCalls, and the required world/deployment/constructorChildren/compilerProfile declarations. OMIT steps entirely. No scenario descriptions, no expected values, no implementation, no repeated policy text. The next independent stage supplies the steps against these fixed interfaces. Use the smallest complete interface that implements every saved requirement. Source implementation has not been generated. Untrusted design data: ${context}`,
    messages:[{role:"user",content:"Declare only the interfaces and launch graph for this saved design."}]});
  input.signal?.throwIfAborted();
  const firstEnvelope=object(first.text),raw=firstEnvelope.generalChecks;
  if(typeof raw!=="string")return reject("missing-interface");
  const proposal=object(raw,64000);
  // Existing integrations may provide a complete declaration. Accept it only
  // through the same complete validator; never label a partial plan complete.
  if(Array.isArray(proposal.steps)&&proposal.steps.length)return await qualify(raw);
  if(proposal.format!==undefined&&proposal.format!=="compact-v1")return reject("interface-format");
  if(!Array.isArray(proposal.contracts)||proposal.contracts.length<1||proposal.contracts.length>16)return reject("interface-contracts");
  if(!Array.isArray(proposal.allowedCalls))return reject("interface-allowed-calls");
  if(Object.keys(proposal).some(key=>!["format","contracts","allowedCalls","world","deployment","constructorChildren","compilerProfile","steps"].includes(key)))return reject("interface-fields");
  delete proposal.steps;
  stage="scenarios";
  const second=await call({...modelTask("scenarios",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",
    schema:{type:"object",properties:{steps:{type:"string",maxLength:64000}},required:["steps"],additionalProperties:false},
    system:`${shared}\nThis is the SCENARIO stage only. The interface and launch graph below are fixed. Return steps as a JSON-encoded array of compact-v1 step rows. Do not repeat contracts, world, deployment, policy descriptions or source code. Keep setup shared and assert multiple requirements on the same action where appropriate. Preserve every saved behavior, negative constraint, boundary and event. Use the smallest complete observable scenario set; getters alone never prove swaps. There is no generated implementation to copy expectations from. Untrusted design data: ${context}\nFixed interface: ${JSON.stringify(proposal)}`,
    messages:[{role:"user",content:"Declare only the independent scenario rows for the fixed interface and complete saved design."}]});
  input.signal?.throwIfAborted();
  const stepsEnvelope=object(second.text),rawSteps=stepsEnvelope.steps;
  if(typeof rawSteps!=="string"||Buffer.byteLength(rawSteps)>64000)return reject("missing-scenarios");
  const steps:unknown=JSON.parse(rawSteps);
  if(!Array.isArray(steps)||steps.length<1||steps.length>256)return reject("scenario-steps");
  return await qualify(JSON.stringify({...proposal,format:"compact-v1",steps}));
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
