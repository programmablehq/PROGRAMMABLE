import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { artifactHash } from "../scripts/custom-ai/artifact-hash.mjs";
import { compileLaunchDraft, checkLifecycle } from "../lib/custom-ai/lifecycle.server";

function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]),
  );
  return value;
}

describe("persisted Custom AI artifacts", () => {
  const artifact = { initCode: "0x1234", abi: [{ inputs: [{ name: "a" }, { name: "b" }] }], immutableReferences: { "9": [{ start: 10, length: 32 }] } };
  it("retains the same binding after nested JSON object keys are reordered", () => {
    expect(artifactHash(reorder(artifact))).toBe(artifactHash(artifact));
  });
  it("still binds bytecode, immutable offsets and ABI parameter order", () => {
    for (const changed of [
      { ...artifact, initCode: "0x1235" },
      { ...artifact, immutableReferences: { "9": [{ start: 11, length: 32 }] } },
      { ...artifact, abi: [{ inputs: [{ name: "b" }, { name: "a" }] }] },
    ]) expect(artifactHash(changed)).not.toBe(artifactHash(artifact));
  });
  it.skipIf(!process.env.CUSTOM_AI_COMPILER_DIR)("revalidates a persisted real compiler artifact and rejects a modified one", async () => {
    const draft = await compileLaunchDraft(`// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CustomAITypesV1 as T} from "./CustomAITypesV1.sol";
import {ICustomAIFeeModuleV1} from "./ICustomAIFeeModuleV1.sol";
contract GeneratedFeeModule is ICustomAIFeeModuleV1 {
 bytes32 public immutable configurationHash = keccak256(abi.encode(T.VERSION_ID, uint16(150)));
 function quoteFee(T.SwapContext calldata) external view returns(bytes4,uint16,uint64,bytes32) {
  return(this.quoteFee.selector,150,type(uint64).max,configurationHash);
 }
}`);
    expect(draft.lifecycle?.status).toBe("passed");
    const stored = reorder(JSON.parse(JSON.stringify(draft))) as typeof draft;
    expect(artifactHash(stored.artifact)).toBe(stored.validation?.artifactHash);
    expect((await checkLifecycle(stored)).status).toBe("passed");
    stored.artifact!.initCode += "00";
    await expect(checkLifecycle(stored)).rejects.toThrow("exact checked fee module");
  }, 60_000);
});
