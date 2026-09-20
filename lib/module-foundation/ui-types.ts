import type { Address, Hex } from "viem";
import type { ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import type { FoundationCreatorFees } from "./creator-fees";
export { isFoundationCreatorFee, foundationCreatorFeeRates, foundationCreatorFeeFields } from "./creator-fees";
export type { FoundationCreatorFees, FoundationCreatorFeeRates } from "./creator-fees";

export const FOUNDATION_PLATFORM_FEE_BPS = 30 as const;
export const FOUNDATION_PLATFORM_FEE_RECIPIENT = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" as const;

export interface FoundationAvailability {
  status: "checking" | "ready" | "unavailable";
  chainId: number;
  chainName: string;
  reason?: string;
}

export interface FoundationQuoteAsset {
  address: Address;
  chainId: number;
  symbol: string;
  name: string;
  decimals: number;
  supported: boolean;
  reason?: string;
  /** Human units, verified for the current wallet by the host. */
  balance?: string;
  /** The host verified the canonical Robinhood WETH address, decimals and runtime. */
  supportsNativeEth?: boolean;
}

export interface FoundationImage {
  url: string;
  sha256: Hex;
}

export type FoundationConfiguration = Record<string, string | boolean>;

/** UI primitives only. Module capabilities and identifiers remain open strings. */
export interface FoundationConfigurationField {
  key: string;
  label: string;
  kind: "text" | "decimal" | "integer" | "address" | "boolean" | "select";
  description?: string;
  required?: boolean;
  defaultValue?: string | boolean;
  options?: readonly { value: string; label: string }[];
}

export interface FoundationModuleDescriptor {
  id: string;
  version: string;
  digest: Hex;
  name: string;
  description: string;
  capabilities: readonly string[];
  fields: readonly FoundationConfigurationField[];
  available: boolean;
  unavailableReason?: string;
  /** Descriptor IDs whose simultaneous selection is disallowed by conformance. */
  conflictsWith?: readonly string[];
  requires?: readonly string[];
}

export interface FoundationModuleSelection {
  id: string;
  version: string;
  digest: Hex;
  configuration: FoundationConfiguration;
}

export type FoundationLaunchDraft = FoundationCreatorFees & {
  name: string;
  symbol: string;
  description: string;
  image: FoundationImage;
  socialLinks: ModuleSocialLinks;
  quoteAsset: Address;
  /** Native ETH spending ceiling in the single-eth-v1 launch form. */
  initialBuy: string;
  additionalLiquidity: string;
  modules: FoundationModuleSelection[];
}

export interface FoundationPoolIdentity {
  poolId: Hex;
  currency0: Address;
  currency1: Address;
  /** Uniswap v4 PoolKey fee units: hundredths of a basis point. */
  fee: number;
  tickSpacing: number;
  hooks: Address;
  poolManager: Address;
}

export interface FoundationPositionIdentity {
  label: string;
  positionManager: Address;
  tokenId?: string;
  owner: Address;
  tickLower: number;
  tickUpper: number;
  ownershipDescription: string;
  /** Absent only for saved V1 UI data. DEAD custody is never represented as a vault. */
  custody?: "permanent-vault-v1" | "wallet-owned-v1" | "dead-v1";
}

export interface FoundationTransactionSummary {
  label: string;
  to: Address;
  chainId: number;
  value: string;
  /** Explicit human description of the exact approval or token movement. */
  effect: string;
  spender?: Address;
}

interface FoundationLaunchReviewCommon {
  id: string;
  contextKey: string;
  account: Address;
  chainId: number;
  simulationBlock: string;
  /** Unix seconds. The host must revalidate again before requesting a signature. */
  expiresAt: number;
  quote: FoundationQuoteAsset;
  tokenAddress: Address;
  metadataUri?: string;
  metadataHash: Hex;
  pool: FoundationPoolIdentity;
  positions: readonly FoundationPositionIdentity[];
  platformFeeBps: typeof FOUNDATION_PLATFORM_FEE_BPS;
  platformFeeRecipient: typeof FOUNDATION_PLATFORM_FEE_RECIPIENT;
  initialBuy: string;
  minimumInitialTokens: string;
  additionalLiquidity: string;
  supply: string;
  actualStartMarketCapUsd: string;
  transactions: readonly FoundationTransactionSummary[];
  notes?: readonly string[];
}

export interface FoundationRoundingInventoryReview {
  recipient: Address;
  /** Human token units. Transfer to DEAD does not reduce ERC20 totalSupply. */
  tokenAmount: string;
  unrecoverable: boolean;
}
export interface FoundationQuoteFundingReview {
  /** Maximum quote debit including initial buy and optional additional liquidity. */
  maximum: string;
  /** Actual quote principal allocated to the optional creator-funded LP NFT. */
  principal: string;
  /** Exact quote returned, including unused funding and any extra quote received during construction. */
  refund: string;
}
export type FoundationLaunchReview = FoundationLaunchReviewCommon & FoundationCreatorFees & (
  { factoryVersion?: "v1"; lpCustodyId?: never; roundingInventory?: FoundationRoundingInventoryReview; quoteFunding?: FoundationQuoteFundingReview }
  | { factoryVersion: "v2" | "v3"; lpCustodyId: Hex; roundingInventory: FoundationRoundingInventoryReview & { unrecoverable: true }; quoteFunding: FoundationQuoteFundingReview }
);

export interface FoundationTransactionResult {
  status: "submitted" | "confirmed" | "reverted" | "unconfirmed";
  transactionHash: Hex;
  explorerUrl: string;
  message?: string;
  blockNumber?: string;
  tokenUrl?: string;
  /** Only include identity read from the actual confirmed receipt. */
  pool?: FoundationPoolIdentity;
  positions?: readonly FoundationPositionIdentity[];
  metadataStatus?: "stored" | "indexed" | "pending";
  /** A mined approval can leave further steps. A mined launch remains complete even if its detail readback is delayed. */
  operationComplete?: boolean;
  verificationStatus?: "pending" | "verified";
  stepLabel?: string;
}

export interface FoundationWalletAction {
  label: string;
  onClick: () => void | Promise<void>;
  busy?: boolean;
}

export interface FoundationTradeDraft {
  side: "buy" | "sell";
  amount: string;
  slippageBps: number;
}

export interface FoundationTradeReview {
  id: string;
  contextKey: string;
  account: Address;
  chainId: number;
  side: "buy" | "sell";
  expiresAt: number;
  simulationBlock: string;
  inputAmount: string;
  outputAmount: string;
  /** Net minimum received after all applicable fees. */
  minimumOutput: string;
  platformFeeAmount: string;
  creatorFeeAmount: string;
  lpFeeAmount?: string;
  platformFeeBps: typeof FOUNDATION_PLATFORM_FEE_BPS;
  platformFeeRecipient: typeof FOUNDATION_PLATFORM_FEE_RECIPIENT;
  universalRouter: Address;
  transactions: readonly FoundationTransactionSummary[];
}

export function foundationDecimalError(value: string, decimals: number, allowZero = true): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return "Enter an amount using numbers and a decimal point.";
  if ((value.split(".")[1]?.length ?? 0) > decimals) return `Use no more than ${decimals} decimal places for this token.`;
  if (!allowZero && !/[1-9]/.test(value)) return "Enter an amount greater than zero.";
  if (value.length > 100) return "Enter a smaller amount.";
  return null;
}

