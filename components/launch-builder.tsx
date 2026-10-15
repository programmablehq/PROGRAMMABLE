"use client";
import { LaunchShareLink } from "./launch-share-link";
import { TOKEN_IMAGE_ACCEPT } from "@/lib/token-image";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  ImagePlus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import extendedLayout from "@/components/extended-launch-layout.module.css";
import launchExperience from "@/components/launch-experience.module.css";
import { validatePreparedClassicLaunchTransaction } from "@/lib/classic-launch-validation";
import {
  validatePreparedClassicV3LaunchTransaction,
  validatePreparedClassicV4LaunchTransaction,
} from "@/lib/classic-v3-launch-validation";
import {
  formatClassicV3Percent,
  validateClassicV3LaunchDraft,
} from "@/lib/classic-v3";
import { validateClassicV4LaunchDraft } from "@/lib/classic-v4";
import { isConfiguredClassicV3ReleaseReady } from "@/lib/classic-v3-release";
import {
  deepV3PresetDisclosure,
  validateDeepV3LaunchDraft,
} from "@/lib/deep-v3";
import { validatePreparedDeepV3LaunchTransaction } from "@/lib/deep-v3-launch-validation";
import { validatePreparedStockPairedLaunchTransaction } from "@/lib/stock-paired-launch-validation";
import { isStockPairedLocalPreviewEnabled } from "@/lib/stock-paired-access";
import {
  STOCK_PAIRED_DEFAULT_INITIAL_BUY_ETH,
  getStockPairedEthQuoteAsset,
  parseStockInitialBuyEthAmount,
  STOCK_PAIRED_ETH_QUOTE_ASSETS,
  STOCK_PAIRED_MIN_INITIAL_BUY_ETH,
  validateStockPairedLaunchDraft,
  type StockQuoteAsset,
} from "@/lib/stock-paired";
import {
  getStockPairedV2QuoteAsset,
  STOCK_PAIRED_V2_QUOTE_ASSETS,
  type StockPairedV2QuoteAsset,
} from "@/lib/stock-paired-v2";
import {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_URL_BYTES,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_BYTES,
  MAX_TOKEN_SYMBOL_CHARACTERS,
  characterLength,
  normalizeOptionalHttpsUrl,
  normalizeOptionalSocialUrl,
  utf8ByteLength,
  validateMemeLaunchDraft,
  type LaunchPreflightResponse,
} from "@/lib/launch-transaction";
import {
  CLASSIC_V3_MAX_REWARD_BENEFICIARIES,
  CLASSIC_TOTAL_SWAP_FEE_BPS,
  CLASSIC_TOTAL_SWAP_FEE_PERCENT,
  createClassicV3Draft,
  createEmptyDraft,
  createStockPairedDraft,
  getClassicInitialBuyCurveQuote,
  getClassicInitialBuyPreview,
  getLegacyClassicInitialBuyCurveQuote,
  getLegacyClassicInitialBuyPreview,
  maximumClassicDevBuyWei,
  MEME_MIN_INITIAL_BUY_ETH,
  MEME_MIN_INITIAL_BUY_ETH_LABEL,
  MEME_TOKEN_SUPPLY_WHOLE,
  parseClassicFeePercentToBps,
  parseInitialBuyWei,
  PLATFORM_FEE_BPS,
  type LaunchDraft,
  type LaunchModel,
} from "@/lib/launch";
import {
  isProgrammableTokenImageUrl,
  prepareTokenImage,
  readTokenImageUploadResponse,
} from "@/lib/token-image";
import { withTokenImageUploadDeadline } from "@/lib/token-image-upload";
import {
  browserWalletRequestIsPending,
  subscribeToBrowserWalletRequest,
} from "@/lib/wallet-request-lock";
import { formatEther } from "viem";

type TokenImageState = {
  status: "idle" | "preparing" | "waiting" | "uploading" | "ready" | "error";
  message: string;
};

type LaunchPhase = "idle" | "preparing" | "confirming";
export type LaunchSubmissionPhase =
  | "idle"
  | "receipt"
  | "indexing"
  | "pending-timeout"
  | "index-timeout"
  | "receipt-unavailable"
  | "index-unavailable"
  | "reverted";

export type LaunchReceiptStatus =
  | "pending"
  | "confirmed"
  | "reverted"
  | "not-found";
export type LaunchReceiptPollResult =
  | "confirmed"
  | "reverted"
  | "not-found"
  | "unavailable"
  | "pending-timeout";

export type IndexedLaunchPollResult<T> =
  | { status: "indexed"; launch: T }
  | { status: "timeout" }
  | { status: "unavailable" };

export type PendingLaunchSubmission = {
  version: 2;
  transactionHash: `0x${string}`;
  account: `0x${string}`;
  chainId: 1 | 11_155_111;
  model: LaunchModel;
  submittedAtMs: number;
  receiptConfirmedAtMs?: number;
  tokenAddress?: `0x${string}`;
  tokenName?: string;
  tokenSymbol?: string;
  estimatedInitialBuyTokenAmount?: number;
};

export type LaunchSubmissionPhaseRecord = {
  account: `0x${string}`;
  transactionHash: `0x${string}`;
  phase: LaunchSubmissionPhase;
};

export type PendingLaunchStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export type IndexedLaunch = {
  address: `0x${string}`;
  href: string;
  name: string;
  symbol: string;
};

type IndexedLaunchRecord = {
  launch: IndexedLaunch;
  submission: PendingLaunchSubmission;
};

export type LaunchSuccessSummary = IndexedLaunch & {
  chainId: 1 | 11_155_111;
  estimatedInitialBuyTokenAmount?: number;
  indexed: boolean;
  transactionHash: `0x${string}`;
};

const emptyTokenImageState: TokenImageState = {
  status: "idle",
  message: "",
};
const stockPairedLocalPreview = isStockPairedLocalPreviewEnabled();
const stockPairedUiQuoteAssets = stockPairedLocalPreview
  ? STOCK_PAIRED_V2_QUOTE_ASSETS
  : STOCK_PAIRED_ETH_QUOTE_ASSETS;
const STOCK_PAIRED_DISPLAY_NAMES: Record<string, string> = {
  NVDAon: "NVIDIA",
  SPYon: "S&P 500",
  GOOGLon: "Alphabet",
  SLVon: "Silver",
  TSLAon: "Tesla",
  AAPLon: "Apple",
};

const LAUNCH_RECEIPT_POLL_ATTEMPTS = 12;
export const LAUNCH_INDEX_POLL_ATTEMPTS = 18;
export const LAUNCH_INDEX_AUTO_RETRY_DELAY_MS = 6_000;
export const PENDING_LAUNCH_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
export const LAUNCH_SUCCESS_CELEBRATION_MAX_AGE_MS = 30 * 60 * 1_000;
const PENDING_LAUNCH_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const PENDING_LAUNCH_STORAGE_PREFIX = "programmable.pending-launch.v2";
const PENDING_LAUNCH_CHANGED_EVENT = "programmable:pending-launch-changed";
const PENDING_LAUNCH_EMPTY_SNAPSHOT = "__none__";
const SUPPORTED_LAUNCH_MODELS = new Set<LaunchModel>([
  "classic",
  "classic-v3",
  "adaptive",
  "stock-paired",
]);

export function launchPollDelayMs(attempt: number) {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(1_000 * 2 ** Math.floor(normalizedAttempt / 3), 5_000);
}

export function launchIndexPollDelayMs(attempt: number) {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(4_000 + normalizedAttempt * 1_000, 12_000);
}

export function launchIndexShouldRetryAutomatically(
  confirmedButUnindexed: boolean,
  submissionPhase: LaunchSubmissionPhase,
) {
  return (
    confirmedButUnindexed &&
    (submissionPhase === "index-unavailable" ||
      submissionPhase === "index-timeout")
  );
}

export function launchDraftIsLocked(
  pendingRestoreComplete: boolean,
  launchPhase: LaunchPhase,
  transactionHash: string,
) {
  return (
    !pendingRestoreComplete ||
    launchPhase !== "idle" ||
    Boolean(transactionHash)
  );
}

export async function createClassicLaunchPreflightHeaders(
  input: Readonly<{
    getAccessToken: () => Promise<string | null>;
    getIdentityToken: () => Promise<string | null>;
  }>,
) {
  // Identity-token lookup can refresh Privy's current session. Acquire the
  // authoritative access token afterwards so the two credentials cannot race
  // and represent different session revisions.
  const identityToken = await input.getIdentityToken().catch(() => null);
  const accessToken = await input.getAccessToken();
  if (!accessToken) {
    throw new Error("Reconnect the launch wallet and try again");
  }

  return new Headers({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    ...(identityToken
      ? { "X-Privy-Identity-Token": identityToken }
      : {}),
  });
}

export const CLASSIC_V4_LINKED_WALLET_REQUIRED_MESSAGE =
  "This address is not linked to your Programmable wallet session. Select Add wallet to link it before creating a Classic token.";

export function blockUnlinkedClassicV4Launch(input: Readonly<{
  hasWallet: boolean;
  launchModel: LaunchModel;
  onBlocked: (message: string) => void;
  releaseEnabled: boolean;
  walletLinked: boolean;
}>) {
  const blocked = input.launchModel === "classic-v3"
    && input.releaseEnabled
    && input.hasWallet
    && !input.walletLinked;
  if (!blocked) return false;

  input.onBlocked(CLASSIC_V4_LINKED_WALLET_REQUIRED_MESSAGE);
  return true;
}

export function launchDraftForSuccessDisplay(
  draft: LaunchDraft,
  submittedFromCurrentDraft: boolean,
) {
  return submittedFromCurrentDraft ? draft : undefined;
}

export function launchSubmissionUsesCurrentDraft(
  transactionHash: string,
  currentDraftSubmissionHash: string,
  currentDraftVersion: number,
  submittedDraftVersion: number | null,
) {
  return Boolean(
    transactionHash &&
      currentDraftSubmissionHash &&
      transactionHash.toLowerCase() ===
        currentDraftSubmissionHash.toLowerCase() &&
      submittedDraftVersion !== null &&
      currentDraftVersion === submittedDraftVersion,
  );
}

export function shouldCelebrateIndexedLaunch({
  submission,
  currentDraftSubmissionHash,
  currentDraftVersion,
  submittedDraftVersion,
  nowMs = Date.now(),
}: {
  submission: PendingLaunchSubmission;
  currentDraftSubmissionHash: string;
  currentDraftVersion: number;
  submittedDraftVersion: number | null;
  nowMs?: number;
}) {
  const submissionAgeMs = nowMs - submission.submittedAtMs;
  return (
    launchSubmissionUsesCurrentDraft(
      submission.transactionHash,
      currentDraftSubmissionHash,
      currentDraftVersion,
      submittedDraftVersion,
    ) &&
    submissionAgeMs >= -PENDING_LAUNCH_MAX_CLOCK_SKEW_MS &&
    submissionAgeMs < LAUNCH_SUCCESS_CELEBRATION_MAX_AGE_MS
  );
}

export function shouldRestoreConfirmedLaunchSuccess(
  submission: PendingLaunchSubmission,
  nowMs = Date.now(),
) {
  const submissionAgeMs = nowMs - submission.submittedAtMs;
  return Boolean(
    submission.receiptConfirmedAtMs &&
      submissionAgeMs >= -PENDING_LAUNCH_MAX_CLOCK_SKEW_MS &&
      submissionAgeMs < PENDING_LAUNCH_STALE_AFTER_MS,
  );
}

export function launchSuccessSummary(
  submission: PendingLaunchSubmission | null | undefined,
  indexedLaunch: IndexedLaunch | null | undefined,
): LaunchSuccessSummary | null {
  if (!submission?.receiptConfirmedAtMs) return null;
  if (
    indexedLaunch &&
    submission.tokenAddress &&
    indexedLaunch.address.toLowerCase() !==
      submission.tokenAddress.toLowerCase()
  ) {
    return null;
  }

  const address = indexedLaunch?.address ?? submission.tokenAddress;
  const name = indexedLaunch?.name ?? submission.tokenName;
  const symbol = indexedLaunch?.symbol ?? submission.tokenSymbol;
  if (!address || !name || !symbol) return null;

  return {
    address,
    href: indexedLaunch?.href ?? `/token/${address}`,
    name,
    symbol,
    chainId: submission.chainId,
    indexed: Boolean(indexedLaunch),
    transactionHash: submission.transactionHash,
    ...(submission.estimatedInitialBuyTokenAmount !== undefined
      ? {
          estimatedInitialBuyTokenAmount:
            submission.estimatedInitialBuyTokenAmount,
        }
      : {}),
  };
}

export function pendingLaunchStorageKey(
  model: LaunchModel,
  chainId: 1 | 11_155_111,
  account: string,
  transactionHash: string,
) {
  return `${PENDING_LAUNCH_STORAGE_PREFIX}:${chainId}:${model}:${account.toLowerCase()}:${transactionHash.toLowerCase()}`;
}

export function pendingLaunchPointerKey(
  model: LaunchModel,
  chainId: 1 | 11_155_111,
  account: string,
) {
  return `${PENDING_LAUNCH_STORAGE_PREFIX}:${chainId}:${model}:${account.toLowerCase()}:active`;
}

export function pendingLaunchReleasedKey(
  submission: PendingLaunchSubmission,
) {
  return `${pendingLaunchStorageKey(
    submission.model,
    submission.chainId,
    submission.account,
    submission.transactionHash,
  )}:released`;
}

