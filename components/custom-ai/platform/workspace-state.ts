import type {AIUsage} from "@/lib/custom-ai/types";
import type {PlatformAPI,ProjectRevision,ProjectRun,ProjectRunState} from "./types";
import {containsInlineCredential} from "@/lib/custom-ai/platform/secret-input";

export type WorkStep={cursor:string;capabilityId:string;ok?:boolean;message?:string};
export type WorkProgress={events:WorkStep[];activeStep?:{capabilityId:string;state:string}};
export type MessageIntent={
  version:1;id:string;projectId:string;prompt:string;operation:ProjectRun["operation"];preview:boolean;
  revisionId?:string;nameNeeded:boolean;
  request?:{projectId:string;revisionId:string;operation:ProjectRun["operation"];prompt:string;idempotencyKey:string;budgetUnits:number};
};
export type ResultIntent={projectId:string;runId:string;preview:boolean};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const revision=/^sha256:[a-f0-9]{64}$/;
const modes=new Set(["build","plan","test","deploy"]);

export function projectTitle(prompt:string){
  const first=prompt.trim().split(/\r?\n/)[0].replace(/\s+/g," ");
  const title=first.replace(/^(?:please\s+)?(?:build|create|make|design)\s+(?:me\s+)?(?:an?\s+)?/i,"")
    .replace(/^(?:bitte\s+)?(?:baue?|erstelle|entwickle)\s+(?:mir\s+)?(?:eine?n?\s+)?/i,"");
  const text=title||first;
  return (text.charAt(0).toLocaleUpperCase()+text.slice(1)).slice(0,80).trim()||"New project";
}

export function readMessageIntent(value:unknown):MessageIntent|undefined{
  if(!value||typeof value!=="object")return;
  const v=value as MessageIntent;
  if(v.version!==1||!uuid.test(v.id)||!uuid.test(v.projectId)||typeof v.prompt!=="string"||!v.prompt.trim()||v.prompt.length>24000
    ||containsInlineCredential(v.prompt)||!modes.has(v.operation)||typeof v.preview!=="boolean"||typeof v.nameNeeded!=="boolean"
    ||v.revisionId!==undefined&&!revision.test(v.revisionId))return;
  if(v.request&&(v.request.projectId!==v.projectId||v.request.prompt!==v.prompt||v.request.operation!==v.operation
    ||v.request.idempotencyKey!==v.id||!revision.test(v.request.revisionId)||!Number.isInteger(v.request.budgetUnits)
    ||v.request.budgetUnits<1||v.request.budgetUnits>20))return;
  return v;
}

/** Each acknowledged phase is journaled before the next mutation. Retrying an
 * uncertain response uses the same project, title receipt and work request. */
export async function sendWorkspaceMessage(intent:MessageIntent,api:PlatformAPI,usage:()=>Promise<AIUsage>,save:(intent:MessageIntent)=>Promise<void>){
  if(!readMessageIntent(intent))throw Error("The saved message could not be read. Reload your saved work.");
  await save(intent);
  if(!intent.revisionId){
    const {project}=await api<{project:ProjectRevision}>("/projects",{body:{projectId:intent.projectId}});
    intent.revisionId=project.revisionId;await save(intent);
  }
  if(intent.nameNeeded){
    const {project}=await api<{project:ProjectRevision}>("/projects",{method:"PATCH",body:{projectId:intent.projectId,
      expectedRevisionId:intent.revisionId,idempotencyKey:`entry:${intent.id}`,patch:{title:projectTitle(intent.prompt)}}});
    intent.revisionId=project.revisionId;intent.nameNeeded=false;await save(intent);
  }
  if(!intent.request){
    const available=await usage(),budgetUnits=Math.min(20,available.hourly.remaining,available.daily.remaining);
    if(!Number.isSafeInteger(budgetUnits)||budgetUnits<1)throw Error("Your work allowance is used up. Your message is saved; continue when it resets.");
    intent.request={projectId:intent.projectId,revisionId:intent.revisionId,operation:intent.operation,prompt:intent.prompt,idempotencyKey:intent.id,budgetUnits};
    await save(intent);
  }
  const {run}=await api<{run:ProjectRunState}>("/runs",{body:intent.request});
  return {...run,prompt:intent.prompt,operation:intent.operation};
}

const activeLabels:Record<string,string>={
  "model.plan":"Planning the next step", "project.read":"Reading your saved project", "project.plan":"Saving your requirements",
  "project.patch":"Updating your files", "project.dependencies":"Preparing dependencies", "project.check":"Checking your app",
  "sandbox.command":"Running in the sandbox", "contract.compile":"Compiling your contract", "contract.check":"Checking contract behavior",
  "contract.audit":"Reviewing the source", "contract.dependencies":"Preparing contract dependencies", "project.publish":"Building your preview",
  "contract.verify":"Compiling and checking your contract",
  "research.package":"Checking the current package release", "research.read":"Reading the official documentation",
  "contract.context":"Reading the current chain profile", "contract.library":"Reading the contract library",
  "project.promote":"Confirming publication", "app.schedule":"Setting up the task", "event.record":"Saving the game connection",
  "event.identity":"Preparing the game connection", "repository.import":"Importing your files", "repository.deliver":"Exporting your project",
  "connector.read":"Reading the connected API", "connector.write":"Running the connected action",
};
const finishedLabels:Record<string,string>={
  "project.plan":"Requirements saved", "project.patch":"Files saved", "project.dependencies":"Dependencies saved",
  "project.check":"App checks recorded", "contract.compile":"Compilation recorded", "contract.check":"Contract checks recorded",
  "contract.audit":"Source review recorded", "project.publish":"Preview request saved", "project.promote":"Publication result recorded",
  "contract.verify":"Compilation and behavior checks recorded",
  "app.schedule":"Task saved", "repository.import":"Files imported", "repository.deliver":"Export recorded",
  "event.record":"Game connection saved", "connector.read":"API response received", "connector.write":"Connected action recorded",
};
export function workStatus(run:ProjectRun,progress?:WorkProgress){
  if(run.status==="queued")return "Waiting for a worker";
  if(run.status==="running")return progress?.activeStep?.state==="unknown"?"Confirming the last action":activeLabels[progress?.activeStep?.capabilityId??""]??"Working on your project";
  if(run.status==="waiting_user")return "Your input is needed";
  if(run.status==="retryable")return "Interrupted · progress saved";
  if(run.status==="cancelled")return "Stopped · progress saved";
  if(run.status==="failed")return run.summary==="run-budget"?"Work limit reached · progress saved":"Needs attention · progress saved";
  return run.operation==="plan"?"Ready":run.operation==="test"?"Checks finished":"Work completed";
}
export function workExplanation(progress?:WorkProgress){
  if(progress?.activeStep?.capabilityId==="model.plan")return;
  return progress?.events.findLast(step=>step.capabilityId==="model.plan"&&step.message)?.message;
}
export function completedWork(progress?:WorkProgress){return [...new Set((progress?.events??[]).filter(step=>step.ok!==false).map(step=>finishedLabels[step.capabilityId]).filter(Boolean))].slice(-4);}
export function resultTab(project:ProjectRevision,operation:ProjectRun["operation"]):"project"|"runtime"|"files"{
  if(operation==="plan")return "project";
  const plan=project.document.architecture&&typeof project.document.architecture==="object"&&!Array.isArray(project.document.architecture)?project.document.architecture:undefined;
  if(plan?.application||["application","contract","legacy-contract"].includes(String(plan?.kind)))return "runtime";
  return Object.keys(project.document.files).length?"files":"project";
}
