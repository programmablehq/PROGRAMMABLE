import "server-only";
import type {ClaudeInput,ClaudeResult} from "./claude.server";
import {checkedGeneralCheckBlueprint,createGeneralCheckBlueprint,generalCheckLogicalRules,generalCheckGraphRules,type GeneralCheckBlueprint} from "./check-blueprint";
import {decodeGeneralCheckDeclaration} from "./check-plan-wire";
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
import {declarationCorrectionSchema,applyDeclarationCorrection,declarationCorrectionView,assertCorrectionRetainsObservations} from "./declaration-correction";
import {validateDeclaredInterfaceCalls} from "./declared-interface-calls";
import type {GeneralCheckScenarios} from "./behavior-checks";
import {resolveOpeningFixture,resolveOpeningFixtureValue,openingFixtureInstructions} from "./opening-fixture";
import {generalDeploymentPlanningRules} from "./deployment-blueprint";
import {uniswapRoutingContext} from "./uniswap-routing";
import {graphSchemaForConstraints,interfaceSchemaForGraph,nativeFullDeclaration,nativeGraphDeclaration,nativeInterfaceMap,nativeScenarioRows,nativeStageInstructions,nativeDeployment,nativeDeploymentInstructions,scenarioSchemaForInterface} from "./check-stage-wire";

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
function remainingRequirements(intent:LaunchIntent,proposal:Record<string,unknown>,steps:unknown[]){
  const covered=new Set<string>(),observed=new Set<string>();
  for(const item of [...(proposal.contracts as unknown[]),...((proposal.constructorChildren??[]) as unknown[])]){
    const ids=Array.isArray(item)?item[8]:(item as {surfaceRequirements?:unknown}).surfaceRequirements;
    if(Array.isArray(ids))for(const id of ids)if(typeof id==="string")covered.add(id);
  }
  for(const step of steps){
    const ids=Array.isArray(step)?step[8]:(step as {requirementIds?:unknown}).requirementIds;
    const expected=(Array.isArray(step)?step[9]:(step as {expect?:unknown}).expect) as Record<string,unknown>|undefined;
    if(!Array.isArray(ids))continue;
    for(const id of ids)if(typeof id==="string"){
      covered.add(id);
      if(expected&&(expected.status==="revert"||Array.isArray(expected.returns)&&expected.returns.length||expected.swapFeePpm!==undefined||Array.isArray(expected.events)&&expected.events.length))observed.add(id);
    }
  }
  return intent.requirements.filter(rule=>!covered.has(rule.id)||rule.kind==="behavior"&&!observed.has(rule.id));
}

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
  let responseText:string|undefined;
  const failures:CheckFailure[]=[];
  const record=(error:unknown,declaration:string|null=null,response?:string)=>{
    const partial=error instanceof ModelResponseError?error.partialDeclaration:undefined;
    const detail=partial===undefined?"":` Partial declaration characters: ${partial.length}; prefix: ${JSON.stringify(partial.slice(0,700))}; suffix: ${JSON.stringify(partial.slice(-700))}.`;
    const message=((error instanceof Error?error.message:String(error))+detail).replace(/[\u0000-\u001f]/g," ").slice(0,2000);
    const captured=response??partial;
    failures.push({stage,message,declaration:declaration!==null&&Buffer.byteLength(declaration)<=96000?declaration:null,
      ...(captured!==undefined&&Buffer.byteLength(captured)<=96000?{response:captured}:{})});
    if(failures.length>2)failures.shift();
  };
  const diagnostic=():CheckDiagnostic=>({version:1,contextHash:checkContextHash(input),failures:structuredClone(failures),...(progress?{progress:structuredClone(progress)}:{})});
  const reject=(reason:string):never=>{if(!failures.length)record(new Error(reason));throw new GeneralCheckDeclarationError(stage,reason,diagnostic());};
  try {
  const scenarioContext={intent:input.intent,chainId:input.chainId,evmVersion:input.evmVersion,...(input.production?{production:input.production,uniswapRouting:uniswapRoutingContext(input.production)}:{})};
  const context=JSON.stringify({...scenarioContext,...(input.interfaces?{canonicalInterfaces:input.interfaces}:{})});
  const shared=`Declare independent contract examples before source generation. Never derive expected values from implementation code. When using canonical protected initializers, initialization executes the initial buy as a swap. Rules covering every successful swap also include that initial swap; do not assume a zero counter or no event after initialization. swapFeePpm observes the PoolManager LP-fee field, not separately charged hook fees. Initializer minTokenOut is denominated in raw tokens, never native input; account for mandatory fees and price impact when choosing a positive minimum. A fixed zero-LP-fee pool emits zero there; verify platform and opening hook fees via quote results, vault state or balances instead. Logical fields below describe the server-expanded plan; the current stage schema defines its wire representation. All logical fields are validated after expansion.\n${PROTOCOL_CORE}\n${PROTOCOL_TOPICS.verification.facts}\n${generalCheckLogicalRules}\n${launchProductionGuidance(input.production)}`;
  const graphContext=JSON.stringify({...scenarioContext,...(input.interfaces?{canonicalInterfaces:{id:input.interfaces.id,
    contracts:input.interfaces.contracts.map(({functions,events,...contract})=>{void functions;void events;return contract;}),construction:input.interfaces.construction}}:{})});
  const expandedDeclaration=(text:string)=>{
    const decoded=decodeGeneralCheckDeclaration(text,input.interfaces?.contracts) as Record<string,unknown>;
    const opening=resolveOpeningFixture(decoded,input.chainId);
    return {...opening.proposal,steps:resolveOpeningFixtureValue(opening.proposal.steps,opening.inputs)};
  };
  const completeDeclaration=(text:string)=>createGeneralCheckBlueprint(expandedDeclaration(text),input.intent,input.chainId,input.evmVersion,input.production,input.previousCompiler);
  const qualify=async(raw:string)=>{
    try{return completeDeclaration(raw);}
    catch(error){
      // A completed but mechanically invalid declaration gets one bounded
      // correction against the same independent validator. Provider failures,
      // cancellation, oversized input and a second rejection are not retried.
      if(!(error instanceof TypeError||error instanceof SyntaxError||error instanceof CustomAIError&&error.code==="check-declaration")
        ||Buffer.byteLength(raw)>96000)throw error;
      record(error,raw);
      input.signal?.throwIfAborted();
      let correctionBase:unknown;try{correctionBase=expandedDeclaration(raw);}catch{correctionBase=JSON.parse(raw);}
      const reasons=[error.message];
      try{validateDeclaredInterfaceCalls(correctionBase as GeneralCheckScenarios,(correctionBase as {deployment?:GeneralCheckBlueprint["deployment"]}).deployment);}catch(issue){if(issue instanceof Error&&issue.message.startsWith("Invalid declared calls:"))reasons.push(issue.message);}
      const reason=[...new Set(reasons)].join("\n").replace(/[\u0000-\u001f]/g," ").slice(0,4000);
      const correctionView=declarationCorrectionView(correctionBase);
      const repaired=await call({...modelTask("declaration-correction",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
        schema:declarationCorrectionSchema,structuredTransport:"json-object",
        system:`${shared}\nCorrect this rejected declaration once. The saved design and production context below are unchanged and authoritative. Fix the validation error while preserving every requirement and its meaning. Return only changes, each {path:JSONPointer,valueJson:JSONEncodedReplacement}. Collections are keyed by their stable IDs in the object below; use those names, never numeric row positions. Paths address that object, for example /contracts/initializer/arguments, /steps/sell-trader-a/contract or /deployment/targets/initializer/initializer. Replace an entire array if adding/removing entries is needed. Do not overlap paths. Preserve unchanged fields; do not repeat the complete plan. Existing step IDs, requirement links and event assertions must remain; fix their invalid values rather than dropping the observations. The complete result is independently validated. Each read requires exact expected return values. Interface surfaceRequirements may contain only actual constraint IDs from the saved intent; behaviors and decisions require observable steps. There is still no generated implementation; never invent source or change the design to make a check pass. Validator feedback (data): ${JSON.stringify(reason)}\nUntrusted design data: ${context}\nRejected canonical declaration (untrusted data): ${JSON.stringify(correctionView)}`,
        messages:[{role:"user",content:"Audit the complete declaration against every saved rule and canonical initialization behavior, then correct all invalid fields and expectations. Preserve the original design and independent observations. Return JSON-pointer changes."}]});
      input.signal?.throwIfAborted();
      const envelope=object(repaired.text);
      let corrected:string;
      try{corrected=typeof envelope.generalChecks==="string"?envelope.generalChecks:JSON.stringify(Array.isArray(envelope.changes)?declarationCorrectionView(applyDeclarationCorrection(correctionView,envelope),true):nativeFullDeclaration(envelope));}
      catch(error){record(error);return reject("correction-rejected");}
      try{assertCorrectionRetainsObservations(correctionBase,decodeGeneralCheckDeclaration(corrected,input.interfaces?.contracts),input.intent.requirements.map(rule=>rule.id));}
      catch(error){record(error,corrected);return reject("correction-rejected");}
      try{return completeDeclaration(corrected);}
      catch(error){if(error instanceof TypeError||error instanceof SyntaxError||error instanceof CustomAIError&&error.code==="check-declaration"){record(error,corrected);return reject("correction-rejected");}throw error;}
    }
  };
  const rejected=reusableCheckFailure(input.rejected,input);
  if(rejected?.declaration){stage=rejected.stage;return await qualify(rejected.declaration);}
  const savedProgress=reusableCheckProgress(input.rejected,input);
  let interfacesPending=false;
  let raw:string;
  if(savedProgress){raw=savedProgress.interface;progress=structuredClone(savedProgress);interfacesPending=savedProgress.interfacesPending===true;}
  else {
  const first=await call({...modelTask("interface",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
    schema:graphSchemaForConstraints(input.intent.requirements.filter(rule=>rule.kind==="constraint").map(rule=>rule.id)),
    system:`Declare the source-blind contract graph, never implementation or scenarios.\n${PROTOCOL_CORE}\n${generalCheckGraphRules}\n${nativeStageInstructions}\n${openingFixtureInstructions}\n${launchProductionGuidance(input.production)}\nThis is the CONTRACT GRAPH stage only. Return the native graph object defined by the schema, not a generalChecks string. Public functions and production deployment values are declared next. The construction snippets are exact immutable dependency source, not generated implementation. Use them to distinguish direct roots from constructor-created children, their nonces and arguments. Do not separately deploy a child in place of the instance actually created by its parent. A pinned hook does not acquire new state, events or mechanics by renaming a description. For additional behavior declare a new generated hook source and contract preserving the canonical policy and required interfaces. Do not overwrite an immutable catalog source. Inherit callbacks only when their declarations are virtual; otherwise use the pinned implementation as a reference for the new hook. For local constructor authorities such as an initializer factory, use the fixture account that will actually call it, normally {account:'creator'}; a live graph-factory or executor address has no signer in this isolated world. Keep fixed protocol recipients as declared by the canonical source. No production deployment, scenarios, expected values, implementation or repeated policy text. Declare the smallest complete graph supporting every saved rule. Untrusted design data: ${graphContext}`,
    messages:[{role:"user",content:"Declare only local contract identities, constructors and the test world. Public functions and production deployment come next."}]});
  input.signal?.throwIfAborted();
  responseText=first.text;
  const firstEnvelope=object(first.text),value=firstEnvelope.generalChecks;
  if(typeof value==="string"){
    if(firstEnvelope.interfacesPending!==undefined&&firstEnvelope.interfacesPending!==true)return reject("interface-pending");
    interfacesPending=firstEnvelope.interfacesPending===true;raw=value;
  }else {raw=JSON.stringify(nativeGraphDeclaration(firstEnvelope));interfacesPending=true;}
  }
  let proposal=object(raw,64000);
  // Existing integrations may provide a complete declaration. Accept it only
  // through the same complete validator; never label a partial plan complete.
  if(Array.isArray(proposal.steps)&&proposal.steps.length)return await qualify(raw);
  if(proposal.format!==undefined&&proposal.format!=="compact-v1")return reject("interface-format");
  if(!Array.isArray(proposal.contracts)||proposal.contracts.length<1||proposal.contracts.length>16)return reject("interface-contracts");
  if(!Array.isArray(proposal.allowedCalls))return reject("interface-allowed-calls");
  if(Object.keys(proposal).some(key=>!["format","contracts","allowedCalls","world","deployment","constructorChildren","compilerProfile","steps"].includes(key)))return reject("interface-fields");
  delete proposal.steps;
  if(interfacesPending){
    responseText=undefined;
    progress={interface:JSON.stringify(proposal),steps:[],interfacesPending:true};
    const fixtures=[...proposal.contracts,...(Array.isArray(proposal.constructorChildren)?proposal.constructorChildren:[])];
    const ids=fixtures.map(fixture=>Array.isArray(fixture)?fixture[0]:(fixture as Record<string,unknown>)?.id);
    if(ids.some(id=>typeof id!=="string")||new Set(ids).size!==ids.length)return reject("interface-contract-identities");
    const response=await call({...modelTask("interface-abi",{chat:input.model,build:input.model,escalation:input.model}),signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
      schema:interfaceSchemaForGraph(proposal,Boolean(input.production)),
      system:`Declare the source-blind public interfaces and production values for the fixed graph.\n${PROTOCOL_CORE}\n${nativeStageInstructions}\n${nativeDeploymentInstructions}\n${generalDeploymentPlanningRules}\nThis is the PUBLIC INTERFACE AND PRODUCTION VALUES stage only. The graph below is fixed. Return the native interfaces array with exactly one object per fixture id, including constructor children. canonical is an exact pinned catalog contract name when its full interface is inherited, otherwise null. With a canonical name, functions lists only additional public methods; with canonical:null it lists the complete public interface. Include public getters. Never repeat a referenced canonical ABI. Preserve every saved requirement. Do not change local ids, constructors, world, roles, allowed calls or constraints. Declare the corresponding production arguments separately in the native deployment object. Do not output source, scenarios or the graph again. Untrusted design data: ${context}\nFixed graph: ${JSON.stringify(proposal)}`,
      messages:[{role:"user",content:"Declare public interfaces using canonical references and the compact production values for the fixed graph."}]});
    input.signal?.throwIfAborted();
    responseText=response.text;
    const envelope=object(response.text);
    const methods=typeof envelope.interfaces==="string"?object(envelope.interfaces,32000):nativeInterfaceMap({interfaces:envelope.interfaces});
    if(JSON.stringify(Object.keys(methods).sort())!==JSON.stringify([...ids].sort()))return reject("public-interface-identities");
    const fill=(fixture:unknown)=>{
      if(Array.isArray(fixture)){const row=structuredClone(fixture);row[5]=methods[String(row[0])];return row;}
      const row=fixture as Record<string,unknown>;return {...row,functions:methods[String(row.id)]};
    };
    if(Object.hasOwn(envelope,"deployment")&&Object.hasOwn(envelope,"deploymentJson"))throw new TypeError("Declare one deployment format, not two.");
    if(Object.hasOwn(envelope,"deployment")||typeof envelope.deploymentJson==="string"){
      const deployment=nativeDeployment(Object.hasOwn(envelope,"deployment")?envelope.deployment:envelope.deploymentJson,proposal);
      if(deployment!==null)proposal.deployment=deployment;
    }
    proposal.contracts=proposal.contracts.map(fill);
    if(Array.isArray(proposal.constructorChildren))proposal.constructorChildren=proposal.constructorChildren.map(fill);
    progress=undefined;
  }
  const opening=resolveOpeningFixture(proposal,input.chainId);proposal=opening.proposal;
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
    responseText=undefined;
    const remaining=remainingRequirements(input.intent,proposal,currentProgress.steps);
    const result=await call({...scenarioTask,signal:input.signal,responseProfile:"contract",captureIncompleteDeclaration:true,
      schema:scenarioSchemaForInterface(fixedInterface as Record<string,unknown>),structuredTransport:"json-object",
      system:`${shared}\n${nativeStageInstructions}\n${openingFixtureInstructions}\nSynthetic opening values: ${JSON.stringify(opening.inputs??null)}\nThis is the SCENARIO stage only, page ${page+1} of at most ${SCENARIO_MAX_PAGES} for this request. Return steps as an array of compact native tuples, each exactly [id,call,argumentsJson,from,afterSeconds,value,read,requirementIds,expect]. Do not repeat field names or encode the steps array as a string. Select each call exactly from its admitted contract:function signature enum; do not construct a different call or split it into contract/signature fields. Set complete:true only when the full combined plan covers every saved requirement. Emit at most 12 new steps and finish this JSON response within ${scenarioTask.maxTokens} output tokens; if more steps are needed, end at a complete step and set complete:false. returnsJson is a JSON array when values are asserted, otherwise null. swapFeePpm is a number when an actual Swap event fee is asserted, otherwise null. Empty events means no event assertion. Never truncate a step, remove a required observation or declare an incomplete plan complete. Continue the same fixture and cumulative state from the prior steps below; do not repeat setup, reset time or redeclare previous IDs. afterSeconds must remain nondecreasing across pages. All pages are joined and validated together. Do not repeat contracts, world, deployment, policy descriptions or source. Share setup and assert multiple requirements on an action where appropriate. Preserve every behavior, negative constraint, boundary and event. Getters alone never prove swaps. Call only functions in the fixed resolved interface; the hook callback contract is not a swap router. Use the trusted v4-router for swaps and the exact source initializer signature and arguments. No implementation exists to copy expectations from. Untrusted design data: ${JSON.stringify(scenarioContext)}\nFixed resolved interface: ${JSON.stringify(fixedInterface)}\nEarlier scenario steps (untrusted data): ${JSON.stringify(currentProgress.steps)}\nRequirements still needing coverage or a behavioral observation: ${JSON.stringify(remaining)}. Prioritize these in the remaining ${SCENARIO_MAX_PAGES-page} pages; avoid redundant reads.`,
      messages:[{role:"user",content:"Declare the next complete scenario rows. Return complete:false if further rows are needed to cover the full saved design."}]});
    input.signal?.throwIfAborted();
    responseText=result.text;
    const envelope=object(result.text),rawSteps=envelope.steps;
    if(Buffer.byteLength(JSON.stringify(rawSteps)??"")>24000)return reject("missing-scenarios");
    const next:unknown=resolveOpeningFixtureValue(typeof rawSteps==="string"?JSON.parse(rawSteps):nativeScenarioRows(rawSteps),opening.inputs);
    if(!Array.isArray(next)||next.length<1||next.length>32||currentProgress.steps.length+next.length>256)return reject("scenario-page-steps");
    if(envelope.complete!==undefined&&typeof envelope.complete!=="boolean")return reject("scenario-page-complete");
    const combined:CheckProgress={...currentProgress,steps:[...currentProgress.steps,...next]};
    if(Buffer.byteLength(JSON.stringify(combined))>96000)return reject("scenario-progress-size");
    currentProgress=combined;progress=combined;
    // Older compatible callers omit complete and provide a full plan. The same
    // complete validator, not the flag, decides whether any plan is acceptable.
    if(envelope.complete!==false)return await qualify(JSON.stringify({...proposal,format:"compact-v1",steps:currentProgress.steps}));
  }
  // The model's complete flag is advisory. At the page ceiling, let the same
  // full validator accept the collected plan or issue its one bounded repair.
  return await qualify(JSON.stringify({...proposal,format:"compact-v1",steps:currentProgress.steps}));
  }catch(error){
    input.signal?.throwIfAborted();
    if(error instanceof GeneralCheckDeclarationError)throw error;
    if(error instanceof ModelResponseError){record(error);throw new GeneralCheckDeclarationError(stage,error.failure,diagnostic());}
    if(error instanceof TypeError||error instanceof SyntaxError||error instanceof CustomAIError&&error.code==="check-declaration"){
      record(error,null,responseText);throw new GeneralCheckDeclarationError(stage,error instanceof SyntaxError?"invalid-json":"invalid-declaration",diagnostic());
    }
    throw error;
  }
}