export function parsePendingLaunchSubmission(
  serialized: string | null,
  expectedModel: LaunchModel,
  expectedChainId: 1 | 11_155_111,
  expectedAccount?: string,
  nowMs = Date.now(),
): PendingLaunchSubmission | null {
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== 2 ||
      typeof candidate.transactionHash !== "string" ||
      !/^0x[a-fA-F0-9]{64}$/.test(candidate.transactionHash) ||
      typeof candidate.account !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(candidate.account) ||
      (expectedAccount !== undefined &&
        candidate.account.toLowerCase() !== expectedAccount.toLowerCase()) ||
      (candidate.chainId !== 1 && candidate.chainId !== 11_155_111) ||
      candidate.chainId !== expectedChainId ||
      typeof candidate.model !== "string" ||
      !SUPPORTED_LAUNCH_MODELS.has(candidate.model as LaunchModel) ||
      candidate.model !== expectedModel ||
      typeof candidate.submittedAtMs !== "number" ||
      !Number.isSafeInteger(candidate.submittedAtMs) ||
      candidate.submittedAtMs <= 0 ||
      candidate.submittedAtMs > nowMs + PENDING_LAUNCH_MAX_CLOCK_SKEW_MS ||
      (candidate.receiptConfirmedAtMs !== undefined &&
        (typeof candidate.receiptConfirmedAtMs !== "number" ||
          !Number.isSafeInteger(candidate.receiptConfirmedAtMs) ||
          candidate.receiptConfirmedAtMs < candidate.submittedAtMs ||
          candidate.receiptConfirmedAtMs >
            nowMs + PENDING_LAUNCH_MAX_CLOCK_SKEW_MS)) ||
      (candidate.tokenAddress !== undefined &&
        (typeof candidate.tokenAddress !== "string" ||
          !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress))) ||
      (candidate.tokenName !== undefined &&
        (typeof candidate.tokenName !== "string" ||
          candidate.tokenName.trim() !== candidate.tokenName ||
          candidate.tokenName.length === 0 ||
          characterLength(candidate.tokenName) > MAX_TOKEN_NAME_CHARACTERS ||
          utf8ByteLength(candidate.tokenName) > MAX_TOKEN_NAME_BYTES)) ||
      (candidate.tokenSymbol !== undefined &&
        (typeof candidate.tokenSymbol !== "string" ||
          candidate.tokenSymbol.trim() !== candidate.tokenSymbol ||
          candidate.tokenSymbol.length === 0 ||
          characterLength(candidate.tokenSymbol) >
            MAX_TOKEN_SYMBOL_CHARACTERS ||
          utf8ByteLength(candidate.tokenSymbol) > MAX_TOKEN_SYMBOL_BYTES)) ||
      (candidate.estimatedInitialBuyTokenAmount !== undefined &&
        (typeof candidate.estimatedInitialBuyTokenAmount !== "number" ||
          !Number.isFinite(candidate.estimatedInitialBuyTokenAmount) ||
          candidate.estimatedInitialBuyTokenAmount <= 0 ||
          candidate.estimatedInitialBuyTokenAmount >
            MEME_TOKEN_SUPPLY_WHOLE))
    ) {
      return null;
    }

    return {
      version: 2,
      transactionHash: candidate.transactionHash as `0x${string}`,
      account: candidate.account as `0x${string}`,
      chainId: candidate.chainId,
      model: candidate.model as LaunchModel,
      submittedAtMs: candidate.submittedAtMs,
      ...(typeof candidate.receiptConfirmedAtMs === "number"
        ? { receiptConfirmedAtMs: candidate.receiptConfirmedAtMs }
        : {}),
      ...(typeof candidate.tokenAddress === "string"
        ? { tokenAddress: candidate.tokenAddress as `0x${string}` }
        : {}),
      ...(typeof candidate.tokenName === "string"
        ? { tokenName: candidate.tokenName }
        : {}),
      ...(typeof candidate.tokenSymbol === "string"
        ? { tokenSymbol: candidate.tokenSymbol }
        : {}),
      ...(typeof candidate.estimatedInitialBuyTokenAmount === "number"
        ? {
            estimatedInitialBuyTokenAmount:
              candidate.estimatedInitialBuyTokenAmount,
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export function pendingSubmissionIsStale(
  submission: PendingLaunchSubmission,
  nowMs = Date.now(),
) {
  return nowMs - submission.submittedAtMs >= PENDING_LAUNCH_STALE_AFTER_MS;
}

export function pendingSubmissionCanBeDiscarded({
  submission,
  observedHash,
  observedStatus,
  connectedAccount,
  nowMs = Date.now(),
}: {
  submission: PendingLaunchSubmission;
  observedHash: string;
  observedStatus: LaunchReceiptStatus;
  connectedAccount?: string;
  nowMs?: number;
}) {
  return (
    pendingSubmissionIsStale(submission, nowMs) &&
    observedStatus === "not-found" &&
    observedHash.toLowerCase() === submission.transactionHash.toLowerCase() &&
    Boolean(
      connectedAccount &&
        connectedAccount.toLowerCase() === submission.account.toLowerCase(),
    )
  );
}

export function pendingSubmissionForConnectedAccount(
  submission: PendingLaunchSubmission | null,
  model: LaunchModel,
  chainId: 1 | 11_155_111,
  connectedAccount: string | undefined,
) {
  if (
    !submission ||
    !connectedAccount ||
    submission.model !== model ||
    submission.chainId !== chainId ||
    submission.account.toLowerCase() !== connectedAccount.toLowerCase()
  ) {
    return null;
  }
  return submission;
}

export function pendingLaunchSubmissionsMatch(
  left: PendingLaunchSubmission | null | undefined,
  right: PendingLaunchSubmission | null | undefined,
) {
  return Boolean(
    left &&
      right &&
      left.account.toLowerCase() === right.account.toLowerCase() &&
      left.transactionHash.toLowerCase() ===
        right.transactionHash.toLowerCase() &&
      left.chainId === right.chainId &&
      left.model === right.model,
  );
}

export function submissionPhaseForPendingLaunch(
  record: LaunchSubmissionPhaseRecord | null,
  submission: PendingLaunchSubmission | null,
): LaunchSubmissionPhase {
  if (
    !record ||
    !submission ||
    record.account.toLowerCase() !== submission.account.toLowerCase() ||
    record.transactionHash.toLowerCase() !==
      submission.transactionHash.toLowerCase()
  ) {
    return "idle";
  }
  return record.phase;
}

export function launchIsConfirmedButUnindexed(
  submission: PendingLaunchSubmission | null,
  indexedSubmission: PendingLaunchSubmission | null,
) {
  return Boolean(
    submission?.receiptConfirmedAtMs &&
      !pendingLaunchSubmissionsMatch(submission, indexedSubmission),
  );
}

export function readPendingLaunchSubmission(
  storage: PendingLaunchStorage,
  model: LaunchModel,
  chainId: 1 | 11_155_111,
  account: string,
) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(account)) return null;
  try {
    const transactionHash = storage.getItem(
      pendingLaunchPointerKey(model, chainId, account),
    );
    if (
      !transactionHash ||
      !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)
    ) {
      return null;
    }
    const submission = parsePendingLaunchSubmission(
      storage.getItem(
        pendingLaunchStorageKey(model, chainId, account, transactionHash),
      ),
      model,
      chainId,
      account,
    );
    if (
      submission &&
      storage.getItem(pendingLaunchReleasedKey(submission)) === "1"
    ) {
      return null;
    }
    return submission;
  } catch {
    return null;
  }
}

export function writePendingLaunchSubmission(
  storage: PendingLaunchStorage,
  submission: PendingLaunchSubmission,
) {
  try {
    storage.setItem(
      pendingLaunchStorageKey(
        submission.model,
        submission.chainId,
        submission.account,
        submission.transactionHash,
      ),
      JSON.stringify(submission),
    );
    storage.setItem(
      pendingLaunchPointerKey(
        submission.model,
        submission.chainId,
        submission.account,
      ),
      submission.transactionHash,
    );
    return true;
  } catch {
    return false;
  }
}

export function updatePendingLaunchSubmission(
  storage: PendingLaunchStorage,
  submission: PendingLaunchSubmission,
) {
  try {
    storage.setItem(
      pendingLaunchStorageKey(
        submission.model,
        submission.chainId,
        submission.account,
        submission.transactionHash,
      ),
      JSON.stringify(submission),
    );
    return true;
  } catch {
    return false;
  }
}

export function removePendingLaunchSubmission(
  storage: PendingLaunchStorage,
  submission: PendingLaunchSubmission,
) {
  try {
    storage.removeItem(
      pendingLaunchStorageKey(
        submission.model,
        submission.chainId,
        submission.account,
        submission.transactionHash,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

export function releaseConfirmedLaunchSubmission(
  storage: PendingLaunchStorage,
  submission: PendingLaunchSubmission,
) {
  if (!submission.receiptConfirmedAtMs) return false;
  try {
    storage.setItem(pendingLaunchReleasedKey(submission), "1");
    return true;
  } catch {
    return false;
  }
}

export async function pollLaunchReceipt({
  readStatus,
  wait,
  maxAttempts = LAUNCH_RECEIPT_POLL_ATTEMPTS,
  stopOnNotFound = false,
  maxConsecutiveErrors = 2,
}: {
  readStatus: () => Promise<LaunchReceiptStatus>;
  wait: (delayMs: number) => Promise<void>;
  maxAttempts?: number;
  stopOnNotFound?: boolean;
  maxConsecutiveErrors?: number;
}): Promise<LaunchReceiptPollResult> {
  const boundedAttempts = Math.max(1, Math.floor(maxAttempts));
  const boundedErrors = Math.max(0, Math.floor(maxConsecutiveErrors));
  let consecutiveErrors = 0;
  let successfulReads = 0;

  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    try {
      const status = await readStatus();
      successfulReads += 1;
      consecutiveErrors = 0;
      if (status === "confirmed" || status === "reverted") {
        return status;
      }
      if (status === "not-found" && stopOnNotFound) {
        return status;
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        throw caught;
      }
      consecutiveErrors += 1;
      if (consecutiveErrors > boundedErrors) {
        return "unavailable";
      }
    }

    if (attempt + 1 < boundedAttempts) {
      await wait(launchPollDelayMs(attempt));
    }
  }

  return successfulReads === 0 ? "unavailable" : "pending-timeout";
}

export async function pollIndexedLaunch<T>({
  readLaunch,
  wait,
  maxAttempts = LAUNCH_INDEX_POLL_ATTEMPTS,
  maxConsecutiveErrors = 2,
}: {
  readLaunch: (attempt: number) => Promise<T | null>;
  wait: (delayMs: number) => Promise<void>;
  maxAttempts?: number;
  maxConsecutiveErrors?: number;
}): Promise<IndexedLaunchPollResult<T>> {
  const boundedAttempts = Math.max(1, Math.floor(maxAttempts));
  const boundedErrors = Math.max(0, Math.floor(maxConsecutiveErrors));
  let consecutiveErrors = 0;
  let successfulReads = 0;

  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    try {
      const launch = await readLaunch(attempt);
      successfulReads += 1;
      consecutiveErrors = 0;
      if (launch) return { status: "indexed", launch };
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        throw caught;
      }
      consecutiveErrors += 1;
      if (consecutiveErrors > boundedErrors) {
        return { status: "unavailable" };
      }
    }

    if (attempt + 1 < boundedAttempts) {
      await wait(launchIndexPollDelayMs(attempt));
    }
  }

  return successfulReads === 0
    ? { status: "unavailable" }
    : { status: "timeout" };
}

export function stockQuoteOptionTabIndex(
  optionIndex: number,
  activeIndex: number,
) {
  return optionIndex === activeIndex ? 0 : -1;
}

function stockPairedDisplayName(symbol: string, fallback: string) {
  return STOCK_PAIRED_DISPLAY_NAMES[symbol] ?? fallback;
}

function stockPairedLogoUrl(symbol: string) {
  return `https://cdn.ondo.finance/tokens/logos/${symbol.toLowerCase()}_160x160.png`;
}

type StockPairedUiQuoteAsset = StockQuoteAsset | StockPairedV2QuoteAsset;

function stockPairedUiDisplayName(asset: StockPairedUiQuoteAsset) {
  return "displayName" in asset
    ? asset.displayName
    : stockPairedDisplayName(asset.symbol, asset.underlying);
}

function stockPairedUiLogoUrl(asset: StockPairedUiQuoteAsset) {
  return "logoUrl" in asset
    ? asset.logoUrl
    : stockPairedLogoUrl(asset.symbol);
}

function getStockPairedUiQuoteAsset(value: string) {
  return stockPairedLocalPreview
    ? getStockPairedV2QuoteAsset(value)
    : getStockPairedEthQuoteAsset(value);
}

export function findIndexedLaunch(
  value: unknown,
  transactionHash: string,
): IndexedLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const tokens = (value as { tokens?: unknown }).tokens;
  if (!Array.isArray(tokens)) return null;

  for (const token of tokens) {
    if (!token || typeof token !== "object" || Array.isArray(token)) {
      continue;
    }
    const candidate = token as Record<string, unknown>;
    if (
      typeof candidate.launchTransactionHash !== "string" ||
      candidate.launchTransactionHash.toLowerCase() !==
        transactionHash.toLowerCase() ||
      typeof candidate.tokenAddress !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress) ||
      typeof candidate.name !== "string" ||
      typeof candidate.symbol !== "string"
    ) {
      continue;
    }

    const href =
      typeof candidate.href === "string" && candidate.href.startsWith("/token/")
        ? candidate.href
        : `/token/${candidate.tokenAddress}`;
    return {
      address: candidate.tokenAddress as `0x${string}`,
      href,
      name: candidate.name,
      symbol: candidate.symbol,
    };
  }

  return null;
}

export function findClassicV3IndexedLaunch(
  value: unknown,
  transactionHash?: string,
  expectedTokenAddress?: string,
): IndexedLaunch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as { launch?: unknown; token?: unknown };
  const launch = response.token ?? response.launch;
  if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
    return null;
  }
  const candidate = launch as Record<string, unknown>;
  if (
    typeof candidate.tokenAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress) ||
    typeof candidate.name !== "string" ||
    typeof candidate.symbol !== "string" ||
    (transactionHash !== undefined &&
      (typeof candidate.launchTransactionHash !== "string" ||
        candidate.launchTransactionHash.toLowerCase() !==
          transactionHash.toLowerCase())) ||
    (expectedTokenAddress !== undefined &&
      candidate.tokenAddress.toLowerCase() !==
        expectedTokenAddress.toLowerCase())
  ) {
    return null;
  }
  return {
    address: candidate.tokenAddress as `0x${string}`,
    href: `/token/${candidate.tokenAddress}`,
    name: candidate.name,
    symbol: candidate.symbol,
  };
}

export function findDeepV3IndexedLaunch(
  value: unknown,
  transactionHash: string,
): IndexedLaunch | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !/^0x[a-fA-F0-9]{64}$/.test(transactionHash)
  ) {
    return null;
  }
  const launch = (value as { launch?: unknown }).launch;
  if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
    return null;
  }
  const candidate = launch as Record<string, unknown>;
  const provenance = candidate.deepV3Provenance;
  if (
    typeof candidate.tokenAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(candidate.tokenAddress) ||
    typeof candidate.name !== "string" ||
    typeof candidate.symbol !== "string" ||
    candidate.deepReleaseVersion !== "deep-full-range-v3" ||
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance)
  ) {
    return null;
  }
  const proof = provenance as Record<string, unknown>;
  if (
    proof.deepReleaseVersion !== "deep-full-range-v3" ||
    proof.launchModel !== "deep" ||
    typeof proof.tokenAddress !== "string" ||
    proof.tokenAddress.toLowerCase() !== candidate.tokenAddress.toLowerCase() ||
    typeof proof.transactionHash !== "string" ||
    proof.transactionHash.toLowerCase() !== transactionHash.toLowerCase() ||
    typeof proof.launcher !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.launcher) ||
    typeof proof.creator !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.creator) ||
    typeof proof.vaultAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.vaultAddress) ||
    typeof proof.hookAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.hookAddress) ||
    typeof proof.positionRecipient !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(proof.positionRecipient) ||
    typeof proof.positionTokenId !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(proof.positionTokenId) ||
    typeof proof.poolId !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.poolId) ||
    typeof proof.launchHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.launchHash) ||
    typeof proof.vaultConfigurationHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.vaultConfigurationHash) ||
    typeof proof.blockNumber !== "string" ||
    !/^\d+$/.test(proof.blockNumber) ||
    typeof proof.blockHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(proof.blockHash) ||
    !Number.isSafeInteger(proof.transactionIndex) ||
    (proof.transactionIndex as number) < 0 ||
    !Number.isSafeInteger(proof.logIndex) ||
    (proof.logIndex as number) < 0
  ) {
    return null;
  }
  return {
    address: candidate.tokenAddress as `0x${string}`,
    href: `/token/${candidate.tokenAddress}`,
    name: candidate.name,
    symbol: candidate.symbol,
  };
}

