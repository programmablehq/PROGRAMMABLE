import "server-only";
import { callClaude, type ClaudeInput } from "./claude.server";
import { callSurplus } from "./surplus.server";
import { configuredProvider } from "./provider-config.server";

export function callModel(input: ClaudeInput) {
  return configuredProvider().id === "surplus" ? callSurplus(input) : callClaude(input);
}
