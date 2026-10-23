import { describe, expect, it } from "vitest";
import { conversationWindow, partialReply } from "../lib/custom-ai/conversation";
import { parseChatRequest, type ChatMessage } from "../lib/custom-ai/types";

describe("continued Custom AI conversations", () => {
  it("continues well beyond twelve turns without losing the newest request", () => {
    const messages: ChatMessage[] = [];
    for (let turn = 0; turn < 150; turn++) {
      messages.push({ role: "user", content: `Keep the buy fee; change only step ${turn}.` });
      const request = parseChatRequest({ id: `continued-request-${turn}`, intent: "chat", messages: conversationWindow(messages),
        draftId: "saved-draft-0000001", contextId: "saved-context-0001" });
      expect(request.messages.at(-1)?.content).toContain(`step ${turn}`);
      expect(request.messages[0].role).toBe("user");
      messages.push({ role: "assistant", content: "The previous rules are kept." });
    }
  });
  it("keeps the latest full 8000-character message within the body budget", () => {
    const messages: ChatMessage[] = Array.from({ length: 51 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i).padEnd(8000, "x") }));
    const kept = conversationWindow(messages);
    expect(kept.at(-1)).toEqual(messages.at(-1));
    expect(kept.reduce((n, message) => n + message.content.length, 0)).toBeLessThanOrEqual(22000);
  });
  it("also bounds UTF-8 bytes and saved source links", () => {
    const messages: ChatMessage[] = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "語".repeat(8000) }));
    const kept = conversationWindow(messages, 40, 30000);
    expect(kept.at(-1)).toEqual(messages.at(-1));
    expect(new TextEncoder().encode(JSON.stringify(kept)).length).toBeLessThan(64000);
  });
  it("streams only the first top-level reply and handles split escapes", () => {
    expect(partialReply('{"reply":"Hello')).toBe("Hello");
    expect(partialReply('{"reply":"Line\\nnext\\u00')).toBe("Line\nnext");
    expect(partialReply('{"reply":"Complete","source":"SECRET CODE')).toBe("Complete");
    expect(partialReply('{"action":"build","reply":"Any key order')).toBe("Any key order");
    expect(partialReply('{"source":"code with \\"reply\\":')).toBeUndefined();
  });
});
