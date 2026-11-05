import "server-only";
import Ajv, { type ErrorObject } from "ajv";
import { CustomAIError } from "./types";
import type { ModelSchemaFailure } from "./request-metrics";

export class SurplusSchemaError extends CustomAIError {
  declare readonly schemaFailure: ModelSchemaFailure;
  constructor(diagnostic:ModelSchemaFailure){
    super("response","The AI response did not match the requested design. Your draft is saved.",502);
    Object.defineProperty(this,"schemaFailure",{value:diagnostic,enumerable:false});
  }
}
const diagnosticFields=new Set(["reply","summary","sourceFiles","path","content","entrypoints","source","contract","role","requirementIds",
  "action","executionRoute","intentMode","intentRequirements","ruleEdits","implementedRequirementIds","setupPatch","lookups","feeChecks",
  "memory","replyLocale","launchRequested","reviseChecks","composable","program","eventRule","name","symbol","chainId","pairToken","initialBuy","description","website","x","socialPost"]);
function schemaDiagnostic(errors:ErrorObject[]|null|undefined):ModelSchemaFailure {
  return {kind:"schema",issues:(errors??[]).slice(0,8).map(error=>({
    // Unknown or model-chosen object keys can contain private text. Never keep them.
    path:[...error.instancePath.split("/"),...((error.params.missingProperty??error.params.additionalProperty)!==undefined
      ?[String(error.params.missingProperty??error.params.additionalProperty)]:[])].map((part,index)=>index===0?"":diagnosticFields.has(part)||/^\d{1,5}$/u.test(part)?part:"*").join("/").slice(0,180),
    keyword:error.keyword,
    ...(Number.isSafeInteger(error.params.limit)?{expected:error.params.limit as number}:{}),
  }))};
}

