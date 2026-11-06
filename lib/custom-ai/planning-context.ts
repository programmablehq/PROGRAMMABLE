import type {ChatRequest,Draft} from "./types";
import type {LaunchIntent} from "./launch-intent";
import type {RuleSpecV2} from "./rule-spec";
import type {GeneralProjectDraft} from "./general-builder.server";
import {generalProjectView,type GeneralProjectView} from "./project-view";
import type {ContractProject} from "./contract-project";
import {dependencySourceContext} from "./dependency-source-context";
import type {LaunchProductionContext} from "./launch-production";
import type {ProductBlueprint} from "./product/blueprint";
import {reviewProductEconomics} from "./product/economics";
import {executionContext} from "./execution-trace";

export function plannerNeedsExecution(request:ChatRequest) {
  return /\b(simulat\w*|scenarios?|examples?|receipts?|results?|beispiele?|szenari\w*|ergebn\w*)\b/i.test(request.messages.at(-1)?.content??"");
}

/** Only compact the executable vocabulary for an ordinary rate/schedule.
 * This does not choose the route or remove any saved requirement. */
export function simpleFeePlanning(request:ChatRequest,intent?:LaunchIntent) {
  const text=[request.messages.at(-1)?.content??"",...(intent?.requirements.map(rule=>rule.text)??[])].join(" ");
  return /\b(?:fees?|tax|geb[uü]hr\w*|projektfees)\b/i.test(text)&&/\d\s*(?:%|percent|prozent|bps)/i.test(text)
    &&!/(?:oracle|weather|wetter|feed|api\b|snapshot|holder|reward|reinvest|buy.?back|burn|vault|liquidity|liquidit|payout|airdrop|volume|volumen|price|preis|mint|supply|blacklist|whitelist|cap\b|limit|auction|bonding|curve|transfer|vesting|perpetual|funding|loyalty|treue|random|zufall|counter|zähler|zaehler|custom|arbitrary|code|contract|solidity|hookdata|router)/i.test(text);
}

/** Policy and known infrastructure are relevant to a conversation. The full
 * execution graph is retained by the server and supplied to source planning. */
export function planningProductionContext(context:LaunchProductionContext) {
  return {version:context.version,chainId:context.chainId,route:context.route,profileVersion:context.profileVersion,
    tradeFee:{policyVersion:context.tradeFee.policyVersion,ratePpm:context.tradeFee.ratePpm,collection:context.tradeFee.collection},
    protections:context.protections,
    ...(context.protectionPolicy?{protectionPolicy:{required:context.protectionPolicy.required,appliesTo:context.protectionPolicy.appliesTo}}:{}),
    configuredInfrastructure:{poolManager:true,executor:true,protectionBindings:Boolean(context.protectionBindings)}};
}

/** Source inspection is opt-in for checked drafts. Older drafts without a
 * verified behavior record retain their full source context. This changes
 * model input size; it never chooses a build or authorizes an edit. */
export function plannerNeedsSource(request:ChatRequest,draft?:Draft,project?:GeneralProjectDraft|GeneralProjectView){
  const inspection=/\b(source|code|contract|solidity|bytecode|function|implementation|audit|quellcode|vertrag|funktion|implementierung|zeile)\b|```/i.test(request.messages.at(-1)?.content??"");
  if(project)return inspection;
  if(!draft)return false;
  const checked=draft.compiled&&draft.verification?.status==="passed"
    &&draft.verification.sourceHash===draft.sourceHash&&Array.isArray(draft.verification.requirements)&&draft.verification.requirements.length>0
    &&Array.isArray(draft.verification.checks)&&draft.verification.checks.length>0;
  return !checked||inspection;
}
export function modelIntentContext(intent:LaunchIntent) {
  return {version:intent.version,id:intent.id,revision:intent.revision,parentRevision:intent.parentRevision,
    requirements:intent.requirements.map(({id,text,kind,open})=>({id,text,kind,open})),unresolved:intent.unresolved};
}
export function modelDesignContext(input:{memory?:string;ruleSpec?:RuleSpecV2;intent?:LaunchIntent;productBlueprint?:ProductBlueprint;editTarget?:ChatRequest["editTarget"];draft?:Draft;generalProject?:GeneralProjectDraft;generalProjectView?:GeneralProjectView;canonicalSources?:ContractProject["sources"];includeExecution?:boolean},includeSource:boolean){
  const {draft,intent,generalProject}=input;
  const projectView=generalProject?generalProjectView(generalProject):input.generalProjectView;
  const original=includeSource&&generalProject?generalProject.project.sources:undefined;
  const fixed=original?Object.fromEntries(Object.entries(original).filter(([path,source])=>input.canonicalSources?.[path]?.content===source.content)):undefined;
  const dependencies=fixed?dependencySourceContext(fixed):undefined;
  const sources=original?{...original,...dependencies?.modelSources}:undefined;
  return {
    memory:input.memory,ruleSpec:input.ruleSpec,editTarget:input.editTarget,productBlueprint:input.productBlueprint,
    ...(input.productBlueprint?{productEconomics:reviewProductEconomics(input.productBlueprint)}:{}),
    // Full provenance and change history stay in the server-owned revision.
    // The model needs every stable rule and open choice, not repeated quotes.
    intent:intent?modelIntentContext(intent):undefined,
    currentDraft:draft?{sourceHash:draft.sourceHash,...(includeSource?{source:draft.source}:{}),hookSummary:draft.hookSummary,
      compiled:draft.compiled,validation:draft.validation?.status??"not-run",
      verification:draft.compiled&&draft.verification?.sourceHash===draft.sourceHash?draft.verification.status:"not-run",
      ...(draft.lifecycle?{lifecycle:{status:draft.lifecycle.status,scope:draft.lifecycle.scope}}:{}),
      requirements:draft.verification?.requirements,feeChecks:draft.verification?.checks,program:draft.program?.spec,eventRule:draft.feed?.rule,
      sourceIncluded:includeSource}:null,
    ...(projectView?{generalProject:{projectHash:projectView.projectHash,chainId:projectView.chainId,summary:projectView.summary,
      entrypoints:projectView.entrypoints,compiler:projectView.compiler,compiled:projectView.compiled,
      ...(projectView.implementation?{boundSourceActions:{evidence:projectView.implementation.evidence,deployed:false,actions:projectView.implementation.actions}}:{}),
      ...(projectView.blueprintId?{declaredChecks:{blueprintId:projectView.blueprintId,...(projectView.scenarios?{scope:projectView.scenarios.scope,passed:projectView.scenarios.passed,cases:projectView.scenarios.cases,failures:projectView.scenarios.failures}:{state:"pending"})}}:{}),
      ...(input.includeExecution&&projectView.scenarios?.execution?{simulation:executionContext(projectView.scenarios.execution)}:{}),
      verification:"not-run",sourceIncluded:includeSource&&Boolean(generalProject),...(sources&&generalProject?{sources,
        ...(dependencies&&Object.keys(fixed!).length?{dependencyView:dependencies.view}:{}),
        ...(generalProject.project.deployment?{deployment:generalProject.project.deployment}:{})}:{})}}:{}),
  };
}
