import {redactInlineCredentials} from "./secret-input";

type Data=Record<string,unknown>;
const object=(value:unknown):value is Data=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
/** Public progress contains plain, bounded explanations, never tool arguments,
 * source, provider traces, connection values or arbitrary result envelopes. */
export function projectStepProgress(capability:string,result:unknown){
  if(!object(result))return {};
  if(capability==="model.plan")return typeof result.message==="string"&&result.kind==="tool"?{message:redactInlineCredentials(result.message).slice(0,600)}:{};
  if(typeof result.ok!=="boolean")return {};
  const value=object(result.value)?result.value:undefined;
  const failed=result.ok===false||value?.passed===false||value?.compiled===false||value?.status==="changes_required";
  return {ok:!failed,...(result.ok===false&&typeof result.message==="string"?{message:redactInlineCredentials(result.message).slice(0,600)}:{})};
}