function updateDraft(
  setDraft: Dispatch<SetStateAction<LaunchDraft>>,
  patch: Partial<LaunchDraft>,
) {
  setDraft((current) => ({ ...current, ...patch }));
}

function normalizeStandardDraft(initialDraft: LaunchDraft): LaunchDraft {
  const normalizedDraft = {
    ...initialDraft,
  } as LaunchDraft & { classicLiquidityPreset?: unknown };
  delete normalizedDraft.classicLiquidityPreset;
  return {
    ...normalizedDraft,
    launchModel: "classic",
    assetMode: "new",
    tokenSupply: "1000000000",
    liquidityMode: "meme",
    directEthAmount: "",
    directTokenAmount: "",
    directTokensPerEth: "",
    selectedBehaviors: ["fixed-fee"],
    lpFeePercent: "0",
    totalSwapFeePercent: CLASSIC_TOTAL_SWAP_FEE_PERCENT,
    initialBuyEth:
      parseInitialBuyWei(initialDraft.initialBuyEth) === null
        ? MEME_MIN_INITIAL_BUY_ETH
        : initialDraft.initialBuyEth.trim(),
    customHookAddress: "",
    customHookSource: "",
  };
}

export function normalizeClassicV3Draft(
  initialDraft: LaunchDraft,
  enableV4 = false,
): LaunchDraft {
  return {
    ...normalizeStandardDraft(initialDraft),
    launchModel: "classic-v3",
    classicContractRelease: enableV4 ? "classic-v4" : "classic-v3",
    buySwapFeePercent: initialDraft.buySwapFeePercent || "1",
    sellSwapFeePercent: initialDraft.sellSwapFeePercent || "1",
    rewardDestinationMode: initialDraft.rewardDestinationMode || "launcher",
    initialBuyCustodyMode: enableV4
      ? "unlocked"
      : initialDraft.initialBuyCustodyMode || "unlocked",
    initialBuyDurationDays: enableV4
      ? "0"
      : initialDraft.initialBuyDurationDays || "30",
    initialBuyCliffDays: enableV4
      ? "0"
      : initialDraft.initialBuyCliffDays || "7",
  };
}

export function classicMaximumCheckDraft(
  initialDraft: LaunchDraft,
  enableV4: boolean,
): LaunchDraft {
  return enableV4 && initialDraft.launchModel === "classic-v3"
    ? { ...initialDraft, initialBuyEth: MEME_MIN_INITIAL_BUY_ETH }
    : initialDraft;
}

export function normalizeDeepDraft(initialDraft: LaunchDraft): LaunchDraft {
  return {
    ...normalizeClassicV3Draft(initialDraft),
    launchModel: "deep",
    totalSwapFeePercent: "1",
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
    rewardDestinationMode: "launcher",
    rewardExternalAddress: "",
    rewardSplits: [],
  };
}

export function normalizeStockPairedDraft(
  initialDraft: LaunchDraft,
): LaunchDraft {
  const fallbackAsset = stockPairedUiQuoteAssets[0];
  const selectedAsset =
    getStockPairedUiQuoteAsset(initialDraft.stockQuoteAsset) ?? fallbackAsset;
  return {
    ...normalizeClassicV3Draft(initialDraft),
    launchModel: "stock-paired",
    initialBuyEth:
      parseStockInitialBuyEthAmount(initialDraft.initialBuyEth) === null
        ? STOCK_PAIRED_DEFAULT_INITIAL_BUY_ETH
        : initialDraft.initialBuyEth.trim(),
    stockQuoteAsset: selectedAsset.address,
    initialBuyQuoteAmount: "",
    totalSwapFeePercent: "1",
    buySwapFeePercent: "1",
    sellSwapFeePercent: "1",
    rewardDestinationMode: "launcher",
    rewardExternalAddress: "",
    rewardSplits: [],
  };
}

const launchEnvironment =
  process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? "rehearsal"
    : "production";
const launchChainId =
  launchEnvironment === "rehearsal" ? (11_155_111 as const) : (1 as const);
const classicV3LaunchAvailable =
  (process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CLASSIC_V3_UI_PREVIEW === "true") ||
  isConfiguredClassicV3ReleaseReady(launchEnvironment);
const classicV4UiPreviewEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_CLASSIC_V4_UI_PREVIEW === "true";
const classicV4UiReleaseEnabled =
  process.env.NEXT_PUBLIC_CLASSIC_V4_UI_ENABLED === "true";
const classicV4UiEnabled =
  classicV4UiPreviewEnabled || classicV4UiReleaseEnabled;

export function classicV4TransactionBlockReason(
  model: LaunchModel,
  previewEnabled: boolean,
  releaseEnabled = false,
) {
  return model === "classic-v3" && previewEnabled && !releaseEnabled
    ? "Classic V4 is a preview. Wallet transactions stay disabled until the V4 deployment and preflight release are verified."
    : "";
}
function browserPendingLaunchStorages(): PendingLaunchStorage[] {
  if (typeof window === "undefined") return [];
  const storages: PendingLaunchStorage[] = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
  try {
    storages.push(window.sessionStorage);
  } catch {
    // Session storage remains an optional fallback.
  }
  return storages;
}

function readBrowserPendingLaunch(
  model: LaunchModel,
  account: string | undefined,
) {
  if (!account) return null;
  let latest: PendingLaunchSubmission | null = null;
  for (const storage of browserPendingLaunchStorages()) {
    const submission = readPendingLaunchSubmission(
      storage,
      model,
      launchChainId,
      account,
    );
    if (
      submission &&
      (!latest ||
        submission.submittedAtMs > latest.submittedAtMs ||
        (submission.submittedAtMs === latest.submittedAtMs &&
          submission.transactionHash.toLowerCase() >
            latest.transactionHash.toLowerCase()))
    ) {
      latest = submission;
    }
  }
  return latest;
}

function emitPendingLaunchChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PENDING_LAUNCH_CHANGED_EVENT));
  }
}

function writeBrowserPendingLaunch(submission: PendingLaunchSubmission) {
  let persisted = false;
  for (const storage of browserPendingLaunchStorages()) {
    persisted = writePendingLaunchSubmission(storage, submission) || persisted;
  }
  if (persisted) emitPendingLaunchChanged();
  return persisted;
}

function updateBrowserPendingLaunch(submission: PendingLaunchSubmission) {
  let persisted = false;
  for (const storage of browserPendingLaunchStorages()) {
    persisted =
      updatePendingLaunchSubmission(storage, submission) || persisted;
  }
  if (persisted) emitPendingLaunchChanged();
  return persisted;
}

function removeBrowserPendingLaunch(submission: PendingLaunchSubmission) {
  for (const storage of browserPendingLaunchStorages()) {
    removePendingLaunchSubmission(storage, submission);
  }
  emitPendingLaunchChanged();
}

function releaseBrowserConfirmedLaunch(
  submission: PendingLaunchSubmission,
) {
  let released = false;
  for (const storage of browserPendingLaunchStorages()) {
    released =
      releaseConfirmedLaunchSubmission(storage, submission) || released;
  }
  if (released) emitPendingLaunchChanged();
  return released;
}

function subscribePendingLaunch(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const notify = () => listener();
  window.addEventListener("storage", notify);
  window.addEventListener(PENDING_LAUNCH_CHANGED_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(PENDING_LAUNCH_CHANGED_EVENT, notify);
  };
}

function useBrowserPendingLaunch(
  model: LaunchModel,
  account: string | undefined,
) {
  const getSnapshot = useCallback(() => {
    const submission = readBrowserPendingLaunch(model, account);
    return submission
      ? JSON.stringify(submission)
      : PENDING_LAUNCH_EMPTY_SNAPSHOT;
  }, [account, model]);
  const serialized = useSyncExternalStore(
    subscribePendingLaunch,
    getSnapshot,
    () => "",
  );
  const submission = useMemo(
    () =>
      account &&
      serialized &&
      serialized !== PENDING_LAUNCH_EMPTY_SNAPSHOT
        ? parsePendingLaunchSubmission(
            serialized,
            model,
            launchChainId,
            account,
          )
        : null,
    [account, model, serialized],
  );
  return {
    pendingRestoreComplete: Boolean(serialized),
    submission,
  };
}

function useBrowserWalletRequestPending(account: string | undefined) {
  const chainId = String(launchChainId);
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToBrowserWalletRequest(account, chainId, listener),
    [account, chainId],
  );
  const snapshot = useCallback(
    () => browserWalletRequestIsPending(account, chainId),
    [account, chainId],
  );
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function createLaunchSalt() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function LaunchBuilderForm({
  model,
  onBackToModels,
  stockPairedPublicLaunchEnabled,
}: {
  model: LaunchModel;
  onBackToModels: () => void;
  stockPairedPublicLaunchEnabled: boolean;
}) {
  if (model === "deep") return null;

  const initialDraft =
    model === "stock-paired"
      ? normalizeStockPairedDraft(createStockPairedDraft())
      : model === "classic-v3"
        ? normalizeClassicV3Draft(createClassicV3Draft(), classicV4UiEnabled)
        : normalizeStandardDraft(createEmptyDraft());

  return (
    <LaunchBuilderFormView
      model={model}
      initialDraft={initialDraft}
      onBackToModels={onBackToModels}
      stockPairedPublicLaunchEnabled={stockPairedPublicLaunchEnabled}
    />
  );
}

