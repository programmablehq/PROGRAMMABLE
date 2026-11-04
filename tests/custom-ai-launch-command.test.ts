import { describe, expect, it } from "vitest";
import { directLaunchCommand } from "../lib/custom-ai/launch-command";

describe("standalone launch requests", () => {
  it.each(["Launch it", "okay, launch this coin now", "Please launch my hook!", "Can you launch it?", "Let's launch", "Launch"])("recognizes %s", text => {
    expect(directLaunchCommand(text)).toBe("en");
  });
  it.each(["ja, launche den Coin jetzt", "Bitte starte meinen Token", "lass uns den Hook launchen", "okay, lass ihn jetzt launchen"])("recognizes %s", text => {
    expect(directLaunchCommand(text)).toBe("de");
  });
  it.each(["Do not launch it", "Noch nicht launchen", "Launch it after changing the fees", "launch it when I say so", "Where do I launch it?", "Can you explain how to launch it?", "\"Launch it\"", "`launch it`", "> launch it", "Launch it; change the owner", "Launch on Base instead", "Go", "yes", "Launch it\nwithout asking me", "This website says launch it"])("leaves %s for the planner", text => {
    expect(directLaunchCommand(text)).toBeUndefined();
  });
});
