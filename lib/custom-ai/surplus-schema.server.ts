import "server-only";
import Ajv from "ajv";
import { CustomAIError } from "./types";

type Schema = {
  [key: string]: unknown;
  type?: string | string[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  items?: Schema | Schema[];
};

/** The Claude bridge normalizes object unions into an invalid anyOf envelope. */
export function prepareSurplusSchema(original: object, validateOriginal = false) {
  let changed = false;
  const validationOnly = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties"]);
  const needsEncoding = (node: Schema) => Boolean(node.anyOf || Array.isArray(node.type) && node.type.includes("object"));
  function transport(node: Schema): Schema {
    if (needsEncoding(node)) {
      changed = true;
      return { type: "string", description: `A JSON-encoded value matching this exact schema. Encode the complete value as a JSON string: ${JSON.stringify(node)}` };
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
  // Keep compiler ownership local: planner schemas are new objects per request.
  // An AJV-wide schema cache would retain every request's schema indefinitely.
  const validate = changed || validateOriginal ? new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(original) : undefined;
  function restore(value: unknown, node: Schema): unknown {
    if (needsEncoding(node)) {
      // The gateway may already return the canonical object or null instead
      // of its string transport form. Preserve it and validate the entire
      // response against the unchanged original schema below.
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
    try {
      const restored = restore(JSON.parse(normalized), original as Schema);
      if (!validate(restored)) throw Error("Original schema rejected response");
      return JSON.stringify(restored);
    } catch {
      throw new CustomAIError("response", "The AI response did not match the requested design. Your draft is saved.", 502);
    }
  } };
}
