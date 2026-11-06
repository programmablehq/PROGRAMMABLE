import { describe, expect, it } from "vitest";
import { isDiscoveryQuestion } from "../lib/custom-ai/discovery-question";
import type { ChatRequest } from "../lib/custom-ai/types";
import { isBriefChat } from "../lib/custom-ai/reply-mode";
import {starterIdeas} from "../lib/custom-ai/builder-capabilities";

const request = (content: string): ChatRequest => ({ id: "discovery-question-test", intent: "chat", messages: [{ role: "user", content }] });

describe("read-only builder questions", () => {
  it("routes the visible Explore ideas starter to the brief reply",()=>{
    const prompt=starterIdeas.find(idea=>idea.title==="Explore ideas")!.prompt;
    expect(isDiscoveryQuestion(request(prompt))).toBe(true);
    expect(isBriefChat(request(prompt))).toBe(true);
  });
  it.each([
    "Hey, was könnte ich hier bauen? Erstmal nur Ideen, bitte noch nichts bauen.",
    "Was kannst du bauen?", "Was kannst du?", "Was geht hier so?", "Was ist hier möglich?", "Hast du Ideen?", "Welche Hooks könnte ich erstellen?", "Was können wir hier machen?",
    "What can you build here?", "What should we build?", "Any ideas?", "What could we make? Please don't build anything yet.",
    "Give me some ideas for a hook", "Show me examples", "Gib mir ein paar Ideen", "Zeig mir Beispiele",
    "What could we make? Please don’t build anything yet.",
    "Was kannst du bauen? Nenn mir drei Ideen.", "What can you do? Give me some examples.",
    "What can we build? Give me three different, concrete coin ideas.",
    "Was kann ich bauen? Gib mir drei konkrete Coin-Ideen.",
  ])("uses the small reply schema for %s", content => {
    expect(isDiscoveryQuestion(request(content))).toBe(true);
    expect(isBriefChat(request(content))).toBe(true);
  });
  it.each([
    "What can you build around today's ETH price? What is the price right now?",
    "What can you build with the current weather in London?",
    "Was können wir mit dem aktuellen ETH-Preis bauen?",
    "What can you do with the latest market news?",
    "What can you build? Then launch it.", "Was kannst du? Jetzt launche den Coin.", "Give me ideas and build the first one.", "How can you help? Sign this transaction.",
    "Was kannst du bauen? Ändere die Gebühren auf 2%.", "Gib mir Ideen und erstelle meinen Coin.",
    "What can you build? Could you change my fee to 3%?",
    "What can you build, and would you please make my coin now?",
    "Was kannst du bauen? Kannst du den Namen in Blau ändern?",
    "Was kannst du bauen? Könnten wir die Gebühren auf 2% setzen?",
    "Was kannst du bauen? Gib dem Coin den Namen Test.",
    "What can you build? Give the token a new name.",
    "What can you build? Please switch my coin to Base.",
    "What can you build? Give me a token named Ideas.",
    "What can you do? Give me ideas and set my coin name to Ideas.",
    "What can we build? Give me three different, concrete coin ideas and build the first one.",
    "What can you build could you change my fee to 3%",
    "Hast du Ideen kannst du den Coin auf Base bauen",
    "Was kannst du? Kannst du meinen Coin bauen?",
    "Was kannst du bauen? Kannst du dem Coin den Namen Lumen geben?",
    "What can you build? Could you apply those settings to my coin?",
    "Give ideas and name the coin Ideas",
    "Nenn mir Ideen und nenne den Coin Ideen",
    "Build a hook with 3% fees", "What can you build with https://example.com?",
    "What can you build with `run()`?", "Continue building", "okay",
  ])("keeps explicit work and mixed commands in the planner: %s", content => {
    expect(isDiscoveryQuestion(request(content))).toBe(false);
  });
  it("never consumes build intent or a selected rule edit", () => {
    expect(isDiscoveryQuestion({ ...request("What can you build?"), intent: "build" })).toBe(false);
    expect(isDiscoveryQuestion({ ...request("What can you build?"), editTarget: { requirementId: "fee", sourceHash: "a".repeat(64) } })).toBe(false);
  });
  it("treats a casual greeting as a reply without accepting a pending decision", () => {
    expect(isBriefChat(request("yo"))).toBe(true);
    expect(isBriefChat({ ...request("okay"), contextId: "saved-design" })).toBe(false);
  });
});
