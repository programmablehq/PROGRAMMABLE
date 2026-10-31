import { describe, expect, it } from "vitest";
import { bindPromptHandoff, createPromptHandoff } from "../lib/custom-ai/prompt-handoff";

const wallet = `0x${"a".repeat(40)}`;
describe("the explicitly submitted sign-in prompt", () => {
  it("retains only the current bounded text and binds to the first verified owner", () => {
    const prompt = createPromptHandoff("  A fee that decreases after ten minutes  ", 1000);
    expect(Object.keys(prompt).sort()).toEqual(["content", "createdAt", "id"]);
    expect(prompt.content).toBe("A fee that decreases after ten minutes");
    const bound = bindPromptHandoff(prompt, "user-a", wallet.toUpperCase().replace("0X", "0x"), 2000)!;
    expect(bound.account).toBe(wallet);
    expect(bindPromptHandoff(bound, "user-a", wallet, 3000)).toBe(bound);
    expect(bindPromptHandoff(bound, "user-b", wallet, 3000)).toBeUndefined();
    expect(bindPromptHandoff(bound, "user-a", `0x${"b".repeat(40)}`, 3000)).toBeUndefined();
  });
  it("rejects stale, future, anonymous or invalid-wallet handoffs", () => {
    const prompt = createPromptHandoff("A fresh idea", 1000);
    expect(bindPromptHandoff(prompt, "user-a", wallet, 1000 + 15 * 60_000)).toBeUndefined();
    expect(bindPromptHandoff(prompt, "user-a", wallet, 999)).toBeUndefined();
    expect(bindPromptHandoff(prompt, "", wallet, 2000)).toBeUndefined();
    expect(bindPromptHandoff(prompt, "user-a", "invalid", 2000)).toBeUndefined();
  });
  it("applies the existing message and secret validation before sign-in", () => {
    expect(() => createPromptHandoff(" ")).toThrow();
    expect(() => createPromptHandoff("a".repeat(8001))).toThrow();
    expect(() => createPromptHandoff("-----BEGIN PRIVATE KEY----- synthetic only")).toThrow(/secret/i);
  });
});
