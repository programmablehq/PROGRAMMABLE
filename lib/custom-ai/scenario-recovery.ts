import {scenarioSchemaForInterface} from "./check-stage-wire";
import {prepareSurplusSchema} from "./surplus-schema.server";

/** A seller sometimes writes {"call":"…"} .call where JSON requires the
 * string itself. Unwrap only that literal spelling, never evaluate code.
 * The complete, unchanged scenario schema still decides acceptance. */
export function recoverScenarioPage(response:string, fixedInterface:Record<string,unknown>):string|undefined {
  if(new TextEncoder().encode(response).length>96_000)return;
  const format=prepareSurplusSchema(scenarioSchemaForInterface(fixedInterface),true);
  try{return format.decode(response);}catch{/* Try the one lossless literal form below. */}
  const literal=/^\{\s*"call"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}\s*\.\s*call(?![\w$])/u;
  let quoted=false,escaped=false,start=0,count=0,output="";
  for(let index=0;index<response.length;index++){
    const char=response[index];
    if(quoted){
      if(escaped)escaped=false;
      else if(char==="\\")escaped=true;
      else if(char==='"')quoted=false;
      continue;
    }
    if(char==='"'){quoted=true;continue;}
    if(char!=="{")continue;
    const match=literal.exec(response.slice(index));
    if(!match)continue;
    if(++count>16)return;
    try{if(typeof JSON.parse(match[1])!=="string")return;}catch{return;}
    output+=response.slice(start,index)+match[1];
    index+=match[0].length-1;start=index+1;
  }
  if(!count||quoted)return;
  output+=response.slice(start);
  try{
    JSON.parse(output);
    return format.decode(output);
  }catch{return;}
}