type Schema = {
  [key: string]: unknown;
  type?: string | string[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  items?: Schema | Schema[];
};

/** Some sellers serialize their structured response as a named parameter
 * envelope. Read only data fields from that exact envelope; never execute
 * a tool, accept an unknown field, or infer missing values. */
function structuredParameters(text: string, schema: Schema): string | undefined {
  if (!/^\s*<invoke\s+name="structured_output"/u.test(text)) return undefined;
  const invalid = (): never => { throw new SurplusSchemaError({kind:"json",issues:[]}); };
  const envelope = /^\s*<invoke name="structured_output">\s*([\s\S]*?)\s*<\/invoke>\s*$/u.exec(text);
  if (!envelope || !schema.properties) return invalid();
  const body = envelope[1], fields: Record<string, unknown> = Object.create(null);
  const parameter = /<parameter name="([A-Za-z][A-Za-z0-9_]{0,63})">([\s\S]*?)<\/parameter>\s*/guy;
  let position = 0;
  while (position < body.length) {
    parameter.lastIndex = position;
    const match = parameter.exec(body);
    if (!match) return invalid();
    const [,name,raw] = match;
    if (!Object.hasOwn(schema.properties,name) || Object.hasOwn(fields,name) || /<\/?(?:parameter|invoke)\b/u.test(raw)) return invalid();
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { if (schema.properties[name].type !== "string") return invalid(); value = raw; }
    // A wire string may itself hold JSON, as it does for paged scenarios and
    // object unions. Preserve that string for the existing strict decoder.
    fields[name] = schema.properties[name].type === "string" && typeof value !== "string" ? raw : value;
    position = parameter.lastIndex;
  }
  return JSON.stringify(fields);
}

/** The Claude bridge normalizes object unions into an invalid anyOf envelope. */
export function prepareSurplusSchema(original: object, validateOriginal = false) {
  let changed = false;
  const validationOnly = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties"]);
  const needsEncoding = (node: Schema) => Boolean(node.anyOf || Array.isArray(node.type) && node.type.includes("object"));
  const nullableObject = (node: Schema) => Array.isArray(node.type) && node.type.includes("object") && node.type.includes("null")
    && node.type.every(type => type === "object" || type === "null");
  function transport(node: Schema): Schema {
    if (needsEncoding(node)) {
      changed = true;
      return { type: "string", description: `A JSON-encoded value matching this exact schema. Encode the complete value as a JSON string: ${JSON.stringify(node)}${nullableObject(node) ? ' For an absent optional object, return the string "null".' : ""}` };
    }
    const wire = { ...node };
    const constraints = Object.fromEntries(Object.entries(node).filter(([key]) => validationOnly.has(key)));
    if (Object.keys(constraints).length) {
      changed = true;
      for (const key of Object.keys(constraints)) delete wire[key];
      wire.description = `${typeof node.description === "string" ? node.description + " " : ""}The value must satisfy these constraints: ${JSON.stringify(constraints)}`;
    }
    return { ...wire,
      ...(node.properties ? { properties: Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, transport(value)])) } : {}),
      ...(node.items ? { items: Array.isArray(node.items)?node.items.map(item=>transport(item)):transport(node.items) } : {}),
    };
  }
  const schema = transport(original as Schema);
  const root = original as Schema;
  const replyOnly = root.type === "object" && root.additionalProperties === false
    && Object.keys(root.properties ?? {}).join() === "reply" && root.properties?.reply.type === "string"
    && Array.isArray(root.required) && root.required.length === 1 && root.required[0] === "reply";
  // Keep compiler ownership local: planner schemas are new objects per request.
  // An AJV-wide schema cache would retain every request's schema indefinitely.
  let validate = changed || validateOriginal || replyOnly ? new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(original) : undefined;
  function restore(value: unknown, node: Schema): unknown {
    if (needsEncoding(node)) {
      // The gateway may already return the canonical object or null instead
      // of its string transport form. Preserve it and validate the entire
      // response against the unchanged original schema below.
      // Some sellers serialize an absent optional object as an empty wire
      // string. This is only null for an object/null union, never a missing
      // required object, malformed configuration or arbitrary tool input.
      if (value === "" && nullableObject(node)) return null;
      return typeof value === "string" ? JSON.parse(value) : value;
    }
    if (Array.isArray(value) && node.items) return value.map((item,index) => {
      const schema=Array.isArray(node.items)?node.items[index]:node.items;return schema?restore(item,schema):item;
    });
    if (value && typeof value === "object" && !Array.isArray(value) && node.properties) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, node.properties![key] ? restore(item, node.properties![key]) : item]));
    }
    return value;
  }
  return { schema, decode(text: string) {
    const parameters = structuredParameters(text,schema);
    if (parameters !== undefined) {
      text = parameters;
      validate ??= new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(original);
    }
    // Some compatible sellers wrap complete JSON in one code fence. Select
    // only an unambiguous single JSON block; extra JSON or code still fails.
    const fence=/^\s*```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```\s*$/iu.exec(text);
    const blocks=[...text.matchAll(/(?:^|\r?\n)```json[ \t]*\r?\n([\s\S]*?)\r?\n```(?=$|\r?\n)/giu)];
    const block=blocks.length===1?blocks[0]:undefined;
    const outside=block?text.slice(0,block.index)+text.slice(block.index+block[0].length):"";
    let normalized=fence?fence[1]:block&&!/[\{\[]|```/u.test(outside)?block[1]:text;
    if((normalized.match(/```/gu)??[]).length===1&&/\r?\n```\s*$/u.test(normalized))normalized=normalized.replace(/\r?\n```\s*$/u,"");
    const start=normalized.indexOf("{"),end=normalized.lastIndexOf("}");
    // Read one data object from a seller's text wrapper. Never interpret its
    // tags or prose as actions, and reject competing objects/arrays or fences.
    if(start>=0&&end>=start&&!/[{}\[\]]|```/u.test(normalized.slice(0,start)+normalized.slice(end+1)))normalized=normalized.slice(start,end+1);
    if (!validate) return normalized;
    let restored:unknown;
    try { restored=restore(JSON.parse(normalized),original as Schema); }
    catch {
      // A reply-only request has no action or editable fields. Some sellers
      // return its answer as plain text despite JSON mode. Preserve that text
      // literally; never use this recovery for planners or contract source.
      if (!replyOnly || !normalized.trim() || normalized.length > 4000
        || /[{}\[\]`]|<\/?(?:invoke|parameter)\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/iu.test(normalized))
        throw new SurplusSchemaError({kind:"json",issues:[]});
      restored = { reply: normalized.trim() };
    }
    if(!validate(restored))throw new SurplusSchemaError(schemaDiagnostic(validate.errors));
    return JSON.stringify(restored);
  } };
}
