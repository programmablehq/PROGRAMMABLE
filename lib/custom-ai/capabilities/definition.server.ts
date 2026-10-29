import "server-only";
import { createHash } from "node:crypto";
import type { ToolCapability } from "./types";
export const lookupInputSchema = { type: "object", properties: {
  query: { type: "string", maxLength: 500 }, chainId: { enum: [1, 4663] },
  address: { type: "string", maxLength: 42 },
}, required: ["query", "chainId", "address"], additionalProperties: false };
export function defineTool(id: string, description: string, execute: ToolCapability["execute"],
  available: ToolCapability["available"] = () => true, inputSchema: object = lookupInputSchema): ToolCapability {
  const version = "1.0.0";
  const implementationHash = createHash("sha256").update(JSON.stringify({ id, version, description, inputSchema, execute: execute.toString() })).digest("hex");
  return { ref: { id, version, implementationHash }, kind: "tool", description, inputSchema, execute, available };
}
