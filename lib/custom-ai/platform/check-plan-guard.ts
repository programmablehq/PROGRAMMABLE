import {canonicalProjectJSON} from "./document";
import {ProjectError,type JsonValue,type ProjectRevision} from "./types";
const record=(value:unknown):value is Record<string,JsonValue>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const array=(value:unknown)=>Array.isArray(value)?value.filter(record):[];

/** Once source exists, a failed implementation cannot redefine its own target.
 * Explicit user-grounded requirement changes still permit their linked checks
 * to change. New cases may extend coverage without weakening saved cases. */
export function assertSavedCheckPlan(previous:Pick<ProjectRevision,"document">,requirements:ProjectRevision["document"]["requirements"],architecture:JsonValue){
  if(!Object.keys(previous.document.files).length||!record(previous.document.architecture))return;
  const before=previous.document.architecture,next=record(architecture)?architecture:{};
  const oldRules=new Map(previous.document.requirements.map(rule=>[rule.id,canonicalProjectJSON([rule.text,rule.kind,rule.open])]));
  const nextRules=new Map(requirements.map(rule=>[rule.id,canonicalProjectJSON([rule.text,rule.kind,rule.open])]));
  const changed=new Set([...oldRules.keys(),...nextRules.keys()].filter(id=>oldRules.get(id)!==nextRules.get(id)));
  const fail=()=>{throw new ProjectError("project-check-target","The saved behavior checks are the target for this implementation. Keep their expected results, calls, callers and timing. Repair the source. If the plan itself is wrong, explain the mismatch and ask for an explicit requirement correction before changing its linked checks.",409);};
  const preserve=(oldItems:Record<string,JsonValue>[],newItems:Record<string,JsonValue>[])=>{
    for(const old of oldItems){
      const replacement=newItems.find(item=>item.id===old.id);
      if(canonicalProjectJSON(old)===canonicalProjectJSON(replacement??null))continue;
      if(!Array.isArray(old.requirementIds)||!old.requirementIds.some(id=>typeof id==="string"&&changed.has(id)))fail();
    }
  };
  preserve(array(before.checks),array(next.checks));
  if(record(before.contractChecks)){
    const target=record(next.contractChecks)?next.contractChecks:{};
    preserve(array(before.contractChecks.steps),array(target.steps));
    if(!changed.size)for(const field of ["world","allowedCalls","deployment"]){
      if(canonicalProjectJSON(before.contractChecks[field]??null)!==canonicalProjectJSON(target[field]??null))fail();
    }
  }
}
