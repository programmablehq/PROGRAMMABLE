import { describe, expect, it } from "vitest";
import { isValidClassicDisplaySymbol } from "../lib/market-data/classic-launch-metadata";
import { isValidTokenSymbol } from "../lib/metadata-policy";

describe("historical Classic symbols", () => {
  it.each(["SwarmCore", "TopFloor", "ƒ(⧫)"])("keeps %s readable without relaxing new submission policy", symbol => {
    expect(isValidClassicDisplaySymbol(symbol)).toBe(true);
    expect(isValidTokenSymbol(symbol)).toBe(false);
  });

  it.each(["PRG", "abc123", "AbCdEf123456", "🦉🦉🦉"])("accepts the contract's 12-byte display bound: %s", symbol => {
    expect(isValidClassicDisplaySymbol(symbol)).toBe(true);
  });

  it.each([null, undefined, 123, "", "   ", "ABCDEFGHIJKLM", "🦉🦉🦉🦉", "PRG\n", "P\u200bRG", "P\u202eRG"])("rejects unsafe or malformed display metadata: %s", symbol => {
    expect(isValidClassicDisplaySymbol(symbol)).toBe(false);
  });
});
