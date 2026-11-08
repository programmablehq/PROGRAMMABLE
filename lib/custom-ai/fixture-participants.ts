import {CHECK_ACCOUNTS as accounts} from "./check-accounts";
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);

/** Fixed local signers referenced by a declared v4 example are participants in
 * that same world. Bind their payout/refund targets before source generation;
 * never infer a recipient from source code, a raw address or arbitrary text. */
export function bindDeclaredWorldParticipants(proposal:ObjectValue):ObjectValue {
  if(!object(proposal.world)||!["v4-native-token-v1","v4-protected-native-token-v1"].includes(String(proposal.world.kind))
    ||!Array.isArray(proposal.allowedCalls))return proposal;
  const used=new Set<string>();let nodes=0;
  function visit(value:unknown,depth=0){
    if(depth>24||++nodes>12000)throw new TypeError("Declared fixture participants exceed the plan bounds.");
    if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}
    if(!object(value))return;
    if(Object.keys(value).length===1&&accounts.includes(value.account as typeof accounts[number]))used.add(String(value.account));
    for(const item of Object.values(value))visit(item,depth+1);
  }
  visit(proposal.contracts);visit(proposal.constructorChildren);visit(proposal.steps);
  if(Array.isArray(proposal.steps))for(const step of proposal.steps){
    if(object(step)&&accounts.includes(step.from as typeof accounts[number]))used.add(String(step.from));
    // Compact declarations use the same fixed sender slot.
    if(Array.isArray(step)&&accounts.includes(step[4] as typeof accounts[number]))used.add(String(step[4]));
  }
  const existing=proposal.allowedCalls;
  const missing=accounts.filter(account=>used.has(account)&&!existing.some(value=>object(value)&&Object.keys(value).length===1&&value.account===account));
  return missing.length?{...proposal,allowedCalls:[...existing,...missing.map(account=>({account}))]}:proposal;
}
