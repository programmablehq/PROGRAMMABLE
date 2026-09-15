import { describe, expect, it } from "vitest";
import { hexToString, stringToHex, toHex, type Hex } from "viem";
import { readFoundationAssetPins, readFoundationModulePackages, withFoundationModulePackages } from "@/lib/module-foundation/metadata";
import { foundationMetadata } from "@/lib/module-foundation/client";

const id = (n: number) => toHex(n, { size: 32 });
describe("immutable Foundation source identities", () => {
  it("preserves social links and exact ordered package identities in the coin's immutable bytes", () => {
    const data = withFoundationModulePackages(stringToHex(JSON.stringify({ v: 1, x: "https://x.com/ProgrammableHQ", github: "https://github.com/programmablehq" })), [id(2), id(1)]);
    expect(JSON.parse(hexToString(data))).toEqual({ v: 1, x: "https://x.com/ProgrammableHQ", github: "https://github.com/programmablehq", foundation: { v: 1, packages: [id(2), id(1)] } });
    expect(readFoundationModulePackages(data, 2)).toEqual([id(2), id(1)]);
    expect(Object.isFrozen(readFoundationModulePackages(data))).toBe(true);
  });
  it("binds zero modules explicitly and preserves legacy missing identities as unknown", () => {
    expect(readFoundationModulePackages(withFoundationModulePackages("0x", []), 0)).toEqual([]);
    expect(readFoundationModulePackages("0x")).toBeUndefined();
    expect(readFoundationModulePackages(stringToHex('{"v":1,"x":"https://x.com/ProgrammableHQ"}'))).toBeUndefined();
  });
  it("rejects duplicate, zero, malformed or excessive identities", () => {
    for (const ids of [[id(1), id(1)], [id(0)], ["0x1234"], Array.from({ length: 9 }, (_, n) => id(n + 1))]) {
      expect(() => withFoundationModulePackages("0x", ids as Hex[])).toThrow();
    }
  });
  it("rejects a declared composition length that differs from the actual launch", () => {
    const data = withFoundationModulePackages("0x", [id(1)]);
    expect(() => readFoundationModulePackages(data, 0)).toThrow("module count");
    expect(() => readFoundationModulePackages(data, 2)).toThrow("module count");
  });
  it("rejects unsupported reserved envelopes and cannot overwrite prior source identity", () => {
    expect(() => withFoundationModulePackages(withFoundationModulePackages("0x", []), [id(1)])).toThrow();
    for (const foundation of [null, [], { v: 2, packages: [] }, { v: 1, packages: [id(0)] }]) {
      expect(() => readFoundationModulePackages(stringToHex(JSON.stringify({ v: 1, foundation })))).toThrow();
    }
  });
  it("enforces the actual contract's combined 1200-byte metadata bound", () => {
    const data = withFoundationModulePackages("0x", Array.from({ length: 8 }, (_, n) => id(n + 1)));
    expect((data.length - 2) / 2).toBeLessThanOrEqual(1200);
    expect(() => withFoundationModulePackages(stringToHex(JSON.stringify({ v: 1, x: "x".repeat(1190) })), [id(1)])).toThrow("1,200 bytes");
    expect(() => readFoundationModulePackages(stringToHex("x".repeat(1201)))).toThrow("size");
  });
  it("makes source selection part of the same metadata used to predict and create the ERC20", () => {
    const input = { name: "Source coin", symbol: "SOURCE", description: "Actual source binding", imageURI: "https://programmable.market/icon-512.png", socialLinks: { twitter: "https://x.com/ProgrammableHQ" } };
    const a = foundationMetadata({ ...input, modulePackageIds: [id(1)] });
    const b = foundationMetadata({ ...input, modulePackageIds: [id(2)] });
    expect(a.socialData).not.toEqual(b.socialData);
    expect(readFoundationModulePackages(a.socialData, 1)).toEqual([id(1)]);
    expect(JSON.parse(hexToString(a.socialData)).x).toBe("https://x.com/ProgrammableHQ");
  });

  it("binds additional ERC20 precision and code identities within the same immutable metadata budget", () => {
    const asset = toHex(20, { size: 20 });
    const data = withFoundationModulePackages("0x", [id(1)], [[asset, 6, id(7)]]);
    expect(readFoundationAssetPins(data)).toEqual([[asset, 6, id(7)]]);
    expect(readFoundationModulePackages(data, 1)).toEqual([id(1)]);
    expect(withFoundationModulePackages("0x", [id(1)], [[asset, 18, id(7)]])).not.toEqual(data);
    expect(withFoundationModulePackages("0x", [id(1)], [[asset, 6, id(8)]])).not.toEqual(data);
    expect(readFoundationAssetPins(withFoundationModulePackages("0x", []))).toEqual([]);
    expect(() => withFoundationModulePackages(stringToHex(JSON.stringify({ v: 1, x: "x".repeat(1000) })), [id(1)], [[asset, 6, id(7)]])).toThrow("1,200 bytes");
  });

  it("rejects malformed asset bindings and reserved-field authority added to existing metadata", () => {
    const asset = toHex(20, { size: 20 });
    for (const assets of [[[asset, 37, id(7)]], [[asset, 6, "0x"]], [[asset, 6, id(7)], [asset, 6, id(7)]], "unverified"]) {
      const data = stringToHex(JSON.stringify({ v: 1, foundation: { v: 1, packages: [id(1)], assets } }));
      expect(() => readFoundationAssetPins(data)).toThrow();
      expect(() => readFoundationModulePackages(data)).toThrow();
    }
    expect(() => readFoundationAssetPins(stringToHex(JSON.stringify({ v: 1, foundation: { v: 1, packages: [], available: true } })))).toThrow("unsupported");
  });
});
