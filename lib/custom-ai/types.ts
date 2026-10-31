import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch, type CoinSetup, type CoinSetupPatch } from "./coin-setup";

export type ChatMessage = { role: "user" | "assistant"; content: string; sources?: import("./knowledge").KnowledgeSource[] };
export type ChatRequest = { id: string; intent: "chat" | "build"; messages: ChatMessage[]; coin?: CoinSetup; draftId?: string; contextId?: string; editTarget?: import("./design-edits").EditTarget };
export type FeeExpectation = { afterSeconds: number; buy: boolean; totalFeeBps: number; feedValue?: string | null; feedFresh?: boolean | null; feeds?: import("./rule-evaluator").FeedSnapshot[] };
export type RuleVerification = {
  status: "passed" | "blocked";
  sourceHash: string;
  previousSourceHash?: string;
  requirements: string[];
  checks: FeeExpectation[];
  cases: number;
};
export type AIUsage = {
  hourly: { used: number; limit: number; remaining: number; resetsAt: number };
  daily: { used: number; limit: number; remaining: number; resetsAt: number };
  active: number;
  available: boolean;
  resumesAt: number;
};
export const CHAT_PHASES = ["thinking", "reading", "building", "checking", "repairing"] as const;
export type ChatPhase = typeof CHAT_PHASES[number];
export type ChatProgress = { type: "phase"; phase: ChatPhase | "reconnecting" }
  | { type: "reply"; text: string };
export type LifecycleCheck = {
  status: "passed" | "blocked";
  scope: "isolated-core-with-synthetic-quotes";
  bundleHash: string;
  cases: number;
  diagnostics: string[];
  scenarios: { chainId: number; quoteDecimals: number; token0: boolean; initialBuy: string;
    moduleRuntimeHash: string; configurationHash: string; launchExecutionGas: string; maxSwapExecutionGas: string;
    swaps: { afterSeconds: number; buy: boolean; exactInput: boolean; totalFeeBps: number }[];
    fixedRecipientsPaid: boolean; replayWithoutPayment: boolean }[];
};
export type Draft = {
  intent?: import("./launch-intent").LaunchIntent;
  revision?: import("./launch-intent").CandidateRevision;
  composable?: import("./rule-compiler.server").BoundRuleSpec;
  feed?: import("./feed").FeedBinding;
  program?: { spec: import("./program").ProgramSpec; bundleHash: string; chainId: 1 | 4663; quote: `0x${string}`; available: boolean };
  verification?: RuleVerification;
  hookSummary?: string;
  source: string;
  sourceHash: string;
  compiled: boolean;
  diagnostics: string[];
  lifecycle?: LifecycleCheck;
  validation?: {
    version: "self-contained-fee-v1";
    status: "passed" | "blocked";
    artifactHash: string;
    cases: number;
    maxGas?: string;
    samples: { afterSeconds: number; buy: boolean; totalFeeBps: number }[];
    deployments: { chainId: number; timestamp: number; runtimeHash: string; configurationHash: string }[];
    expectationCases?: number;
  };
  artifact?: {
    compiler: string;
    optimizerRuns: number;
    evmVersion: string;
    abi: import("viem").Abi;
    initCode: `0x${string}`;
    runtimeTemplate: `0x${string}`;
    immutableReferences: Record<string, { start: number; length: number }[]>;
  };
};
export type ChatResult = { ruleSpec?: import("./rule-spec").RuleSpecV2; reply: string; draft?: Draft; setupPatch?: CoinSetupPatch;
  intent?: import("./launch-intent").LaunchIntent;
  memory?: string; change?: "applied" | "unchanged" | "blocked"; unresolved?: string[]; chargedAs?: "build" | "research";
  sources?: import("./knowledge").KnowledgeSource[] };

export function isBriefChat(request: ChatRequest): boolean {
  return request.intent === "chat" && request.messages.length === 1 && !request.contextId && !request.draftId
    && /^(hi|hello|hey|hallo|moin|guten morgen|guten abend|danke|dankeschön|merci|salut|bonjour|hola|gracias|ciao|grazie|thanks|thank you|ok|okay|cool|good morning|good evening)[!. ]*$/i
      .test(request.messages.at(-1)?.content.trim() ?? "");
}

export class CustomAIError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryAfterMs = 0) {
    super(message);
    this.name = "CustomAIError";
  }
}

export function parseChatRequest(value: unknown): ChatRequest {
  if (!value || typeof value !== "object") throw new CustomAIError("input", "Send a message first.");
  const input = value as Partial<ChatRequest>;
  if (typeof input.id !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(input.id)
    || !["chat", "build"].includes(input.intent ?? "") || !Array.isArray(input.messages)
    || input.messages.length < 1 || input.messages.length > 24) {
    throw new CustomAIError("input", "This conversation is too long. Start a new draft with the rules you want to keep.");
  }
  let length = 0;
  for (const message of input.messages) {
    if (!message || !["user", "assistant"].includes(message.role)
      || typeof message.content !== "string" || !message.content.trim() || message.content.length > 8_000) {
      throw new CustomAIError("input", "Keep each message under 8,000 characters.");
    }
    length += message.content.length;
    if (/sk-ant-[a-z0-9_-]{20,}|inf_[a-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(message.content)) {
      throw new CustomAIError("secret", "That looks like a secret key. Remove it before sending your message.");
    }
  }
  if (length > 24_000 || input.messages.at(-1)?.role !== "user") {
    throw new CustomAIError("input", "Start a new draft with a shorter description of your rules.");
  }
  let coin: CoinSetup | undefined;
  if (input.coin !== undefined) {
    try { coin = applyCoinSetupPatch(EMPTY_COIN_SETUP, parseCoinSetupPatch(input.coin)); }
    catch { throw new CustomAIError("settings", "The coin details could not be read. Try again."); }
  }
  for (const key of ["draftId", "contextId"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !/^[a-zA-Z0-9-]{16,64}$/.test(input[key]!))) {
      throw new CustomAIError("context", "The saved conversation could not be read. Reload it before continuing.");
    }
  }
  if (input.editTarget && (!input.draftId || !/^[a-f0-9]{64}$/i.test(input.editTarget.sourceHash)
    || !/^[a-z][a-z0-9-]{0,63}$/.test(input.editTarget.requirementId))) {
    throw new CustomAIError("edit", "Reload the saved rule before editing it.", 400);
  }
  return { id: input.id, intent: input.intent!, messages: input.messages.map(({ role, content }) => ({ role, content })), ...(coin ? { coin } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}), ...(input.contextId ? { contextId: input.contextId } : {}),
    ...(input.editTarget ? { editTarget: { sourceHash: input.editTarget.sourceHash, requirementId: input.editTarget.requirementId } } : {}) };
}
