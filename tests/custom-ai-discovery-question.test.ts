import { describe, expect, it } from "vitest";
import { isDiscoveryQuestion } from "../lib/custom-ai/discovery-question";
import type { ChatRequest } from "../lib/custom-ai/types";
import { isBriefChat } from "../lib/custom-ai/reply-mode";

const request = (content: string): ChatRequest => ({ id: "discovery-question-test", intent: "chat", messages: [{ role: "user", content }] });

describe("read-only builder questions", () => {
  it.each([
    "Hey, was könnte ich hier bauen? Erstmal nur Ideen, bitte noch nichts bauen.",
    "Was kannst du bauen?", "Was kannst du?", "Was geht hier so?", "Was ist hier möglich?", "Hast du Ideen?", "Welche Hooks könnte ich erstellen?", "Was können wir hier machen?",
    "What can you build here?", "What should we build?", "Any ideas?", "What could we make? Please don't build anything yet.",
    "Give me some ideas for a hook", "Show me examples", "Gib mir ein paar Ideen", "Zeig mir Beispiele",
  ])("uses the small reply schema for %s", content => {
    expect(isDiscoveryQuestion(request(content))).toBe(true);
    expect(isBriefChat(request(content))).toBe(true);
  });
  it.each([
    "What can you build? Then launch it.", "Was kannst du? Jetzt launche den Coin.", "Give me ideas and build the first one.", "How can you help? Sign this transaction.",
    "Was kannst du bauen? Ändere die Gebühren auf 2%.", "Gib mir Ideen und erstelle meinen Coin.",
    "Build a hook with 3% fees", "What can you build with https://example.com?",
    "What can you build with `run()`?", "Continue building", "okay",
  ])("keeps explicit work and mixed commands in the planner: %s", content => {
    expect(isDiscoveryQuestion(request(content))).toBe(false);
  });
  it("never consumes build intent or a selected rule edit", () => {
    expect(isDiscoveryQuestion({ ...request("What can you build?"), intent: "build" })).toBe(false);
    expect(isDiscoveryQuestion({ ...request("What can you build?"), editTarget: { requirementId: "fee", sourceHash: "a".repeat(64) } })).toBe(false);
  });
});