function LaunchBuilderFormView({
  model,
  initialDraft,
  onBackToModels,
  stockPairedPublicLaunchEnabled,
}: {
  model: LaunchModel;
  initialDraft: LaunchDraft;
  onBackToModels: () => void;
  stockPairedPublicLaunchEnabled: boolean;
}) {
  const {
    wallet,
    walletLinked,
    openWallet,
    openWalletWithError,
    readNativeBalance,
    sendTransaction,
    getAccessToken,
    getIdentityToken,
  } = useWallet();
  const [draft, setDraft] = useState<LaunchDraft>(initialDraft);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>("idle");
  const [submissionPhaseRecord, setSubmissionPhaseRecord] =
    useState<LaunchSubmissionPhaseRecord | null>(null);
  const [submissionPersistenceWarning, setSubmissionPersistenceWarning] =
    useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [currentDraftSubmissionHash, setCurrentDraftSubmissionHash] =
    useState("");
  const [submittedDraftVersion, setSubmittedDraftVersion] = useState<
    number | null
  >(null);
  const [currentSubmission, setCurrentSubmission] =
    useState<PendingLaunchSubmission | null>(null);
  const [transactionObservation, setTransactionObservation] = useState<{
    account: string;
    hash: string;
    status: LaunchReceiptStatus;
  } | null>(null);
  const [discardingStaleSubmission, setDiscardingStaleSubmission] =
    useState(false);
  const [confirmationRetryKey, setConfirmationRetryKey] = useState(0);
  const [indexedLaunchRecord, setIndexedLaunchRecord] =
    useState<IndexedLaunchRecord | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const successShownTransactionRef = useRef("");
  const closeSuccessDialog = useCallback(() => {
    setSuccessOpen(false);
  }, []);
  const [settingMaxBuy, setSettingMaxBuy] = useState(false);
  const [tokenImageState, setTokenImageState] =
    useState<TokenImageState>(emptyTokenImageState);
  const currentLaunchContext = useRef({ draft, wallet });
  const draftVersion = useRef(0);
  const {
    pendingRestoreComplete,
    submission: storedSubmission,
  } = useBrowserPendingLaunch(model, wallet?.account);
  const activeCurrentSubmission = pendingSubmissionForConnectedAccount(
    currentSubmission,
    model,
    launchChainId,
    wallet?.account,
  );
  const activeSubmission = activeCurrentSubmission ?? storedSubmission;
  const transactionHash = activeSubmission?.transactionHash ?? "";
  const submittedAccount = activeSubmission?.account ?? "";
  const submittedChainId = activeSubmission?.chainId ?? null;
  const indexedLaunch =
    activeSubmission &&
    indexedLaunchRecord &&
    pendingLaunchSubmissionsMatch(
      indexedLaunchRecord.submission,
      activeSubmission,
    )
      ? indexedLaunchRecord.launch
      : null;
  const successLaunch = launchSuccessSummary(activeSubmission, indexedLaunch);
  const confirmedButUnindexed = launchIsConfirmedButUnindexed(
    activeSubmission,
    indexedLaunchRecord?.submission ?? null,
  );
  const submissionPhase = submissionPhaseForPendingLaunch(
    submissionPhaseRecord,
    activeSubmission,
  );
  const setSubmissionPhaseFor = useCallback(
    (
      submission: PendingLaunchSubmission,
      phase: LaunchSubmissionPhase,
    ) => {
      setSubmissionPhaseRecord({
        account: submission.account,
        transactionHash: submission.transactionHash,
        phase,
      });
    },
    [],
  );
  const clearSubmissionPhase = useCallback(() => {
    setSubmissionPhaseRecord(null);
  }, []);
  const launching = launchPhase !== "idle";
  const walletRequestPending = useBrowserWalletRequestPending(wallet?.account);
  const submissionBusy =
    Boolean(transactionHash) &&
    (submissionPhase === "receipt" || submissionPhase === "indexing");
  const hasSubmittedTransaction = Boolean(transactionHash);
  const unresolvedSubmission = Boolean(transactionHash) && !indexedLaunch;
  const draftLocked = walletRequestPending || launchDraftIsLocked(
    pendingRestoreComplete,
    launchPhase,
    transactionHash,
  );
  const setEditableDraft = useCallback<Dispatch<SetStateAction<LaunchDraft>>>(
    (action) => {
      if (draftLocked) return;
      setDraft(action);
    },
    [draftLocked],
  );
  const usesExtendedLayout =
    model === "classic-v3" || model === "deep" || model === "stock-paired";
  const stockPairedLaunchAllowed = stockPairedPublicLaunchEnabled;
  const submittingWalletConnected = Boolean(
    activeSubmission &&
      wallet &&
      wallet.account.toLowerCase() === activeSubmission.account.toLowerCase(),
  );
  const staleSubmissionNotFound = Boolean(
    activeSubmission &&
      pendingSubmissionIsStale(activeSubmission) &&
      transactionObservation?.account.toLowerCase() ===
        activeSubmission.account.toLowerCase() &&
      transactionObservation?.hash.toLowerCase() ===
        activeSubmission.transactionHash.toLowerCase() &&
      transactionObservation.status === "not-found",
  );
  const canDiscardStaleSubmission = Boolean(
    activeSubmission &&
      transactionObservation &&
      transactionObservation.account.toLowerCase() ===
        activeSubmission.account.toLowerCase() &&
      pendingSubmissionCanBeDiscarded({
        submission: activeSubmission,
        observedHash: transactionObservation.hash,
        observedStatus: transactionObservation.status,
        connectedAccount: wallet?.account,
      }),
  );

  useEffect(() => {
    currentLaunchContext.current = { draft, wallet };
  }, [draft, wallet]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (
      !activeSubmission ||
      !successLaunch ||
      !shouldRestoreConfirmedLaunchSuccess(activeSubmission)
    ) {
      return;
    }
    const transactionKey = `${activeSubmission.chainId}:${activeSubmission.transactionHash.toLowerCase()}`;
    if (successShownTransactionRef.current === transactionKey) return;
    successShownTransactionRef.current = transactionKey;
    setSuccessOpen(true);
    setNotice("Launch successful");
  }, [activeSubmission, successLaunch]);

  useEffect(() => {
    if (
      !launchIndexShouldRetryAutomatically(
        confirmedButUnindexed,
        submissionPhase,
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setConfirmationRetryKey((current) => current + 1);
    }, LAUNCH_INDEX_AUTO_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [confirmedButUnindexed, submissionPhase]);

  useEffect(() => {
    if (
      !transactionHash ||
      !submittedAccount ||
      !submittedChainId ||
      indexedLaunch
    ) {
      return;
    }

    const controller = new AbortController();
    const wait = (delayMs: number) =>
      new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new DOMException("Launch polling aborted", "AbortError"));
          return;
        }

        const timer = window.setTimeout(() => {
          controller.signal.removeEventListener("abort", abort);
          resolve();
        }, delayMs);
        const abort = () => {
          window.clearTimeout(timer);
          controller.signal.removeEventListener("abort", abort);
          reject(new DOMException("Launch polling aborted", "AbortError"));
        };
        controller.signal.addEventListener("abort", abort, { once: true });
      });

    const readReceipt = async (): Promise<LaunchReceiptStatus> => {
      const response = await fetch(
        `/api/transaction-status?hash=${encodeURIComponent(
          transactionHash,
        )}&chainId=${submittedChainId}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        !["pending", "confirmed", "reverted", "not-found"].includes(
          String((body as { status?: unknown }).status),
        )
      ) {
        throw new Error("Transaction status is unavailable");
      }
      const status = (body as { status: LaunchReceiptStatus }).status;
      setTransactionObservation({
        account: submittedAccount,
        hash: transactionHash,
        status,
      });
      return status;
    };

    const readIndexedLaunch = async (
      attempt: number,
    ): Promise<IndexedLaunch | null> => {
      const endpoint =
        model === "deep"
          ? `/api/explore/launch/deep-v3?account=${encodeURIComponent(
              submittedAccount,
            )}&transaction=${encodeURIComponent(transactionHash)}`
          : model === "stock-paired"
            ? `/api/explore/launch/stock-paired?account=${encodeURIComponent(
                submittedAccount,
              )}&transaction=${encodeURIComponent(transactionHash)}`
            : model === "classic-v3"
              ? `/api/profile/classic-v3?account=${encodeURIComponent(
                  submittedAccount,
                )}&launch=${encodeURIComponent(transactionHash)}`
              : `/api/explore/profile?account=${encodeURIComponent(
                  submittedAccount,
                )}&launch=${encodeURIComponent(
                  transactionHash,
                )}&attempt=${attempt}`;
      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("Launch index is unavailable");
      return model === "deep"
        ? findDeepV3IndexedLaunch(body, transactionHash)
        : model === "stock-paired"
          ? findClassicV3IndexedLaunch(body)
          : model === "classic-v3" && activeSubmission?.tokenAddress
            ? findClassicV3IndexedLaunch(
                body,
                transactionHash,
                activeSubmission.tokenAddress,
              )
            : model === "classic-v3"
              ? findIndexedLaunch(body, transactionHash)
          : findIndexedLaunch(body, transactionHash);
    };

    const confirmLaunch = async () => {
      if (!activeSubmission) return;
      try {
        setSubmissionPhaseFor(activeSubmission, "receipt");
        const receipt = await pollLaunchReceipt({
          readStatus: readReceipt,
          wait,
          stopOnNotFound: Boolean(
            activeSubmission && pendingSubmissionIsStale(activeSubmission),
          ),
        });
        if (controller.signal.aborted) return;

        if (receipt === "reverted") {
          setSubmissionPhaseFor(activeSubmission, "reverted");
          return;
        }
        if (receipt === "unavailable") {
          setSubmissionError("");
          setSubmissionPhaseFor(activeSubmission, "receipt-unavailable");
          return;
        }
        if (receipt === "pending-timeout" || receipt === "not-found") {
          setSubmissionPhaseFor(activeSubmission, "pending-timeout");
          return;
        }

        const confirmedSubmission = activeSubmission.receiptConfirmedAtMs
          ? activeSubmission
          : {
              ...activeSubmission,
              receiptConfirmedAtMs: Date.now(),
            };
        if (!activeSubmission.receiptConfirmedAtMs) {
          updateBrowserPendingLaunch(confirmedSubmission);
          setCurrentSubmission(confirmedSubmission);
        }

        setSubmissionPhaseFor(confirmedSubmission, "indexing");
        const indexedResult = await pollIndexedLaunch({
          readLaunch: readIndexedLaunch,
          wait,
        });
        if (controller.signal.aborted) return;

        if (indexedResult.status === "unavailable") {
          setSubmissionError("");
          setSubmissionPhaseFor(confirmedSubmission, "index-unavailable");
          return;
        }
        if (indexedResult.status === "timeout") {
          setSubmissionPhaseFor(confirmedSubmission, "index-timeout");
          return;
        }
        const launch = indexedResult.launch;

        setCurrentSubmission(confirmedSubmission);
        removeBrowserPendingLaunch(confirmedSubmission);
        setSubmissionPersistenceWarning(false);
        setSubmissionError("");
        setIndexedLaunchRecord({
          launch,
          submission: confirmedSubmission,
        });
        clearSubmissionPhase();
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setSubmissionError("");
        setSubmissionPhaseFor(activeSubmission, "receipt-unavailable");
      }
    };

    void confirmLaunch();
    return () => controller.abort();
  }, [
    confirmationRetryKey,
    activeSubmission,
    indexedLaunch,
    model,
    submittedAccount,
    submittedChainId,
    clearSubmissionPhase,
    currentDraftSubmissionHash,
    setSubmissionPhaseFor,
    submittedDraftVersion,
    transactionHash,
  ]);

  function validateLaunch(checkedDraft = draft) {
    if (
      tokenImageState.status === "preparing" ||
      tokenImageState.status === "waiting" ||
      tokenImageState.status === "uploading"
    ) {
      return "Wait for the token image to finish uploading";
    }
    if (tokenImageState.status === "error") {
      return tokenImageState.message || "Choose the token image again";
    }
    try {
      if (model === "deep") {
        if (!wallet) return "Connect a wallet to verify the launch";
        validateDeepV3LaunchDraft(checkedDraft, wallet.account);
      } else if (model === "stock-paired") {
        if (!wallet) return "Connect a wallet to verify the launch";
        if (!stockPairedLaunchAllowed) {
          return "Stock-Paired is coming soon";
        }
        validateStockPairedLaunchDraft(checkedDraft, wallet.account);
      } else if (model === "classic-v3") {
        if (!wallet) return "Connect a wallet to verify the reward setup";
        if (classicV4UiEnabled) {
          validateClassicV4LaunchDraft(checkedDraft, wallet.account);
        } else {
          validateClassicV3LaunchDraft(checkedDraft, wallet.account);
        }
      } else {
        validateMemeLaunchDraft(checkedDraft);
      }
      return "";
    } catch (caught) {
      return caught instanceof Error
        ? caught.message
        : "Check the token details and try again";
    }
  }

  function markDraftEdited() {
    if (draftLocked) return;
    draftVersion.current += 1;
    setFormError("");
    setIndexedLaunchRecord(null);
    setSuccessOpen(false);
  }

  async function requestLaunchCheck(
    checkedDraft: LaunchDraft,
    connectedWallet: NonNullable<typeof wallet>,
  ) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 65_000);

    try {
      let headers = new Headers({ "Content-Type": "application/json" });
      if (
        classicV4UiReleaseEnabled
        && checkedDraft.launchModel === "classic-v3"
        && checkedDraft.classicContractRelease === "classic-v4"
      ) {
        // Privy's identity lookup can refresh the session. Fetch it before the
        // access token instead of racing both credentials in parallel.
        headers = await createClassicLaunchPreflightHeaders({
          getAccessToken,
          getIdentityToken,
        });
      }
      const response = await fetch("/api/launch/preflight", {
        method: "POST",
        headers,
        body: JSON.stringify({
          account: connectedWallet.account,
          walletChainId: connectedWallet.chainId,
          draft: checkedDraft,
        }),
        signal: controller.signal,
      });
      const body = (await response.json()) as
        LaunchPreflightResponse | { error: string };
      if (!response.ok || "error" in body) {
        throw new Error(
          "error" in body ? body.error : "The launch could not be checked",
        );
      }
      return body;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        throw new Error("The launch check timed out. Try again");
      }
      throw caught;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function persistLaunchDraft(
    nextDraft: LaunchDraft,
    connectedWallet = currentLaunchContext.current.wallet,
  ) {
    setDraft(nextDraft);
    currentLaunchContext.current = {
      draft: nextDraft,
      wallet: connectedWallet,
    };
  }

  async function setMaximumDevBuy() {
    if (!wallet || settingMaxBuy || draftLocked) {
      if (!wallet) openWallet();
      return;
    }

    const maximumCheckDraft = classicMaximumCheckDraft(
      draft,
      model === "classic-v3" && classicV4UiEnabled,
    );
    const validationError = validateLaunch(maximumCheckDraft);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSettingMaxBuy(true);
    setFormError("");

    try {
      let checkedDraft =
        model === "deep"
          ? normalizeDeepDraft(maximumCheckDraft)
          : model === "stock-paired"
            ? normalizeStockPairedDraft(maximumCheckDraft)
            : model === "classic-v3"
              ? normalizeClassicV3Draft(
                  maximumCheckDraft,
                  classicV4UiEnabled,
                )
              : normalizeStandardDraft(maximumCheckDraft);
      if (!/^0x[a-fA-F0-9]{64}$/.test(checkedDraft.launchSalt)) {
        checkedDraft = {
          ...checkedDraft,
          launchSalt: createLaunchSalt(),
          updatedAt: new Date().toISOString(),
        };
      }

      const prepared = await prepareLaunch(checkedDraft, wallet);
      const balances = await readNativeBalance();
      const gasLimit = BigInt(prepared.transaction.gasLimit);
      let maximum = maximumClassicDevBuyWei({
        nativeBalanceWei: balances.nativeBalanceWei,
        gasLimit,
        gasPriceWei: balances.gasPriceWei,
      });
      if (model === "classic-v3" && classicV4UiEnabled) {
        const curve = getClassicInitialBuyCurveQuote(
          MEME_MIN_INITIAL_BUY_ETH,
          checkedDraft.buySwapFeePercent,
        );
        if (
          curve.status === "ready" &&
          curve.preview.maximumGrossActivationBuyWei !== null &&
          maximum > curve.preview.maximumGrossActivationBuyWei
        ) {
          maximum = curve.preview.maximumGrossActivationBuyWei;
        }
      }
      const minimum = parseInitialBuyWei(MEME_MIN_INITIAL_BUY_ETH) ?? 0n;

      if (maximum < minimum) {
        throw new Error(
          "This wallet needs more ETH for the minimum Activation Buy and network gas",
        );
      }

      markDraftEdited();
      persistLaunchDraft(
        {
          ...prepared.checkedDraft,
          initialBuyEth: formatEther(maximum),
          updatedAt: new Date().toISOString(),
        },
        wallet,
      );
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "The maximum Activation Buy could not be calculated",
      );
    } finally {
      setSettingMaxBuy(false);
    }
  }

  async function prepareLaunch(
    initialLaunchDraft: LaunchDraft,
    connectedWallet: NonNullable<typeof wallet>,
  ) {
    const previewBlockReason = classicV4TransactionBlockReason(
      initialLaunchDraft.launchModel,
      classicV4UiPreviewEnabled,
      classicV4UiReleaseEnabled,
    );
    if (previewBlockReason) throw new Error(previewBlockReason);

    let checkedDraft = initialLaunchDraft;
    let result = await requestLaunchCheck(checkedDraft, connectedWallet);

    if (result.draftPatch) {
      checkedDraft = {
        ...checkedDraft,
        ...result.draftPatch,
        updatedAt: new Date().toISOString(),
      };
      persistLaunchDraft(checkedDraft, connectedWallet);
      result = await requestLaunchCheck(checkedDraft, connectedWallet);
    }

    if (result.status !== "ready" || !result.transaction || !result.planHash) {
      throw new Error(result.detail || "The launch could not be prepared");
    }
    if (
      checkedDraft.classicContractRelease === "classic-v4" &&
      (!result.releaseLauncher || !result.releaseManifestDigest)
    ) {
      throw new Error(
        "Classic V4 is not enabled by a public release manifest",
      );
    }

    return {
      kind: "launch" as const,
      checkedDraft,
      planHash: result.planHash,
      predictedToken: result.predictedToken,
      releaseLauncher: result.releaseLauncher,
      releaseManifestDigest: result.releaseManifestDigest,
      transaction: result.transaction,
    };
  }

  async function launchToken() {
    if (draftLocked) return;

    const previewBlockReason = classicV4TransactionBlockReason(
      model,
      classicV4UiPreviewEnabled,
      classicV4UiReleaseEnabled,
    );
    if (previewBlockReason) {
      setFormError(previewBlockReason);
      return;
    }

    if (!wallet) {
      openWallet();
      return;
    }

    if (blockUnlinkedClassicV4Launch({
      hasWallet: true,
      launchModel: model,
      onBlocked: (message) => {
        setFormError(message);
        openWalletWithError(message);
      },
      releaseEnabled: classicV4UiReleaseEnabled,
      walletLinked,
    })) {
      return;
    }

    const validationError = validateLaunch();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const launchWallet = { ...wallet };
    const launchDraftVersion = draftVersion.current;
    let checkedDraft =
      model === "deep"
        ? normalizeDeepDraft(draft)
        : model === "stock-paired"
          ? normalizeStockPairedDraft(draft)
          : model === "classic-v3"
            ? normalizeClassicV3Draft(draft, classicV4UiEnabled)
            : normalizeStandardDraft(draft);
    if (!/^0x[a-fA-F0-9]{64}$/.test(checkedDraft.launchSalt)) {
      checkedDraft = {
        ...checkedDraft,
        launchSalt: createLaunchSalt(),
        updatedAt: new Date().toISOString(),
      };
    }
    persistLaunchDraft(checkedDraft, launchWallet);
    setFormError("");
    setLaunchPhase("preparing");
    clearSubmissionPhase();
    setCurrentSubmission(null);
    setTransactionObservation(null);
    setCurrentDraftSubmissionHash("");
    setSubmittedDraftVersion(null);
    setSubmissionPersistenceWarning(false);

    try {
      const prepared = await prepareLaunch(checkedDraft, launchWallet);
      checkedDraft = prepared.checkedDraft;

      const latest = currentLaunchContext.current;
      if (
        draftVersion.current !== launchDraftVersion ||
        !latest.wallet ||
        latest.wallet.account.toLowerCase() !==
          launchWallet.account.toLowerCase() ||
        latest.wallet.chainId.toLowerCase() !==
          launchWallet.chainId.toLowerCase()
      ) {
        throw new Error("The token or connected wallet changed. Try again");
      }

      const validatedTransaction =
        model === "deep"
          ? await validatePreparedDeepV3LaunchTransaction({
              transaction: prepared.transaction,
              draft: checkedDraft,
              account: launchWallet.account,
              planHash: prepared.planHash,
            })
          : model === "stock-paired"
            ? validatePreparedStockPairedLaunchTransaction({
                transaction: prepared.transaction,
                draft: checkedDraft,
                account: launchWallet.account,
                planHash: prepared.planHash,
              })
            : model === "classic-v3"
              ? checkedDraft.classicContractRelease === "classic-v4"
                ? validatePreparedClassicV4LaunchTransaction({
                    transaction: prepared.transaction,
                    draft: checkedDraft,
                    account: launchWallet.account,
                    planHash: prepared.planHash,
                    releaseLauncher: prepared.releaseLauncher,
                    releaseManifestDigest: prepared.releaseManifestDigest,
                  })
                : validatePreparedClassicV3LaunchTransaction({
                    transaction: prepared.transaction,
                    draft: checkedDraft,
                    account: launchWallet.account,
                    planHash: prepared.planHash,
                  })
              : validatePreparedClassicLaunchTransaction({
                  transaction: prepared.transaction,
                  draft: checkedDraft,
                  account: launchWallet.account,
                  planHash: prepared.planHash,
                });
      setLaunchPhase("confirming");
      const hash = await sendTransaction(validatedTransaction);
      const initialBuyPreview =
        model === "classic-v3"
          ? classicV4UiEnabled
            ? getClassicInitialBuyPreview(
                checkedDraft.initialBuyEth,
                checkedDraft.buySwapFeePercent,
              )
            : getLegacyClassicInitialBuyPreview(
                checkedDraft.initialBuyEth,
                checkedDraft.buySwapFeePercent,
              )
          : null;
      const pendingSubmission: PendingLaunchSubmission = {
        version: 2,
        transactionHash: hash,
        account: launchWallet.account,
        chainId: launchChainId,
        model,
        submittedAtMs: Date.now(),
        ...(prepared.predictedToken
          ? { tokenAddress: prepared.predictedToken }
          : {}),
        tokenName: checkedDraft.tokenName.trim(),
        tokenSymbol: checkedDraft.tokenSymbol.trim(),
        ...(initialBuyPreview
          ? {
              estimatedInitialBuyTokenAmount: initialBuyPreview.tokenAmount,
            }
          : {}),
      };
      setSubmissionPersistenceWarning(
        !writeBrowserPendingLaunch(pendingSubmission),
      );
      setCurrentSubmission(pendingSubmission);
      setTransactionObservation(null);
      setCurrentDraftSubmissionHash(hash);
      setSubmittedDraftVersion(draftVersion.current);
      setSubmissionError("");
      setSubmissionPhaseFor(pendingSubmission, "receipt");
      setNotice("Confirming launch");
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "The launch did not complete. Try again",
      );
    } finally {
      setLaunchPhase("idle");
    }
  }

  function retryLaunchConfirmation() {
    if (!transactionHash || submissionBusy || indexedLaunch) return;
    setSubmissionError("");
    setConfirmationRetryKey((current) => current + 1);
  }

  function returnToModels() {
    if (confirmedButUnindexed && activeSubmission) {
      releaseBrowserConfirmedLaunch(activeSubmission);
      setCurrentSubmission(null);
      setTransactionObservation(null);
      setCurrentDraftSubmissionHash("");
      setSubmittedDraftVersion(null);
      clearSubmissionPhase();
      setIndexedLaunchRecord(null);
      setSuccessOpen(false);
      setSubmissionError("");
      setSubmissionPersistenceWarning(false);
    }
    onBackToModels();
  }

  function resetRevertedLaunch() {
    if (submissionPhase !== "reverted" || !activeSubmission) return;
    removeBrowserPendingLaunch(activeSubmission);
    setCurrentSubmission(null);
    setTransactionObservation(null);
    setCurrentDraftSubmissionHash("");
    setSubmittedDraftVersion(null);
    clearSubmissionPhase();
    setIndexedLaunchRecord(null);
    setSuccessOpen(false);
    setFormError("");
    setSubmissionError("");
    setSubmissionPersistenceWarning(false);
    setDraft((current) => ({
      ...current,
      launchSalt: createLaunchSalt(),
      updatedAt: new Date().toISOString(),
    }));
    draftVersion.current += 1;
  }

  async function discardStaleLaunch() {
    if (
      !activeSubmission ||
      !canDiscardStaleSubmission ||
      discardingStaleSubmission ||
      submissionBusy
    ) {
      return;
    }

    setDiscardingStaleSubmission(true);
    setSubmissionError("");
    try {
      const response = await fetch(
        `/api/transaction-status?hash=${encodeURIComponent(
          activeSubmission.transactionHash,
        )}&chainId=${activeSubmission.chainId}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );
      const body: unknown = await response.json();
      const status =
        body && typeof body === "object" && !Array.isArray(body)
          ? String((body as { status?: unknown }).status)
          : "";
      if (
        !response.ok ||
        !["pending", "confirmed", "reverted", "not-found"].includes(status)
      ) {
        throw new Error("The transaction status is temporarily unavailable.");
      }

      if (status === "not-found") {
        const latestWallet = currentLaunchContext.current.wallet;
        if (
          !latestWallet ||
          latestWallet.account.toLowerCase() !==
            activeSubmission.account.toLowerCase()
        ) {
          throw new Error(
            "Reconnect the wallet that submitted this launch before discarding its browser record.",
          );
        }
        removeBrowserPendingLaunch(activeSubmission);
        setCurrentSubmission(null);
        setTransactionObservation(null);
        setCurrentDraftSubmissionHash("");
        setSubmittedDraftVersion(null);
        clearSubmissionPhase();
        setSubmissionPersistenceWarning(false);
        setIndexedLaunchRecord(null);
        setSuccessOpen(false);
        setNotice("Stale launch record removed");
        return;
      }

      const observedStatus = status as LaunchReceiptStatus;
      setTransactionObservation({
        account: activeSubmission.account,
        hash: activeSubmission.transactionHash,
        status: observedStatus,
      });
      if (observedStatus === "reverted") {
        setSubmissionPhaseFor(activeSubmission, "reverted");
        return;
      }

      setSubmissionPhaseFor(activeSubmission, "receipt");
      setConfirmationRetryKey((current) => current + 1);
    } catch (caught) {
      setSubmissionError(
        caught instanceof Error
          ? caught.message
          : "The transaction status is temporarily unavailable.",
      );
    } finally {
      setDiscardingStaleSubmission(false);
    }
  }

  const submittedExplorer =
    submittedChainId === 11_155_111
      ? "https://sepolia.etherscan.io"
      : "https://etherscan.io";
  const submissionStatusLabel =
    submissionPhase === "reverted"
      ? "Launch reverted"
      : staleSubmissionNotFound
        ? "Stored launch not found"
        : submissionPhase === "receipt-unavailable"
          ? "Transaction status unavailable"
          : submissionPhase === "index-unavailable"
            ? "Token index unavailable"
        : submissionPhase === "pending-timeout"
          ? "Transaction still pending"
          : submissionPhase === "index-timeout"
            ? "Token is being indexed"
            : submissionPhase === "indexing"
              ? "Adding token"
              : "Confirming transaction";
  const submissionStatusDetail =
    staleSubmissionNotFound
      ? submittingWalletConnected
        ? "This transaction has not appeared on the configured Ethereum providers for over 24 hours. You can check once more and discard only this browser record."
        : "Connect the wallet that submitted this launch to resolve its stale browser record."
      : submissionPhase === "reverted"
        ? "No token was created. Review the transaction before trying again."
        : submissionPhase === "receipt-unavailable"
          ? "The network could not confirm this transaction status. Try the same transaction again."
          : submissionPhase === "index-unavailable"
            ? "The transaction is confirmed, but the token index could not be reached. Try again."
        : submissionPhase === "pending-timeout"
          ? "Check the same transaction again before taking another action."
          : submissionPhase === "index-timeout"
            ? "The transaction is confirmed. The token may take a little longer to appear."
            : "";
  const controlsLockMessage = !pendingRestoreComplete
    ? "Checking this browser for an unfinished launch."
    : walletRequestPending && !launching
      ? "A wallet confirmation is already open for this account. If that tab closed, this unlocks within five minutes."
    : launching
      ? "Token details are locked while the transaction is prepared."
      : unresolvedSubmission
        ? confirmedButUnindexed
          ? "This launch is complete. View the token or go back."
          : "Token details are locked to the submitted transaction. Check its status before taking another action."
        : hasSubmittedTransaction
          ? "This completed launch is locked. View the token or go back."
          : "";

  const launchStatus: ReactNode = indexedLaunch ? (
    <p>
      {indexedLaunch.name} <span>·</span> ${indexedLaunch.symbol}
    </p>
  ) : confirmedButUnindexed ? (
    successLaunch ? (
      <p>
        {successLaunch.name} <span>·</span> ${successLaunch.symbol}
      </p>
    ) : (
      <p>Launch confirmed</p>
    )
  ) : transactionHash ? (
    <>
      <a
        className="transaction-link"
        href={`${submittedExplorer}/tx/${transactionHash}`}
        target="_blank"
        rel="noreferrer"
      >
        {submissionStatusLabel}
        <span>{shortenAddress(transactionHash)}</span>
      </a>
      {submissionStatusDetail ? (
        <p
          role={
            submissionPhase === "reverted" ||
            submissionPhase === "receipt-unavailable" ||
            submissionPhase === "index-unavailable"
              ? "alert"
              : "status"
          }
        >
          {submissionStatusDetail}
        </p>
      ) : null}
      {submissionPersistenceWarning ? (
        <p role="alert">
          Keep this page open until the submitted transaction is confirmed.
        </p>
      ) : null}
      {submissionError ? <p role="alert">{submissionError}</p> : null}
    </>
  ) : formError ? (
    <p className="form-error" id="launch-form-error" role="alert">
      {formError}
    </p>
  ) : null;

  const launchAction: ReactNode = indexedLaunch ? (
    <Link
      className="primary-button classic-launch-button"
      href={indexedLaunch.href}
    >
      View token
    </Link>
  ) : confirmedButUnindexed ? (
    successLaunch ? (
      <Link
        className="primary-button classic-launch-button"
        href={successLaunch.href}
      >
        View token
      </Link>
    ) : (
      <button
        className="primary-button classic-launch-button"
        type="button"
        disabled
      >
        Launch confirmed
      </button>
    )
  ) : transactionHash ? (
    <button
      className="primary-button classic-launch-button"
      type="button"
      disabled={submissionBusy || discardingStaleSubmission}
      onClick={
        canDiscardStaleSubmission
          ? () => void discardStaleLaunch()
          : staleSubmissionNotFound
            ? openWallet
            : submissionPhase === "reverted"
              ? resetRevertedLaunch
              : retryLaunchConfirmation
      }
    >
      {discardingStaleSubmission
        ? "Checking transaction"
        : canDiscardStaleSubmission
          ? "Discard stale record"
          : staleSubmissionNotFound
            ? wallet
              ? "Switch wallet"
              : "Connect submitting wallet"
            : submissionPhase === "reverted"
              ? "Reset launch"
              : submissionPhase === "pending-timeout" ||
                  submissionPhase === "index-timeout" ||
                  submissionPhase === "receipt-unavailable" ||
                  submissionPhase === "index-unavailable"
                ? "Check again"
                : submissionPhase === "indexing"
                  ? "Adding token"
                  : "Confirming transaction"}
    </button>
  ) : (
    <button
      className="primary-button classic-launch-button"
      type="submit"
      disabled={
        !pendingRestoreComplete ||
        launching ||
        walletRequestPending ||
        (model === "classic-v3" &&
          !classicV4UiEnabled &&
          !classicV3LaunchAvailable) ||
        (model === "classic-v3" &&
          classicV4UiPreviewEnabled &&
          !classicV4UiReleaseEnabled) ||
        (model === "stock-paired" && !stockPairedLaunchAllowed)
      }
    >
      {model === "stock-paired" && !stockPairedLaunchAllowed
        ? "Stock-Paired is coming soon"
        : model === "classic-v3" &&
            classicV4UiPreviewEnabled &&
            !classicV4UiReleaseEnabled
          ? "Classic V4 preview"
          : model === "classic-v3" &&
              !classicV4UiEnabled &&
              !classicV3LaunchAvailable
            ? "Classic is not deployed"
            : !pendingRestoreComplete
              ? "Checking launch status"
              : walletRequestPending && !launching
                ? "Confirm in other tab"
                : launchPhase === "preparing"
                  ? "Preparing launch"
                  : launchPhase === "confirming"
                    ? "Confirm in wallet"
                    : wallet
                      ? "Create Classic Token"
                      : "Connect wallet"}
    </button>
  );

  return (
    <div
      className={`launch-page page-width ${launchExperience.formPage} ${
        usesExtendedLayout ? extendedLayout.page : ""
      }`}
      data-launch-model={model}
    >
      <header className="launch-page-heading">
        <button
          className="launch-model-back"
          type="button"
          disabled={draftLocked && !indexedLaunch && !confirmedButUnindexed}
          onClick={returnToModels}
        >
          <ArrowLeft aria-hidden="true" size={15} />
          Back
        </button>
        <div className={`launch-page-title ${launchExperience.formPageTitle}`}>
          <h1>Create Classic Token</h1>
        </div>
      </header>

      <form
        className={`classic-launch-sheet liquid-glass-surface ${
          usesExtendedLayout ? extendedLayout.sheet : ""
        }`}
        aria-busy={!pendingRestoreComplete || launching || submissionBusy}
        aria-describedby={formError ? "launch-form-error" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void launchToken();
        }}
      >
        {controlsLockMessage ? (
          <p
            className={launchExperience.formLockNotice}
            id="launch-controls-lock-status"
            role="status"
          >
            {controlsLockMessage}
          </p>
        ) : null}
        <fieldset
          className={`classic-launch-content ${
            usesExtendedLayout ? extendedLayout.content : ""
          } ${launchExperience.formFieldset}`}
          disabled={draftLocked}
          aria-describedby={
            controlsLockMessage ? "launch-controls-lock-status" : undefined
          }
        >
          <legend className="sr-only">Token details</legend>
          <TokenStep
            draft={draft}
            setDraft={setEditableDraft}
            onEdit={markDraftEdited}
            onImageStateChange={setTokenImageState}
          />
          {model === "deep" ? <DeepPresetStep /> : null}
          {model === "deep" ? (
            <DeepFeeStep
              draft={draft}
              setDraft={setEditableDraft}
              onEdit={markDraftEdited}
            />
          ) : model === "classic-v3" ? (
            <EnhancedClassicFeeStep
              draft={draft}
              setDraft={setEditableDraft}
              onEdit={markDraftEdited}
              settingMaxBuy={settingMaxBuy}
              onMaximumDevBuy={() => void setMaximumDevBuy()}
              enableV4={classicV4UiEnabled}
            />
          ) : model === "stock-paired" ? (
            <StockPairedStep
              draft={draft}
              account={wallet?.account}
              setDraft={setEditableDraft}
              onEdit={markDraftEdited}
              settingMaxBuy={settingMaxBuy}
              onMaximumBuy={() => void setMaximumDevBuy()}
              launchAction={transactionHash ? null : launchAction}
              launchStatus={transactionHash ? null : launchStatus}
            />
          ) : (
            <FeeStep
              draft={draft}
              setDraft={setEditableDraft}
              onEdit={markDraftEdited}
              settingMaxBuy={settingMaxBuy}
              onMaximumDevBuy={() => void setMaximumDevBuy()}
            />
          )}
        </fieldset>

        {model !== "stock-paired" || transactionHash ? (
          <footer
            className={`classic-launch-footer ${
              usesExtendedLayout ? extendedLayout.footer : ""
            }`}
          >
            <div className="classic-launch-status">{launchStatus}</div>
            {launchAction}
          </footer>
        ) : null}
      </form>

      {successLaunch && successOpen ? (
        <LaunchSuccessDialog
          launch={successLaunch}
          draft={
            model === "classic-v3" ||
            model === "deep" ||
            model === "stock-paired"
              ? launchDraftForSuccessDisplay(
                  draft,
                  launchSubmissionUsesCurrentDraft(
                    transactionHash,
                    currentDraftSubmissionHash,
                    draftVersion.current,
                    submittedDraftVersion,
                  ),
                )
              : undefined
          }
          account={submittedAccount}
          classicV4={classicV4UiEnabled}
          onClose={closeSuccessDialog}
        />
      ) : null}

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {notice ? (
          <p className="toast">
            <Check aria-hidden="true" size={16} />
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LaunchSuccessDialog({
  launch,
  draft,
  account,
  classicV4 = false,
  onClose,
}: {
  launch: LaunchSuccessSummary;
  draft?: LaunchDraft;
  account?: string;
  classicV4?: boolean;
  onClose: () => void;
}) {
  const viewLinkRef = useRef<HTMLAnchorElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const copyResetTimer = useRef<number | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  async function copyTokenAddress() {
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
    }
    try {
      await navigator.clipboard.writeText(launch.address);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    copyResetTimer.current = window.setTimeout(
      () => setCopyState("idle"),
      2_000,
    );
  }

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    viewLinkRef.current?.focus();

    const inertedElements: HTMLElement[] = [];
    let activeLayer = dialogRef.current?.parentElement;
    while (activeLayer?.parentElement && activeLayer !== document.body) {
      for (const sibling of activeLayer.parentElement.children) {
        if (
          sibling !== activeLayer &&
          sibling instanceof HTMLElement &&
          !sibling.inert
        ) {
          sibling.inert = true;
          inertedElements.push(sibling);
        }
      }
      activeLayer = activeLayer.parentElement;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      document.body.style.overflow = previousOverflow;
      for (const element of inertedElements) {
        element.inert = false;
      }
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [onClose]);
  let classicConfiguration:
    | ReturnType<typeof validateClassicV3LaunchDraft>
    | ReturnType<typeof validateClassicV4LaunchDraft>
    | undefined;
  const deepLaunch = draft?.launchModel === "deep";
  try {
    if (draft?.launchModel === "classic-v3" && account) {
      classicConfiguration = classicV4
        ? validateClassicV4LaunchDraft(draft, account)
        : validateClassicV3LaunchDraft(draft, account);
    }
  } catch {
    classicConfiguration = undefined;
  }

  return (
    <div
      className="launch-success-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="launch-success-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-success-title"
      >
        <button
          className="icon-button launch-success-close"
          type="button"
          aria-label="Close launch confirmation"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </button>
        <CircleCheck
          className="launch-success-icon"
          aria-hidden="true"
          size={36}
          strokeWidth={1.6}
        />
        <p className="eyebrow">Launch successful</p>
        <h2 id="launch-success-title">{launch.name} was created</h2>
        <p className="launch-success-symbol">${launch.symbol}</p>
        <div className="launch-success-address">
          <span>Contract address</span>
          <button
            type="button"
            onClick={() => void copyTokenAddress()}
            aria-label={
              copyState === "copied"
                ? `${launch.name} contract address copied`
                : `Copy ${launch.name} contract address`
            }
            title={
              copyState === "copied" ? "Copied" : "Copy contract address"
            }
          >
            <code>{shortenAddress(launch.address)}</code>
            <span aria-hidden="true">
              {copyState === "copied" ? "Copied" : "Copy"}
            </span>
            {copyState === "copied" ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )}
          </button>
          <span className="launch-success-copy-status" aria-live="polite">
            {copyState === "error"
              ? "Contract address could not be copied"
              : copyState === "copied"
                ? "Contract address copied"
                : ""}
          </span>
        </div>
        {launch.estimatedInitialBuyTokenAmount !== undefined ? (
          <dl className="launch-success-tokens">
            <div>
              <dt>
                {classicV4
                  ? "Estimated tokens from Activation Buy"
                  : "Estimated tokens from initial buy"}
              </dt>
              <dd>
                ≈{" "}
                {compactInitialBuyTokenFormatter.format(
                  launch.estimatedInitialBuyTokenAmount,
                )}{" "}
                ${launch.symbol}
              </dd>
            </div>
          </dl>
        ) : null}
        {deepLaunch ? (
          <dl className="launch-success-v3">
            <div>
              <dt>Deep fee</dt>
              <dd>1.00%</dd>
            </div>
            <div>
              <dt>Pool growth</dt>
              <dd>0.90%</dd>
            </div>
            <div>
              <dt>Programmable</dt>
              <dd>0.10%</dd>
            </div>
          </dl>
        ) : classicConfiguration ? (
          <dl className="launch-success-v3">
            <div>
              <dt>Buy fee</dt>
              <dd>
                {formatClassicV3Percent(
                  classicConfiguration.fees.buySwapFeeBps,
                )}{" "}
                total ·{" "}
                {formatClassicV3Percent(
                  classicConfiguration.fees.buyCreatorFeeBps,
                )}{" "}
                creator · 0.10% Programmable
              </dd>
            </div>
            <div>
              <dt>Sell fee</dt>
              <dd>
                {formatClassicV3Percent(
                  classicConfiguration.fees.sellSwapFeeBps,
                )}{" "}
                total ·{" "}
                {formatClassicV3Percent(
                  classicConfiguration.fees.sellCreatorFeeBps,
                )}{" "}
                creator · 0.10% Programmable
              </dd>
            </div>
            <div>
              <dt>Reward owners</dt>
              <dd>{classicConfiguration.rewards.beneficiaries.length}</dd>
            </div>
            <div>
              <dt>Token access</dt>
              <dd>
                {classicConfiguration.initialBuyCustody.mode === "unlocked"
                  ? "Unlocked"
                  : classicConfiguration.initialBuyCustody.mode ===
                      "fixed-lock"
                    ? `${classicConfiguration.initialBuyCustody.durationDays}d lock`
                    : `${classicConfiguration.initialBuyCustody.durationDays}d vest`}
              </dd>
            </div>
          </dl>
        ) : null}
        <Link ref={viewLinkRef} className="primary-button" href={launch.href}>
          View token
        </Link>
        {launch.chainId === 1 ? <LaunchShareLink href={`/token/${launch.address}?chain=1`} /> : null}
      </section>
    </div>
  );
}

type LaunchSelectOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
}>;

