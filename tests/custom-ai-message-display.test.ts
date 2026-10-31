import { describe, expect, it } from "vitest";
import { advanceReply, messageBlocks } from "../lib/custom-ai/message-display";

describe("assistant message display", () => {
  it("preserves exact code, whitespace and addresses for its own copy action", () => {
    const code = "address target = 0x1000000000000000000000000000000000000001;\r\n\tuint256 fee = 50;\r\n";
    expect(messageBlocks(`Your rule:\r\n\`\`\`solidity\r\n${code}\`\`\`\r\nKeep this value.`)).toEqual([
      { kind: "text", text: "Your rule:\r\n" }, { kind: "code", language: "solidity", text: code }, { kind: "text", text: "Keep this value." },
    ]);
  });
  it("keeps incomplete fences and HTML as literal text", () => {
    const content = "<img src=x onerror=alert(1)>\n```solidity\nunfinished";
    expect(messageBlocks(content)).toEqual([{ kind: "text", text: content }]);
  });
  it("handles multiple code blocks without dropping text between them", () => {
    const parts = messageBlocks("```json\n{}\n```\nThen\n```solidity\nuint a;\n```\nEnd");
    expect(parts.map(part => part.text)).toEqual(["{}\n", "Then\n", "uint a;\n", "End"]);
  });
  it("bounds presentation lag and honors reduced motion", () => {
    const text = "A fee starts at 10% and falls to 1% after ten minutes.";
    expect(advanceReply("A fee", text, 160)).toBe(text);
    expect(advanceReply("", text, 0, true)).toBe(text);
    let current = "";
    for (let time = 0; time <= 192; time += 24) current = advanceReply(current, text, time);
    expect(current).toBe(text);
  });
  it("never appends old text when research replaces a provisional reply", () => {
    const next = advanceReply("An old idea", "The source confirms a different rule.", 0);
    expect("The source confirms a different rule.".startsWith(next)).toBe(true);
    expect(next).not.toContain("old idea");
  });
  it("keeps emoji and accented graphemes intact", () => {
    const text = "👩‍💻 café 🌧️ Gebühren bleiben exakt.";
    const first = advanceReply("", text, 0);
    expect(text.startsWith(first)).toBe(true);
    expect(first).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(first.endsWith("\u200d")).toBe(false);
    expect(advanceReply(first, text, 200)).toBe(text);
  });
});
