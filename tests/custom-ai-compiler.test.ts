import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileDraft } from "../lib/custom-ai/compiler.server";

const feeModule = (body: string, declarations = "", constructor = "") => `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CustomAITypesV1 as T} from "./CustomAITypesV1.sol";
import {ICustomAIFeeModuleV1} from "./ICustomAIFeeModuleV1.sol";
contract GeneratedFeeModule is ICustomAIFeeModuleV1 {
 bytes32 public immutable configurationHash = keccak256(abi.encode(T.VERSION_ID, uint16(150)));
 ${declarations}
 ${constructor}
 function quoteFee(T.SwapContext calldata context) external view returns(bytes4,uint16,uint64,bytes32) { ${body} }
}`;
const validQuote = "return(this.quoteFee.selector,150,type(uint64).max,configurationHash);";

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("isolated Custom AI compiler", () => {
  it("blocks a technically valid module that charges a different fee than requested", async () => {
    const result = await compileDraft(feeModule(validQuote), undefined, [
      { afterSeconds: 0, buy: true, totalFeeBps: 200 }, { afterSeconds: 0, buy: false, totalFeeBps: 300 },
    ]);
    expect(result.compiled).toBe(true);
    expect(result.validation?.status).toBe("blocked");
    expect(result.artifact).toBeUndefined();
    expect(result.diagnostics.join(" ")).toContain("expected 300 total bps, received 200");
  });
  it("checks independently requested time boundaries on both chains and swap modes", async () => {
    const source = feeModule("return(this.quoteFee.selector, block.timestamp < context.launchTimestamp + 117 ? 250 : 50, type(uint64).max, configurationHash);");
    const checks = [116, 117, 118].flatMap(afterSeconds => [true, false].map(buy => ({ afterSeconds, buy, totalFeeBps: afterSeconds < 117 ? 300 : 100 })));
    const result = await compileDraft(source, undefined, checks);
    expect(result.validation?.status).toBe("passed");
    expect(result.validation?.expectationCases).toBe(24);
    checks[2].totalFeeBps = 300;
    const wrong = await compileDraft(source, undefined, checks);
    expect(wrong.validation?.status).toBe("blocked");
  });
  it("compiles an exact-interface fee module", async () => {
    const result = await compileDraft(`// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CustomAITypesV1 as T} from "./CustomAITypesV1.sol";
import {ICustomAIFeeModuleV1} from "./ICustomAIFeeModuleV1.sol";
contract GeneratedFeeModule is ICustomAIFeeModuleV1 {
 bytes32 public immutable configurationHash = keccak256(abi.encode(T.VERSION_ID, uint16(150)));
 function quoteFee(T.SwapContext calldata) external view returns(bytes4,uint16,uint64,bytes32) {
  return(this.quoteFee.selector,150,type(uint64).max,configurationHash);
 }
}`);
    expect(result.diagnostics).toEqual([]); expect(result.compiled).toBe(true);
    expect(result.validation?.status).toBe("passed");
    expect(result.validation?.cases).toBeGreaterThan(400);
    expect(result.validation?.deployments.map(d => d.chainId)).toEqual([1, 4663]);
    expect(result.artifact?.initCode).toMatch(/^0x[0-9a-f]+$/);
  });
  it("cannot read an unsupplied file from the host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "custom-ai-sentinel-"));
    const file = join(directory, "Hidden.sol");
    try {
      await writeFile(file, "pragma solidity 0.8.26; contract Hidden { uint256 public constant SENTINEL_MUST_STAY_PRIVATE = 1; }");
      const result = await compileDraft(`pragma solidity 0.8.26; import "${file}"; contract GeneratedFeeModule is Hidden {}`);
      expect(result.compiled).toBe(false);
      expect(result.diagnostics.join(" ")).not.toContain("SENTINEL_MUST_STAY_PRIVATE");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("executes a 3% to 1% schedule on both sides at the exact day boundary", async () => {
    const source = feeModule("return(this.quoteFee.selector, block.timestamp < context.launchTimestamp + 1 days ? 250 : 50, type(uint64).max, configurationHash);");
    const result = await compileDraft(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.validation?.status).toBe("passed");
    for (const buy of [true, false]) {
      expect(result.validation?.samples.find(s => s.afterSeconds === 86399 && s.buy === buy)?.totalFeeBps).toBe(300);
      expect(result.validation?.samples.find(s => s.afterSeconds === 86400 && s.buy === buy)?.totalFeeBps).toBe(100);
    }
  });
  it.each([
    ["mutable storage", feeModule(validQuote, "uint256 public counter;"), "mutable storage"],
    ["assembly", feeModule("assembly { mstore(0, 0) } " + validQuote), "Assembly"],
    ["external call", feeModule("address(1).staticcall(hex\"1234\"); " + validQuote), "External or indirect"],
    ["owner context", feeModule("require(tx.origin != address(0)); " + validQuote), "transaction sender"],
    ["unbound config", feeModule(validQuote, "uint256 public immutable value = 7;"), "every other immutable"],
    ["unresolved constructor", feeModule(validQuote, "", "constructor(uint256 value) { require(value > 0); }"), "without parameters"],
    ["sell revert", feeModule("require(context.buy); " + validQuote), "sell, exact input"],
    ["exact-output fee cap", feeModule("return(this.quoteFee.selector,context.exactInput ? 150 : 1451,type(uint64).max,configurationHash);"), "15% total fee cap"],
    ["late fee cap", feeModule("return(this.quoteFee.selector,block.timestamp > 1800086400 ? 1451 : 150,type(uint64).max,configurationHash);"), "15% total fee cap"],
    ["wrong selector", feeModule("return(bytes4(0),150,type(uint64).max,configurationHash);"), "wrong quote selector"],
    ["expired quote", feeModule("return(this.quoteFee.selector,150,uint64(block.timestamp - 1),configurationHash);"), "expired quote"],
    ["changed hash", feeModule("return(this.quoteFee.selector,150,type(uint64).max,bytes32(uint256(1)));"), "configuration hash"],
  ])("blocks %s even when Solidity compiles", async (_name, source, message) => {
    const result = await compileDraft(source);
    expect(result.compiled).toBe(true);
    expect(result.validation?.status).toBe("blocked");
    expect(result.artifact).toBeUndefined();
    expect(result.diagnostics.join(" ")).toContain(message);
  });
  it("binds successful validation to the exact compiled artifact", async () => {
    const first = await compileDraft(feeModule(validQuote));
    const second = await compileDraft(feeModule(validQuote.replace(",150,", ",151,")));
    expect(first.validation?.status).toBe("passed");
    expect(second.validation?.status).toBe("passed");
    expect(first.validation?.artifactHash).not.toBe(second.validation?.artifactHash);
    expect(first.sourceHash).not.toBe(second.sourceHash);
  });
});
