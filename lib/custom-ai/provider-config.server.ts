import "server-only";
import { AI_CONFIG } from "./ai-config";
import { CustomAIError } from "./types";

export function configuredProvider() {
  const id = process.env.CUSTOM_AI_PROVIDER ?? "anthropic";
  if (id !== "anthropic" && id !== "surplus") throw new CustomAIError("configuration", "The AI connection needs to be configured.", 503);
  return id === "surplus"
    ? { id, key: process.env.SURPLUS_API_KEY, models: AI_CONFIG.surplusModels }
    : { id, key: process.env.ANTHROPIC_API_KEY, models: AI_CONFIG.models };
}

export function researchAvailable() {
  const provider = configuredProvider();
  return Boolean(provider.key && (provider.id === "anthropic" || /^[a-zA-Z0-9._:/-]{1,100}$/.test(process.env.CUSTOM_AI_SURPLUS_WEB_SEARCH_MODEL ?? "")));
}

export function assertModelConnection() {
  const provider = configuredProvider();
  if (!provider.key?.trim()) throw new CustomAIError("configuration", "The AI connection is not configured yet. Your draft is saved.", 503);
}
