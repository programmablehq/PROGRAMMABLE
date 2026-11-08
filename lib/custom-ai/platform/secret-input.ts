/** Shared by prompt admission and result redaction. This detects recognizable
 * credentials; opaque arbitrary strings cannot be identified reliably. */
import type {JsonValue} from "./types";
const credentialPattern=()=>/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16})\b/g;
const assignmentPattern=()=>/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|private[_-]?key|authorization)["']?\s*[:=]\s*["']?((?:Bearer[ \t]+)?[A-Za-z0-9_./+=-]{16,})/gi;
const reference=(value:string)=>/^(?:process\.env\.|import\.meta\.env\.|Deno\.env\.|YOUR_|PLACEHOLDER|EXAMPLE_)/i.test(value);
export function containsInlineCredential(text:string):boolean{
  return credentialPattern().test(text)||[...text.matchAll(assignmentPattern())].some(match=>!reference(match[1]));
}
export function redactInlineCredentials(text:string):string{
  return text.replace(credentialPattern(),"[redacted]").replace(assignmentPattern(),(match:string,value:string)=>reference(value)?match:match.slice(0,match.indexOf(value))+"[redacted]");
}
export function redactCredentialData(value:JsonValue):JsonValue{
  if(typeof value==="string")return redactInlineCredentials(value);
  if(Array.isArray(value))return value.map(redactCredentialData);
  if(value&&typeof value==="object"){
    const entries=Object.entries(value),names=new Set(entries.map(([key])=>key));
    return Object.fromEntries(entries.map(([key,item],index)=>{
      let name=key;
      if(redactInlineCredentials(key)!==key){
        name=`[redacted-key-${index}]`;
        while(names.has(name))name+="_";
        names.add(name);
      }
      return [name,/^(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|private[-_]?key)$/i.test(key)&&typeof item==="string"&&item?"[redacted]":redactCredentialData(item)];
    }));
  }
  return value;
}