export function foundationPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".");
  } catch { return false; }
}

export function foundationReviewError(review: Pick<FoundationLaunchReview, "contextKey" | "expiresAt" | "platformFeeBps" | "platformFeeRecipient">, contextKey: string, now = Date.now()): string | null {
  if (review.contextKey !== contextKey) return "Your wallet or launch version changed. Review again.";
  if (!Number.isFinite(review.expiresAt) || review.expiresAt * 1_000 <= now) return "This review expired. Review again for a current simulation.";
  if (review.platformFeeBps !== FOUNDATION_PLATFORM_FEE_BPS || review.platformFeeRecipient.toLowerCase() !== FOUNDATION_PLATFORM_FEE_RECIPIENT.toLowerCase()) return "The platform fee could not be verified. Review again.";
  return null;
}

export function foundationSelectionErrors(selections: readonly FoundationModuleSelection[], catalog: readonly FoundationModuleDescriptor[]): string[] {
  const ids = new Set(selections.map(selection => selection.id));
  const issues: string[] = [];
  if (ids.size !== selections.length) issues.push("Each module can be selected once.");
  for (const selection of selections) {
    const descriptor = catalog.find(entry => entry.id === selection.id && entry.version === selection.version && entry.digest === selection.digest);
    if (!descriptor?.available) { issues.push("A selected module changed or is unavailable. Remove it and select a current version."); continue; }
    for (const required of descriptor.requires ?? []) if (!ids.has(required)) issues.push(`${descriptor.name} requires ${catalog.find(entry => entry.id === required)?.name ?? required}.`);
    for (const conflict of descriptor.conflictsWith ?? []) if (ids.has(conflict)) issues.push(`${descriptor.name} cannot be combined with ${catalog.find(entry => entry.id === conflict)?.name ?? conflict}.`);
    for (const field of descriptor.fields) {
      const value = selection.configuration[field.key];
      if (field.required && (value === undefined || (typeof value === "string" && !value.trim()))) issues.push(`Complete ${field.label} in ${descriptor.name}.`);
      if (value === undefined || value === "") continue;
      if (field.kind === "boolean" && typeof value !== "boolean") issues.push(`Choose a setting for ${field.label}.`);
      if (field.kind === "address" && (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))) issues.push(`Enter a valid address for ${field.label}.`);
      if (field.kind === "integer" && (typeof value !== "string" || !/^\d+$/.test(value))) issues.push(`Enter a whole number for ${field.label}.`);
      if (field.kind === "decimal" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value))) issues.push(`Enter a decimal amount for ${field.label}.`);
      if (field.kind === "select" && !field.options?.some(option => option.value === value)) issues.push(`Choose an available option for ${field.label}.`);
    }
  }
  return [...new Set(issues)];
}