function LaunchSelect<Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
  placement = "bottom",
  columns = 1,
}: {
  id: string;
  label: string;
  value: Value;
  options: readonly LaunchSelectOption<Value>[];
  onChange: (value: Value) => void;
  placement?: "top" | "bottom";
  columns?: 1 | 2;
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options[selectedIndex] ?? options[0];

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openMenu(index = selectedIndex) {
    setActiveIndex(index);
    setOpen(true);
  }

  function closeMenu({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    closeMenu();
  }

  function onOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Tab") {
      setOpen(false);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(index);
    }
  }

  return (
    <div
      className={`launch-select${open ? " is-open" : ""}`}
      data-placement={placement}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        className="launch-select-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() =>
          open
            ? closeMenu({ restoreFocus: false })
            : openMenu(selectedIndex)
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(selectedIndex);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu();
          }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown aria-hidden="true" size={17} strokeWidth={1.9} />
      </button>

      {open ? (
        <div
          id={`${id}-listbox`}
          className="launch-select-menu"
          data-columns={columns}
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => {
            const selectedOption = option.value === value;
            return (
              <button
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                className="launch-select-option"
                data-active={activeIndex === index ? "true" : "false"}
                type="button"
                role="option"
                aria-selected={selectedOption}
                tabIndex={activeIndex === index ? 0 : -1}
                key={option.value}
                onClick={() => selectOption(index)}
                onMouseEnter={() => setActiveIndex(index)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
              >
                <span>{option.label}</span>
                {selectedOption ? (
                  <Check aria-hidden="true" size={15} strokeWidth={2.2} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function TokenStep({
  draft,
  setDraft,
  onEdit,
  onImageStateChange,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  onImageStateChange: (state: TokenImageState) => void;
}) {
  const { getAccessToken, openWallet, wallet } = useWallet();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewObjectUrlRef = useRef("");
  const imageRequest = useRef(0);
  const imageUploadAbort = useRef<AbortController | null>(null);
  const [imagePreview, setImagePreview] = useState(draft.tokenImage);
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [imageState, setImageState] =
    useState<TokenImageState>(emptyTokenImageState);

  const updateTokenDraft = useCallback(
    (patch: Partial<LaunchDraft>) => {
      onEdit();
      updateDraft(setDraft, patch);
    },
    [onEdit, setDraft],
  );

  const updateImageState = useCallback(
    (state: TokenImageState) => {
      setImageState(state);
      onImageStateChange(state);
    },
    [onImageStateChange],
  );

  useEffect(
    () => () => {
      imageRequest.current += 1;
      imageUploadAbort.current?.abort();
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    },
    [],
  );

  const uploadTokenImage = useCallback(
    async (image: Blob, selection = imageRequest.current) => {
      imageUploadAbort.current?.abort();
      const controller = new AbortController();
      imageUploadAbort.current = controller;
      const isCurrent = () => selection === imageRequest.current && imageUploadAbort.current === controller;
      updateImageState({
        status: "uploading",
        message: "Uploading image",
      });

      try {
        const uploaded = await withTokenImageUploadDeadline(async signal => {
          const accessToken = await getAccessToken();
          signal.throwIfAborted();
          if (!isCurrent()) return null;
          if (!accessToken) {
            throw new Error("Connect your wallet to upload the image");
          }

          const form = new FormData();
          form.append(
            "file",
            new File([image], "token-image.webp", {
              type: "image/webp",
            }),
          );
          const response = await fetch("/api/token-image", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            body: form,
            signal,
          });
          const body = await readTokenImageUploadResponse(response);
          signal.throwIfAborted();
          return { response, body };
        }, controller.signal);
        if (!uploaded) return;
        const { response, body } = uploaded;
        if (!isCurrent()) return;
        if (body === null) {
          throw new Error("Image uploads are temporarily unavailable. Try again.");
        }
        if (
          !response.ok
          || typeof body.url !== "string"
          || !isProgrammableTokenImageUrl(body.url)
        ) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : "The image could not be uploaded",
          );
        }

        updateTokenDraft({ tokenImage: body.url });
        setPendingImage(null);
        updateImageState({
          status: "ready",
          message: "Image ready",
        });
      } catch (caught) {
        if (!isCurrent()) return;
        updateImageState({
          status: "error",
          message:
            caught instanceof Error
              ? caught.message
              : "The image could not be uploaded",
        });
      }
    },
    [getAccessToken, updateImageState, updateTokenDraft],
  );

  async function selectTokenImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const selection = ++imageRequest.current;
    imageUploadAbort.current?.abort();

    updateImageState({
      status: "preparing",
      message: "Preparing image",
    });

    try {
      const prepared = await prepareTokenImage(file);
      if (selection !== imageRequest.current) return;
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
      const previewUrl = URL.createObjectURL(prepared);
      previewObjectUrlRef.current = previewUrl;
      setImagePreview(previewUrl);
      setPendingImage(prepared);

      if (!wallet) {
        updateImageState({
          status: "waiting",
          message: "Connect your wallet to finish the upload",
        });
        openWallet();
        return;
      }

      await uploadTokenImage(prepared, selection);
    } catch (caught) {
      if (selection !== imageRequest.current) return;
      updateImageState({
        status: "error",
        message:
          caught instanceof Error
            ? caught.message
            : "The image could not be prepared",
      });
    }
  }

  function removeTokenImage() {
    imageRequest.current += 1;
    imageUploadAbort.current?.abort();
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = "";
    }
    setImagePreview("");
    setPendingImage(null);
    updateTokenDraft({ tokenImage: "" });
    updateImageState(emptyTokenImageState);
  }

  function normalizeWebsite() {
    try {
      updateTokenDraft({
        tokenWebsite: normalizeOptionalHttpsUrl(
          draft.tokenWebsite,
          "the website",
          MAX_METADATA_URL_BYTES,
        ),
      });
    } catch {
      return;
    }
  }

  function normalizeSocial(kind: "x" | "telegram") {
    const key = kind === "x" ? "tokenX" : "tokenTelegram";
    try {
      updateTokenDraft({
        [key]: normalizeOptionalSocialUrl(
          draft[key],
          kind === "x" ? "the X link" : "the Telegram link",
          MAX_SOCIAL_URL_BYTES,
          kind,
        ),
      });
    } catch {
      return;
    }
  }

  const descriptionRemaining =
    MAX_TOKEN_DESCRIPTION_BYTES - utf8ByteLength(draft.tokenDescription);

  return (
    <section className="classic-token-section">
      <div className="classic-section-heading">
        <h2>Token</h2>
      </div>

      <div className="classic-token-grid">
        <div className="token-image-field">
          <span>Token image</span>
          <input
            ref={imageInputRef}
            hidden
            type="file"
            accept={TOKEN_IMAGE_ACCEPT}
            onChange={selectTokenImage}
          />
          <button
            className={`token-image-upload${imagePreview ? " has-image" : ""}`}
            type="button"
            aria-label={
              imagePreview ? "Change token image" : "Choose token image"
            }
            onClick={() => imageInputRef.current?.click()}
          >
            {imagePreview ? (
              <span
                className="token-image-preview"
                role="img"
                aria-label="Token image preview"
                style={{ backgroundImage: `url("${imagePreview}")` }}
              />
            ) : (
              <span className="token-image-placeholder">
                <ImagePlus aria-hidden="true" size={21} />
                <strong>Choose image</strong>
                <small>Cropped to 1:1 · 1000 × 1000</small>
              </span>
            )}
          </button>
          <div className="token-image-meta">
            <span
              className={
                imageState.status === "error" ? "form-error" : undefined
              }
              role={imageState.status === "error" ? "alert" : undefined}
            >
              {imageState.message || "JPG, PNG, WebP or HEIC"}
            </span>
            <div>
              {(imageState.status === "error" ||
                imageState.status === "waiting") &&
              pendingImage &&
              wallet ? (
                <button
                  type="button"
                  onClick={() => void uploadTokenImage(pendingImage)}
                >
                  <RotateCcw aria-hidden="true" size={13} />
                  Try again
                </button>
              ) : null}
              {imagePreview || draft.tokenImage ? (
                <button type="button" onClick={removeTokenImage}>
                  <Trash2 aria-hidden="true" size={13} />
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="classic-token-main">
          <div className="two-column-fields">
            <label className="field">
              <span>Token name</span>
              <input
                value={draft.tokenName}
                required
                maxLength={MAX_TOKEN_NAME_CHARACTERS}
                placeholder="Token name"
                autoComplete="off"
                onChange={(event) => {
                  const value = event.target.value.replace(/[\r\n]/g, "");
                  if (utf8ByteLength(value) <= MAX_TOKEN_NAME_BYTES) {
                    updateTokenDraft({ tokenName: value });
                  }
                }}
              />
              <small>
                {characterLength(draft.tokenName)}/{MAX_TOKEN_NAME_CHARACTERS}
              </small>
            </label>
            <label className="field">
              <span>Ticker</span>
              <input
                value={draft.tokenSymbol}
                required
                maxLength={MAX_TOKEN_SYMBOL_CHARACTERS}
                placeholder="$TOKEN"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  updateTokenDraft({
                    tokenSymbol: event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  })
                }
              />
              <small>
                {characterLength(draft.tokenSymbol)}/
                {MAX_TOKEN_SYMBOL_CHARACTERS}
              </small>
            </label>
          </div>

          <label className="field classic-description-field">
            <span>Description</span>
            <textarea
              value={draft.tokenDescription}
              maxLength={MAX_TOKEN_DESCRIPTION_BYTES}
              rows={2}
              placeholder="What is this token for?"
              onChange={(event) => {
                if (
                  utf8ByteLength(event.target.value) <=
                  MAX_TOKEN_DESCRIPTION_BYTES
                ) {
                  updateTokenDraft({
                    tokenDescription: event.target.value,
                  });
                }
              }}
            />
            <small>{descriptionRemaining} left</small>
          </label>

          <details className="classic-link-disclosure">
            <summary>
              <span>Project links</span>
              <small>Optional</small>
              <ChevronDown
                aria-hidden="true"
                className="classic-link-disclosure-icon"
                size={17}
                strokeWidth={1.9}
              />
            </summary>
            <div className="classic-link-fields">
              <label className="field">
                <span>Website</span>
                <input
                  type="text"
                  inputMode="url"
                  value={draft.tokenWebsite}
                  maxLength={MAX_METADATA_URL_BYTES}
                  placeholder="your-site.com"
                  spellCheck={false}
                  autoComplete="url"
                  onBlur={normalizeWebsite}
                  onChange={(event) =>
                    updateTokenDraft({ tokenWebsite: event.target.value })
                  }
                />
              </label>

              <label className="field">
                <span>X</span>
                <input
                  type="text"
                  inputMode="url"
                  value={draft.tokenX}
                  maxLength={MAX_SOCIAL_URL_BYTES}
                  placeholder="@account or post URL"
                  spellCheck={false}
                  autoComplete="off"
                  onBlur={() => normalizeSocial("x")}
                  onChange={(event) =>
                    updateTokenDraft({ tokenX: event.target.value })
                  }
                />
              </label>

              <label className="field">
                <span>Telegram</span>
                <input
                  type="text"
                  inputMode="url"
                  value={draft.tokenTelegram}
                  maxLength={MAX_SOCIAL_URL_BYTES}
                  placeholder="@group or t.me/group"
                  spellCheck={false}
                  autoComplete="off"
                  onBlur={() => normalizeSocial("telegram")}
                  onChange={(event) =>
                    updateTokenDraft({ tokenTelegram: event.target.value })
                  }
                />
              </label>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

export function DeepPresetStep() {
  const disclosure = deepV3PresetDisclosure();
  return (
    <section className="deep-preset" aria-labelledby="deep-preset-title">
      <div className="classic-section-heading">
        <h2 id="deep-preset-title">How Deep works</h2>
        <p>Original v4 pool</p>
      </div>

      <div className="deep-preset-overview">
        <p className="deep-preset-summary">{disclosure.summary}</p>
        <dl className="deep-preset-stats">
          <div>
            <dt>Total swap fee</dt>
            <dd>{disclosure.swapFee}</dd>
          </div>
          <div>
            <dt>Added to liquidity</dt>
            <dd>{disclosure.growthFee}</dd>
          </div>
          <div>
            <dt>Programmable</dt>
            <dd>{disclosure.programmableFee}</dd>
          </div>
        </dl>
      </div>

      <details className="deep-preset-details">
        <summary>Execution details</summary>
        <div className="deep-preset-notes">
          <p>{disclosure.automation}</p>
          <p>{disclosure.rewards}</p>
          <p>{disclosure.protocolFees}</p>
        </div>
      </details>

      <p className="deep-preset-review" role="note">
        {disclosure.review}
      </p>
    </section>
  );
}

export function DeepFeeStep({
  draft,
  setDraft,
  onEdit,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
}) {
  return (
    <section
      className="classic-fee-section deep-fee-section"
      aria-labelledby="deep-fee-title"
    >
      <div className="classic-section-heading classic-fee-heading">
        <div>
          <h2 id="deep-fee-title">Initial buy</h2>
          <p>Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}</p>
        </div>
      </div>

      <div className="classic-fee-layout deep-fee-layout">
        <label className="meme-dev-buy" htmlFor="deep-initial-buy">
          <span>
            <strong>Amount</strong>
            <small>ETH added when the token launches</small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="deep-initial-buy"
              inputMode="decimal"
              value={draft.initialBuyEth}
              maxLength={40}
              placeholder={MEME_MIN_INITIAL_BUY_ETH}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                onEdit();
                updateDraft(setDraft, {
                  initialBuyEth: event.target.value,
                });
              }}
            />
            <span>ETH</span>
          </span>
        </label>
      </div>
    </section>
  );
}

const classicFeeQuickValues = ["0.1", "1", "3", "10"] as const;
const classicFeeOptions: readonly LaunchSelectOption<string>[] = Array.from(
  { length: 10 },
  (_, index) => ({
    value: String(index + 1),
    label: `${index + 1}.00%`,
  }),
);

function ClassicFeeControl({
  direction,
  value,
  onChange,
}: {
  direction: "buy" | "sell";
  value: string;
  onChange: (value: string) => void;
}) {
  const label = direction === "buy" ? "Buy fee" : "Sell fee";
  const inputId = `classic-${direction}-fee`;
  const hintId = `${inputId}-hint`;
  const breakdownId = `${inputId}-breakdown`;
  const totalFeeBps = parseClassicFeePercentToBps(value);
  const creatorFeeBps =
    totalFeeBps === null ? null : totalFeeBps - PLATFORM_FEE_BPS;

  return (
    <div className="classic-v3-fee-control">
      <label htmlFor={inputId}>{label}</label>
      <span className="classic-v3-fee-input">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value}
          maxLength={5}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${hintId} ${breakdownId}`}
          aria-invalid={value.trim().length > 0 && totalFeeBps === null}
          onChange={(event) => onChange(event.target.value)}
        />
        <span aria-hidden="true">%</span>
      </span>
      <p className="classic-v3-fee-hint" id={hintId}>
        0.1% to 10% in 0.1% steps
      </p>
      <div
        className="classic-v3-fee-quick"
        role="group"
        aria-label={`${label} quick choices`}
      >
        {classicFeeQuickValues.map((quickValue) => (
          <button
            type="button"
            aria-pressed={
              totalFeeBps === parseClassicFeePercentToBps(quickValue)
            }
            onClick={() => onChange(quickValue)}
            key={quickValue}
          >
            {quickValue}%
          </button>
        ))}
      </div>
      <dl className="classic-v3-fee-breakdown" id={breakdownId}>
        <div>
          <dt>Total</dt>
          <dd>
            {totalFeeBps === null ? "—" : formatClassicV3Percent(totalFeeBps)}
          </dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>
            {creatorFeeBps === null
              ? "—"
              : formatClassicV3Percent(creatorFeeBps)}
          </dd>
        </div>
        <div>
          <dt>Programmable</dt>
          <dd>0.10%</dd>
        </div>
      </dl>
    </div>
  );
}

const initialBuyAccessOptions: readonly LaunchSelectOption<
  LaunchDraft["initialBuyCustodyMode"]
>[] = [
  { value: "unlocked", label: "Available immediately" },
  { value: "fixed-lock", label: "Locked" },
  { value: "linear", label: "Vested" },
  { value: "cliff-linear", label: "Cliff + vested" },
];

const compactInitialBuyTokenFormatter = new Intl.NumberFormat("en-US", {
  compactDisplay: "short",
  maximumFractionDigits: 2,
  notation: "compact",
});

const initialBuySupplyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const activationBuyEthFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

export function EnhancedClassicFeeStep({
  draft,
  setDraft,
  onEdit,
  settingMaxBuy,
  onMaximumDevBuy,
  enableV4 = true,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  settingMaxBuy: boolean;
  onMaximumDevBuy: () => void;
  enableV4?: boolean;
}) {
  const updateClassicV3Draft = (patch: Partial<LaunchDraft>) => {
    onEdit();
    updateDraft(setDraft, patch);
  };

  function updateSplit(
    index: number,
    patch: Partial<LaunchDraft["rewardSplits"][number]>,
  ) {
    updateClassicV3Draft({
      rewardSplits: draft.rewardSplits.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    });
  }

  const splitTotal = draft.rewardSplits.reduce((total, row) => {
    const share = Number(row.sharePercent);
    return Number.isFinite(share) ? total + share : total;
  }, 0);
  const splitIsComplete = Math.abs(splitTotal - 100) < 0.001;
  const initialBuyCurveQuote = enableV4
    ? getClassicInitialBuyCurveQuote(
        draft.initialBuyEth,
        draft.buySwapFeePercent,
      )
    : getLegacyClassicInitialBuyCurveQuote(
        draft.initialBuyEth,
        draft.buySwapFeePercent,
      );
  const initialBuyPreview =
    initialBuyCurveQuote.status === "ready"
      ? initialBuyCurveQuote.preview
      : null;
  const activationBuyCapacityNote =
    !enableV4
      ? ""
      : initialBuyCurveQuote.status === "over-capacity"
        ? `Activation Buy exceeds the Classic liquidity range. Maximum ${formatEther(initialBuyCurveQuote.maximumGrossActivationBuyWei)} ETH at this buy fee.`
        : initialBuyCurveQuote.status === "ready" &&
            initialBuyCurveQuote.preview.remainingCurveCapacityWei !== null
          ? `${activationBuyEthFormatter.format(Number(formatEther(initialBuyCurveQuote.preview.poolEthWei)))} ETH reaches the curve after fees. ${activationBuyEthFormatter.format(Number(formatEther(initialBuyCurveQuote.preview.remainingCurveCapacityWei)))} ETH net capacity remains before the 18.91× end price.${
              initialBuyCurveQuote.preview.remainingCurveCapacityWei === 0n
                ? " This fully consumes the Classic range; another buy requires a sell or outside liquidity first."
                : ""
            }`
          : "Enter a valid Activation Buy to check the remaining Classic capacity.";
  const initialBuyTokenLabel = draft.tokenSymbol.trim()
    ? `$${draft.tokenSymbol.trim().toUpperCase()}`
    : "tokens";
  const rewardNote =
    draft.rewardDestinationMode === "launcher"
      ? "Paid to the launch wallet"
      : draft.rewardDestinationMode === "external"
        ? "Paid to the selected wallet"
        : "Each recipient claims their share";

  return (
    <section className="classic-v3-settings" aria-labelledby="classic-v3-fees">
      <div className="classic-section-heading">
        <h2 id="classic-v3-fees">Fees and rewards</h2>
      </div>

      <div className="classic-v3-core">
        <fieldset className="classic-v3-fees">
          <legend>Swap fees</legend>
          <div className="classic-v3-fee-grid">
            {(["buy", "sell"] as const).map((direction) => {
              const key =
                direction === "buy"
                  ? "buySwapFeePercent"
                  : "sellSwapFeePercent";
              if (enableV4) {
                return (
                  <ClassicFeeControl
                    direction={direction}
                    value={draft[key]}
                    onChange={(value) => updateClassicV3Draft({ [key]: value })}
                    key={direction}
                  />
                );
              }

              const totalFeeBps = Number(draft[key]) * 100;
              const creatorFeeBps = Math.max(0, totalFeeBps - PLATFORM_FEE_BPS);
              return (
                <div className="classic-v3-fee-control" key={direction}>
                  <span>{direction === "buy" ? "Buy fee" : "Sell fee"}</span>
                  <LaunchSelect
                    id={`classic-${direction}-fee`}
                    label={`${direction === "buy" ? "Buy" : "Sell"} fee`}
                    value={draft[key]}
                    options={classicFeeOptions}
                    columns={2}
                    onChange={(value) =>
                      updateClassicV3Draft({ [key]: value })
                    }
                  />
                  <dl className="classic-v3-fee-breakdown">
                    <div>
                      <dt>Creator</dt>
                      <dd>
                        {Number.isFinite(creatorFeeBps)
                          ? formatClassicV3Percent(creatorFeeBps)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Programmable</dt>
                      <dd>0.10%</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="classic-v3-reward-mode">
          <legend>Creator rewards</legend>
          <div>
            {(
              [
                ["launcher", "Launch wallet"],
                ["external", "Another wallet"],
                ["split", "Split rewards"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                className={
                  draft.rewardDestinationMode === value ? "is-selected" : ""
                }
                aria-pressed={draft.rewardDestinationMode === value}
                onClick={() =>
                  updateClassicV3Draft({ rewardDestinationMode: value })
                }
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="classic-v3-reward-note">{rewardNote}</p>
        </fieldset>
      </div>

      {draft.rewardDestinationMode === "external" ? (
        <label className="field classic-v3-address-field">
          <span>Reward wallet</span>
          <input
            value={draft.rewardExternalAddress}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) =>
              updateClassicV3Draft({
                rewardExternalAddress: event.target.value,
              })
            }
          />
          <small>Only this wallet can claim or update its payout address</small>
        </label>
      ) : null}

      {draft.rewardDestinationMode === "split" ? (
        <div className="classic-v3-split">
          {draft.rewardSplits.map((row, index) => (
            <div className="classic-v3-split-row" key={index}>
              <label>
                <span>Recipient {index + 1}</span>
                <input
                  value={row.beneficiary}
                  placeholder="0x…"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) =>
                    updateSplit(index, {
                      beneficiary: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                <span>Share</span>
                <span className="classic-v3-share-input">
                  <input
                    inputMode="decimal"
                    value={row.sharePercent}
                    maxLength={6}
                    onChange={(event) =>
                      updateSplit(index, {
                        sharePercent: event.target.value,
                      })
                    }
                  />
                  <span>%</span>
                </span>
              </label>
              {draft.rewardSplits.length > 2 ? (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove recipient ${index + 1}`}
                  onClick={() =>
                    updateClassicV3Draft({
                      rewardSplits: draft.rewardSplits.filter(
                        (_, rowIndex) => rowIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              ) : null}
            </div>
          ))}
          {draft.rewardSplits.length <
          CLASSIC_V3_MAX_REWARD_BENEFICIARIES ? (
            <button
              className="secondary-button classic-v3-add-recipient"
              type="button"
              onClick={() =>
                updateClassicV3Draft({
                  rewardSplits: [
                    ...draft.rewardSplits,
                    { beneficiary: "", sharePercent: "" },
                  ],
                })
              }
            >
              Add recipient
            </button>
          ) : null}
          <p
            className={`classic-v3-split-total${
              splitIsComplete ? " is-complete" : ""
            }`}
            aria-live="polite"
          >
            Total {splitTotal.toFixed(2).replace(/\.00$/, "")}%
          </p>
        </div>
      ) : null}

      <div className="classic-v3-subsection-heading">
        <h3>{enableV4 ? "Activation Buy" : "Initial buy"}</h3>
      </div>

      <div className="classic-v3-initial-buy">
        <div className="meme-dev-buy">
          <label
            className="classic-v3-amount-label"
            htmlFor="classic-v3-dev-buy"
          >
            <strong>{enableV4 ? "Activation Buy amount" : "Amount"}</strong>
            <small>
              Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}
              {enableV4 ? " · paid in addition to network gas" : ""}
            </small>
          </label>
          <span className="meme-dev-buy-input">
            <input
              id="classic-v3-dev-buy"
              inputMode="decimal"
              value={draft.initialBuyEth}
              maxLength={40}
              placeholder={MEME_MIN_INITIAL_BUY_ETH}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateClassicV3Draft({
                  initialBuyEth: event.target.value,
                })
              }
            />
            <button
              type="button"
              disabled={
                settingMaxBuy || (!enableV4 && !classicV3LaunchAvailable)
              }
              onClick={onMaximumDevBuy}
            >
              {settingMaxBuy ? "Checking" : "Max"}
            </button>
            <span>ETH</span>
          </span>
          <div
            className="classic-v3-buy-preview"
            role="status"
            aria-live="polite"
          >
            <span>
              <small>Estimated tokens</small>
              <strong>
                {initialBuyPreview
                  ? `≈ ${compactInitialBuyTokenFormatter.format(initialBuyPreview.tokenAmount)} ${initialBuyTokenLabel}`
                  : "—"}
              </strong>
            </span>
            <span>
              <small>Share of supply</small>
              <strong>
                {initialBuyPreview
                  ? `≈ ${initialBuySupplyFormatter.format(initialBuyPreview.supplyPercent)}%`
                  : "—"}
              </strong>
            </span>
          </div>
          {activationBuyCapacityNote ? (
            <p
              className="classic-v3-liquidity-note"
              role={
                initialBuyCurveQuote.status === "over-capacity"
                  ? "alert"
                  : "status"
              }
            >
              {activationBuyCapacityNote}
            </p>
          ) : null}
        </div>

        {!enableV4 ? (
          <fieldset
            className="classic-v3-custody"
            data-mode={draft.initialBuyCustodyMode}
          >
            <legend className="sr-only">Dev supply</legend>
            <label>
              <span>Dev supply</span>
              <LaunchSelect
                id="classic-initial-buy-access"
                label="Dev supply access"
                value={draft.initialBuyCustodyMode}
                options={initialBuyAccessOptions}
                placement="top"
                onChange={(value) =>
                  updateClassicV3Draft({
                    initialBuyCustodyMode: value,
                  })
                }
              />
            </label>
            {draft.initialBuyCustodyMode !== "unlocked" ? (
              <label>
                <span>
                  {draft.initialBuyCustodyMode === "fixed-lock"
                    ? "Lock period"
                    : "Vesting period"}
                </span>
                <span className="classic-v3-days-input">
                  <input
                    inputMode="numeric"
                    value={draft.initialBuyDurationDays}
                    maxLength={4}
                    onChange={(event) =>
                      updateClassicV3Draft({
                        initialBuyDurationDays: event.target.value,
                      })
                    }
                  />
                  <span>days</span>
                </span>
              </label>
            ) : null}
            {draft.initialBuyCustodyMode === "cliff-linear" ? (
              <label>
                <span>Cliff</span>
                <span className="classic-v3-days-input">
                  <input
                    inputMode="numeric"
                    value={draft.initialBuyCliffDays}
                    maxLength={4}
                    onChange={(event) =>
                      updateClassicV3Draft({
                        initialBuyCliffDays: event.target.value,
                      })
                    }
                  />
                  <span>days</span>
                </span>
              </label>
            ) : null}
          </fieldset>
        ) : null}
      </div>
    </section>
  );
}

