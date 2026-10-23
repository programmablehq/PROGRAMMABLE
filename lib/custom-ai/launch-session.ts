import type { Address, Hex } from "viem";
import type { CoinSettings } from "./preview";
import type { LaunchOrder, ModuleBinding } from "./launch-plan";
import type { AITradeQuote } from "./trade-types";

export type LaunchStep = {
  id: string;
  kind: "module" | "program" | "program-action" | "wrap" | "reset-approval" | "approve" | "launch" | "swap" | "collect-fees" | "claim-creator" | "claim-platform" | "claim-reward";
  state: "prepared" | "dispatching" | "submitted" | "confirmed" | "rejected" | "failed";
  transaction: { from: Address; to: Address | null; data: Hex; value: Hex; chainId: 1 | 4663; nonce: Hex; gas: Hex };
  preparedBlock: string;
  expiresAt: number;
  dispatchedAt?: number;
  hash?: Hex;
  replacedHashes?: Hex[];
  failureReason?: "replaced";
  walletRejected?: boolean;
  launchOrder?: LaunchOrder;
  tradeQuote?: AITradeQuote;
};
export type LaunchSession = {
  id: string; account: Address; chainId: 1 | 4663; draftId: string; imageId: string;
  settings: CoinSettings; description: string; sourceHash: string; artifactHash: string;
  coreBundleHash: string; launchSalt: Hex; inputHash: string;
  state: "preparing" | "waiting" | "ready" | "confirmed" | "failed";
  steps: LaunchStep[]; module?: ModuleBinding; order?: LaunchOrder; token?: Address;
  rewardModule?: ModuleBinding;
  program?: import("./types").Draft["program"];
  quoteNotice?: string;
  priceEvidence?: unknown;
};
export type StoredLaunchSession = { revision: number; session: LaunchSession };
export type WalletSession = Pick<LaunchSession, "id" | "account" | "chainId" | "state" | "steps">;
export type StoredWalletSession = { revision: number; session: WalletSession };
export type WalletAction = "launch" | "trade";

export function stepMatchesTransaction(step: LaunchStep, transaction: {
  from: string; to: string | null; input: string; value: bigint; chainId: number; nonce: bigint;
}) {
  const expected = step.transaction;
  return transaction.from.toLowerCase() === expected.from.toLowerCase()
    && transaction.to?.toLowerCase() === expected.to?.toLowerCase()
    && transaction.input.toLowerCase() === expected.data.toLowerCase()
    && transaction.value === BigInt(expected.value) && transaction.chainId === expected.chainId
    && transaction.nonce === BigInt(expected.nonce);
}

export const launchStepLabel = (kind: LaunchStep["kind"]) => ({
  module: "Create your hook", program: "Create your reward program", "program-action": "Confirm program action", wrap: "Prepare ETH", "reset-approval": "Reset token approval",
  approve: "Approve your initial buy", launch: "Create coin",
  swap: "Confirm swap", "collect-fees": "Collect earned fees", "claim-creator": "Claim creator fees",
  "claim-platform": "Claim platform fees", "claim-reward": "Claim rewards",
})[kind];
