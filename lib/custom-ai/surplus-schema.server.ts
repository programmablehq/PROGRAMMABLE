import "server-only";
import Ajv from "ajv";
import { CustomAIError } from "./types";

type Schema = {
  [key: string]: unknown;
  type?: string | string[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  items?: Schema;
};

/** The Claude bridge normalizes object unions into an invalid anyOf envelope. */
export function prepareSurplusSchema(original: object) {
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
      ...(node.items ? { items: transport(node.items) } : {}),
    };
  }
  const schema = transport(original as Schema);
  // Keep compiler ownership local: planner schemas are new objects per request.
  // An AJV-wide schema cache would retain every request's schema indefinitely.
  const validate = changed ? new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false }).compile(original) : undefined;
  function restore(value: unknown, node: Schema): unknown {
    if (needsEncoding(node)) {
      if (typeof value !== "string") throw Error("Expected encoded union");
      return JSON.parse(value);
    }
    if (Array.isArray(value) && node.items) return value.map(item => restore(item, node.items!));
    if (value && typeof value === "object" && !Array.isArray(value) && node.properties) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, node.properties![key] ? restore(item, node.properties![key]) : item]));
    }
    return value;
  }
  return { schema, decode(text: string) {
    if (!validate) return text;
    try {
      const restored = restore(JSON.parse(text), original as Schema);
      if (!validate(restored)) throw Error("Original schema rejected response");
      return JSON.stringify(restored);
    } catch {
      throw new CustomAIError("response", "The AI response did not match the requested design. Your draft is saved.", 502);
    }
  } };
}
