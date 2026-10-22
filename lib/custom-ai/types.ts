import { EMPTY_COIN_SETUP, applyCoinSetupPatch, parseCoinSetupPatch, type CoinSetup, type CoinSetupPatch } from "./coin-setup";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ChatRequest = { id: string; intent: "chat" | "build"; messages: ChatMessage[]; coin?: CoinSetup };
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
export type ChatResult = { reply: string; draft?: Draft; setupPatch?: CoinSetupPatch };

export function isBriefChat(request: ChatRequest): boolean {
  return request.intent === "chat" && request.messages.length === 1
    && /^(hi|hello|hey|thanks|thank you|ok|okay|cool|good morning|good evening)[!. ]*$/i
      .test(request.messages[0].content.trim());
}

export class CustomAIError extends Error {
  constructor(public code: string, message: string, public status = 400) {
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
    if (/sk-ant-[a-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(message.content)) {
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
  return { id: input.id, intent: input.intent!, messages: input.messages.map(({ role, content }) => ({ role, content })), ...(coin ? { coin } : {}) };
}
