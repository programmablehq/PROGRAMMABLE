import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { compileDraft } from "../lib/custom-ai/compiler.server";
import { checkLifecycle } from "../lib/custom-ai/lifecycle.server";

const source = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CustomAITypesV1 as T} from "./CustomAITypesV1.sol";
import {ICustomAIFeeModuleV1} from "./ICustomAIFeeModuleV1.sol";
contract GeneratedFeeModule is ICustomAIFeeModuleV1 {
 bytes32 public immutable configurationHash;
 constructor() { configurationHash = keccak256(abi.encode(T.VERSION_ID, uint16(250), uint16(50))); }
 function quoteFee(T.SwapContext calldata context) external view returns(bytes4,uint16,uint64,bytes32) {
  return(this.quoteFee.selector,block.timestamp < context.launchTimestamp + 1 days ? 250 : 50,type(uint64).max,configurationHash);
 }
}`;

describe.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("isolated composed Custom AI lifecycle", () => {
  it("launches, trades, pays fixed fees and recovers once on both chains and token orders", async () => {
    const draft = await compileDraft(source);
    expect(draft.validation?.status).toBe("passed");
    const result = await checkLifecycle(draft);
    expect(result.diagnostics).toEqual([]);
    expect(result.status).toBe("passed");
    expect(result.scope).toBe("isolated-core-with-synthetic-quotes");
    expect(result.scenarios.map(s => [s.chainId, s.quoteDecimals, s.token0])).toEqual([
      [1, 18, true], [1, 6, false], [4663, 18, true], [4663, 6, false],
    ]);
    expect(result.cases).toBeGreaterThan(500);
    for (const scenario of result.scenarios) {
      expect(scenario.fixedRecipientsPaid).toBe(true);
      expect(scenario.replayWithoutPayment).toBe(true);
      expect(scenario.swaps).toHaveLength(17);
      expect(scenario.swaps.every(s => s.totalFeeBps === (s.afterSeconds < 86400 ? 300 : 100))).toBe(true);
    }
    const corrupted = { ...draft, artifact: { ...draft.artifact!, initCode: "0x00" as const } };
    await expect(checkLifecycle(corrupted)).rejects.toThrow("exact checked");
  }, 60_000);
});
