import type { KnowledgeResult } from "../knowledge";
export type CapabilityKind = "tool" | "feed" | "rule" | "action";
export type CapabilityRef = { id: string; version: string; implementationHash: string };
export type CapabilityContext = {
  owner: string; chainId: 1 | 4663; signal?: AbortSignal;
  budget: { remaining: number }; allowWeb: boolean;
};
export type ToolCapability = {
  ref: CapabilityRef; kind: "tool"; description: string; inputSchema: object;
  available: (context: CapabilityContext) => boolean;
  execute: (input: unknown, context: CapabilityContext) => Promise<KnowledgeResult>;
};
