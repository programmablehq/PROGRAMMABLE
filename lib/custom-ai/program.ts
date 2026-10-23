import { getAddress, isAddress, zeroAddress } from "viem";

export type ProgramSpec = {
  kind: "distribution" | "staking" | "buyback";
  rewardShareBps: number;
  intervalSeconds: number;
  recipient: string;
  maximumBatch: string;
  minimumTokensPerQuote: string;
};

export function parseProgram(value: unknown): ProgramSpec | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object") throw Error("Specify the reward program.");
  const p = value as ProgramSpec;
  if (!["distribution", "staking", "buyback"].includes(p.kind)
    || !Number.isSafeInteger(p.rewardShareBps) || p.rewardShareBps < 1 || p.rewardShareBps > 10_000
    || !Number.isSafeInteger(p.intervalSeconds) || p.intervalSeconds < 60 || p.intervalSeconds > 31_536_000
    || typeof p.recipient !== "string" || typeof p.maximumBatch !== "string" || typeof p.minimumTokensPerQuote !== "string") {
    throw Error("Specify the reward share and execution interval.");
  }
  if (p.kind === "staking" ? p.recipient !== "" : p.recipient !== "creator" && (!isAddress(p.recipient) || p.recipient === zeroAddress)) {
    throw Error("Specify a fixed recipient for this program.");
  }
  const amount = /^(0|[1-9][0-9]{0,18})(\.[0-9]{1,18})?$/;
  if (p.kind === "buyback" ? !amount.test(p.maximumBatch) || !amount.test(p.minimumTokensPerQuote)
    || Number(p.maximumBatch) <= 0 || Number(p.minimumTokensPerQuote) <= 0
    : p.maximumBatch !== "0" || p.minimumTokensPerQuote !== "0") throw Error("Specify the maximum buyback and minimum tokens per quote token.");
  return { kind: p.kind, rewardShareBps: p.rewardShareBps, intervalSeconds: p.intervalSeconds,
    recipient: isAddress(p.recipient) ? getAddress(p.recipient) : p.recipient,
    maximumBatch: p.maximumBatch, minimumTokensPerQuote: p.minimumTokensPerQuote };
}

export const programSchema = { type: ["object", "null"], properties: {
  kind: { type: "string", enum: ["distribution", "staking", "buyback"] }, rewardShareBps: { type: "integer" },
  intervalSeconds: { type: "integer" }, recipient: { type: "string" }, maximumBatch: { type: "string" }, minimumTokensPerQuote: { type: "string" },
}, required: ["kind", "rewardShareBps", "intervalSeconds", "recipient", "maximumBatch", "minimumTokensPerQuote"], additionalProperties: false };

export const programRules = `An optional, immutable funded program may accompany the fee rule. Return program=null when none is requested.
Supported program.kind values: distribution (fixed recipient), staking (proportional rewards for staking this new coin;
principal withdrawable at any time), buyback (buy this new coin and deliver it to a fixed recipient).
rewardShareBps is the chosen share of ADDITIONAL fees, excluding the fixed platform fee, from 1 to 10000.
The remaining additional fees go to the creator. Never infer a share: ask if missing.
intervalSeconds is the reward allocation window, from 60 to 31536000; ask if not specified.
Allocations occur at most once per fixed UTC window. Distribution and buyback executions also have a
minimum interval of that length between successful executions. Staking claims and withdrawals remain independent.
recipient is an explicitly supplied address or "creator" for the connected creator; for staking use an empty string.
For buybacks, maximumBatch is the cap in whole quote-token units per execution, and minimumTokensPerQuote is the
minimum whole new-coin tokens accepted per one quote token (a fixed price ceiling). Ask for both if missing.
For other modes both amount strings must be "0". All funds are actually collected fees; no fixed yield or guaranteed APY.
Execution is permissionless, callable by anyone, not guaranteed automatic. Rewards collected while no one is staked
remain available for subsequent stakers. Claims distribute only collected rewards, with integer rounding.
Include the COMPLETE program behavior and split in requirements. Preserve the saved program unless explicitly changed.
Generated Solidity implements only the fee rule; the platform binds the separately checked program template.
Other reward systems require clarification. Do not substitute a distribution for requested staking or buybacks.`;

// Binding the complete template/configuration into the fee source binds the existing
// source-hash review, saved draft and launch journal without changing core bytecode.
export function bindProgramSource(source: string, program: unknown, bundleHash: string): string {
  const clean = source.replace(/\n?\/\/ @programmable-program-v1 [^\n]*/g, "").trimEnd();
  return program ? `${clean}\n// @programmable-program-v1 ${JSON.stringify({ bundleHash, program })}\n` : clean;
}
