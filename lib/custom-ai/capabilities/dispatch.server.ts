import "server-only";
import Ajv from "ajv";
import { CustomAIError } from "../types";
import { safeKnowledgeSources } from "../knowledge";
import { getCapabilities, sameCapability } from "./registry.server";
import type { CapabilityContext, CapabilityRef, ToolCapability } from "./types";
const ajv = new Ajv({ strict: false, allErrors: false });
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();
export async function dispatchTool(ref: CapabilityRef, input: unknown, context: CapabilityContext, entries?: readonly ToolCapability[]) {
  context.signal?.throwIfAborted();
  const tool = getCapabilities(context, entries).find(entry => sameCapability(entry.ref, ref));
  if (!tool) throw new CustomAIError("capability", "That capability is not available for this request.", 422);
  let validate = validators.get(tool.inputSchema);
  if (!validate) { validate = ajv.compile(tool.inputSchema); validators.set(tool.inputSchema, validate); }
  if (!validate(input)) throw new CustomAIError("capability_input", "That lookup needs different details.", 422);
  if (!Number.isSafeInteger(context.budget.remaining) || context.budget.remaining < 1) throw new CustomAIError("lookup_budget", "The lookup limit for this request is reached.", 429);
  context.budget.remaining--;
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(context.signal ? [context.signal] : [])]);
  const result = await tool.execute(input, { ...context, signal });
  signal.throwIfAborted();
  if (!result || typeof result.status !== "string" || result.status.length > 100 || JSON.stringify(result).length > 32_000 || !Array.isArray(result.sources)) {
    throw new CustomAIError("capability_output", "The lookup returned an incomplete result.", 502);
  }
  return { ...result, sources: safeKnowledgeSources(result.sources) };
}
