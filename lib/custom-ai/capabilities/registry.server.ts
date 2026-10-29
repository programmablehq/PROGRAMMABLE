import "server-only";
import catalog from "./catalog-search/index.server";
import web from "./web-search/index.server";
import contract from "./contract-read/index.server";
import searchHooks from "./search-hooks/index.server";
import type { CapabilityContext, CapabilityRef, ToolCapability } from "./types";
import { AI_CONFIG, type ExecutionProfile } from "../ai-config";
import { CustomAIError } from "../types";

const registry: readonly ToolCapability[] = [catalog, web, contract, searchHooks];
export function getCapabilities(context: CapabilityContext, entries = registry) {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.ref.id)) throw Error("Duplicate capability registration");
    ids.add(entry.ref.id);
  }
  return entries.filter(entry => entry.available(context));
}
export function capabilityMetadata(entries: readonly ToolCapability[]) {
  return entries.map(({ ref, kind, description, inputSchema }) => ({ ref, kind, description, inputSchema }));
}
export function executionProfile(entries: readonly ToolCapability[]): ExecutionProfile {
  return { aiConfigId: AI_CONFIG.id, aiConfigVersion: AI_CONFIG.version, capabilities: entries.map(entry => entry.ref) };
}
export function assertExecutionProfile(profile: ExecutionProfile, entries: readonly ToolCapability[]) {
  if (profile.aiConfigId !== AI_CONFIG.id || profile.aiConfigVersion !== AI_CONFIG.version
    || profile.capabilities.some(ref => !entries.some(entry => sameCapability(entry.ref, ref)))) {
    throw new CustomAIError("configuration_changed", "This saved request uses an earlier builder version. Your design is saved; start a new request to update it.", 409);
  }
}
export function sameCapability(left: CapabilityRef, right: CapabilityRef) {
  return left.id === right.id && left.version === right.version && left.implementationHash === right.implementationHash;
}