function StockPairedStep({
  draft,
  account,
  setDraft,
  onEdit,
  settingMaxBuy,
  onMaximumBuy,
  launchAction,
  launchStatus,
}: {
  draft: LaunchDraft;
  account?: string;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  settingMaxBuy: boolean;
  onMaximumBuy: () => void;
  launchAction: ReactNode;
  launchStatus: ReactNode;
}) {
  const [assetListOpen, setAssetListOpen] = useState(false);
  const [activeAssetIndex, setActiveAssetIndex] = useState(0);
  const assetSelectRef = useRef<HTMLDivElement>(null);
  const assetTriggerRef = useRef<HTMLButtonElement>(null);
  const assetOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected =
    getStockPairedUiQuoteAsset(draft.stockQuoteAsset) ??
    stockPairedUiQuoteAssets[0];
  const selectedIndex = Math.max(
    0,
    stockPairedUiQuoteAssets.findIndex(
      (asset) => asset.address.toLowerCase() === selected.address.toLowerCase(),
    ),
  );
  const selectedDisplayName = stockPairedUiDisplayName(selected);
  const selectedLogoUrl = stockPairedUiLogoUrl(selected);

  useEffect(() => {
    if (!assetListOpen) return;

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !assetSelectRef.current?.contains(event.target)
      ) {
        setAssetListOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [assetListOpen]);

  useEffect(() => {
    if (!assetListOpen) return;
    assetOptionRefs.current[activeAssetIndex]?.focus();
  }, [activeAssetIndex, assetListOpen]);

  function updateStockDraft(patch: Partial<LaunchDraft>) {
    onEdit();
    updateDraft(setDraft, {
      ...patch,
      launchModel: "stock-paired",
      rewardDestinationMode: "launcher",
      rewardExternalAddress: "",
      rewardSplits: [],
    });
  }

  function openAssetList(index = selectedIndex) {
    setActiveAssetIndex(index);
    setAssetListOpen(true);
  }

  function closeAssetList({ restoreFocus = true } = {}) {
    setAssetListOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => assetTriggerRef.current?.focus());
    }
  }

  function selectAsset(index: number) {
    const asset = stockPairedUiQuoteAssets[index];
    if (!asset) return;
    updateStockDraft({ stockQuoteAsset: asset.address });
    closeAssetList();
  }

  function onAssetOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveAssetIndex(
        (index + 1) % stockPairedUiQuoteAssets.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveAssetIndex(
        (index - 1 + stockPairedUiQuoteAssets.length) %
          stockPairedUiQuoteAssets.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveAssetIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveAssetIndex(stockPairedUiQuoteAssets.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAssetList();
    } else if (event.key === "Tab") {
      setAssetListOpen(false);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectAsset(index);
    }
  }

  return (
    <section
      className="classic-fee-section stock-paired-section"
      aria-labelledby="stock-paired-title"
    >
      <div className="classic-section-heading classic-fee-heading">
        <div>
          <h2 id="stock-paired-title">Quote asset</h2>
          <p>
            Choose the stock token behind the v4 pair. Programmable routes buys
            and sells from ETH.
          </p>
        </div>
      </div>

      <div className="stock-quote-select" ref={assetSelectRef}>
        <button
          ref={assetTriggerRef}
          className="stock-quote-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={assetListOpen}
          aria-controls="stock-quote-listbox"
          onClick={() =>
            assetListOpen
              ? closeAssetList({ restoreFocus: false })
              : openAssetList()
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              openAssetList(selectedIndex);
            }
          }}
        >
          {/* The source is Ondo's official asset-logo CDN. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="stock-quote-trigger-logo"
            src={selectedLogoUrl}
            alt=""
            width={48}
            height={48}
          />
          <span className="stock-quote-trigger-copy">
            <small>Quote asset</small>
            <strong>{selectedDisplayName}</strong>
          </span>
          <ChevronDown
            className="stock-quote-trigger-chevron"
            aria-hidden="true"
            size={19}
            strokeWidth={1.8}
          />
        </button>

        {assetListOpen ? (
          <div
            id="stock-quote-listbox"
            className="stock-quote-list"
            role="listbox"
            aria-label="Quote asset"
          >
            {stockPairedUiQuoteAssets.map((asset, index) => {
              const active =
                asset.address.toLowerCase() === selected.address.toLowerCase();
              const displayName = stockPairedUiDisplayName(asset);
              const logoUrl = stockPairedUiLogoUrl(asset);
              return (
                <button
                  ref={(element) => {
                    assetOptionRefs.current[index] = element;
                  }}
                  className="stock-quote-option"
                  data-active={activeAssetIndex === index ? "true" : "false"}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={stockQuoteOptionTabIndex(index, activeAssetIndex)}
                  key={asset.address}
                  onClick={() => selectAsset(index)}
                  onMouseEnter={() => setActiveAssetIndex(index)}
                  onKeyDown={(event) => onAssetOptionKeyDown(event, index)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="stock-quote-logo"
                    src={logoUrl}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                  />
                  <span>{displayName}</span>
                  {active ? (
                    <Check
                      className="stock-quote-option-check"
                      aria-hidden="true"
                      size={17}
                      strokeWidth={2}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="classic-fee-layout stock-paired-controls">
        <div
          className="classic-fee-fixed stock-paired-fee-card"
          aria-label="Fixed 1.00% swap fee"
        >
          <span className="stock-paired-control-heading">
            <span>Swap fee</span>
            <strong>1.00%</strong>
          </span>
          <small>0.90% creator · 0.10% Programmable</small>
        </div>

        <label
          className="meme-dev-buy stock-paired-initial-buy"
          htmlFor="stock-initial-buy"
        >
          <span className="stock-paired-initial-buy-copy">
            <strong>Initial buy</strong>
            <small>Minimum {STOCK_PAIRED_MIN_INITIAL_BUY_ETH} ETH</small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="stock-initial-buy"
              inputMode="decimal"
              value={draft.initialBuyEth}
              maxLength={40}
              placeholder={STOCK_PAIRED_DEFAULT_INITIAL_BUY_ETH}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateStockDraft({
                  initialBuyEth: event.target.value,
                })
              }
            />
            <button
              type="button"
              disabled={settingMaxBuy || !account}
              onClick={onMaximumBuy}
            >
              {settingMaxBuy ? "Checking" : "Max"}
            </button>
            <span>ETH</span>
          </span>
        </label>

        <div className="stock-paired-launch-action">{launchAction}</div>
      </div>

      {launchStatus ? (
        <div className="classic-launch-status stock-paired-launch-status">
          {launchStatus}
        </div>
      ) : null}
    </section>
  );
}

function FeeStep({
  draft,
  setDraft,
  onEdit,
  settingMaxBuy,
  onMaximumDevBuy,
}: {
  draft: LaunchDraft;
  setDraft: Dispatch<SetStateAction<LaunchDraft>>;
  onEdit: () => void;
  settingMaxBuy: boolean;
  onMaximumDevBuy: () => void;
}) {
  const creatorFeeBps = CLASSIC_TOTAL_SWAP_FEE_BPS - PLATFORM_FEE_BPS;

  return (
    <section className="classic-fee-section">
      <div className="classic-section-heading classic-fee-heading">
        <div>
          <h2>Swap fee</h2>
          <p>
            Creator {(creatorFeeBps / 100).toFixed(2)}%<span>·</span>
            Programmable {(PLATFORM_FEE_BPS / 100).toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="classic-fee-layout">
        <div className="classic-fee-fixed" aria-label="Fixed 1.00% swap fee">
          <span>Total swap fee</span>
          <strong>{CLASSIC_TOTAL_SWAP_FEE_PERCENT}.00%</strong>
        </div>

        <label className="meme-dev-buy" htmlFor="classic-dev-buy">
          <span>
            <strong>Initial buy</strong>
            <small>Minimum {MEME_MIN_INITIAL_BUY_ETH_LABEL}</small>
          </span>
          <span className="meme-dev-buy-input">
            <input
              id="classic-dev-buy"
              inputMode="decimal"
              value={draft.initialBuyEth}
              maxLength={40}
              placeholder={MEME_MIN_INITIAL_BUY_ETH}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => {
                onEdit();
                updateDraft(setDraft, {
                  initialBuyEth: event.target.value,
                });
              }}
            />
            <button
              type="button"
              disabled={settingMaxBuy}
              onClick={onMaximumDevBuy}
            >
              {settingMaxBuy ? "Checking" : "Max"}
            </button>
            <span>ETH</span>
          </span>
        </label>
      </div>
    </section>
  );
}
