/** One provider owns every task in a request. No hidden provider fallback or
 * model discovery call is needed to select a role. */
export const MODEL_TASKS = {
  conversation: { role: "chat", effort: "low", maxTokens: 800 },
  planning: { role: "build", effort: "medium", maxTokens: 16_000 },
  "product-repair": { role: "chat", effort: "low", maxTokens: 4000 },
  interface: { role: "build", effort: "low", maxTokens: 6000 },
  "interface-abi": { role: "build", effort: "low", maxTokens: 4000 },
  "interface-deployment": { role: "build", effort: "low", maxTokens: 4000 },
  scenarios: { role: "escalation", effort: "low", maxTokens: 4000 },
  "declaration-correction": { role: "build", effort: "low", maxTokens: 8000 },
  source: { role: "build", effort: "high", maxTokens: 16_000 },
  // A frozen architecture shares one bounded output budget across source parts.
  "source-implementation": { role: "build", effort: "low", maxTokens: 16_000 },
  "source-edit": { role: "chat", effort: "low", maxTokens: 4000 },
  "fee-source": { role: "build", effort: "low", maxTokens: 6000, responseProfile: "contract" },
  "fee-escalation": { role: "escalation", effort: "high", maxTokens: 6000, responseProfile: "contract" },
  "source-audit": { role: "escalation", effort: "low", maxTokens: 3500 },
} as const;
/** The combined scenario ceiling remains 12,000 output tokens per request. */
export const SCENARIO_MAX_PAGES = 3;
export type ModelTask = keyof typeof MODEL_TASKS;
export function modelTask(task: ModelTask, models: { chat: string; build: string; escalation: string }) {
  const { role, ...settings } = MODEL_TASKS[task];
  // The original schema is enforced locally on every structured reply.
  return { task, model: models[role], ...settings, structuredTransport: "json-object" as const };
}
