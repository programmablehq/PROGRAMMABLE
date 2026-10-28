import { VOICE } from "./prompt";

/** Versioned per job; product and money rules remain in the enforcing core. */
export const AI_CONFIG = Object.freeze({
  id: "programmable-custom-ai", version: "2.0.0",
  models: { chat: "claude-haiku-5-5", build: "claude-sonnet-5-5", escalation: "claude-opus-5-5" },
  voice: VOICE,
  maximumLookups: 2, maximumBuildAttempts: 3,
});
export type ExecutionProfile = {
  aiConfigId: string; aiConfigVersion: string;
  capabilities: import("./capabilities/types").CapabilityRef[];
};
