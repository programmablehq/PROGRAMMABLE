import { errorIsExplicitWalletRejection } from "../wallet-rejection";
import { findFoundationTransactionByNonce } from "./transaction-by-nonce";
import { assertFoundationEthereumStampEnvelope, decodeFoundationEthereumTransaction } from "./ethereum-graph";
import { assertFoundationEthereumTransaction } from "./ethereum-graph-builder";
import { getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { ModuleNativeWalletTransaction } from "@/lib/module-mode/native-client";
import { readFoundationResolution, writeFoundationResolution, type FoundationResolutionMetadata } from "./result-store";
import { assertFoundationInfrastructure, assertFoundationPool, assertFoundationPreparedSequence, simulateFoundationSequence, simulateFoundationV2Launch,
  type FoundationBalanceCheck, type FoundationDeploymentBinding, type FoundationPreparedStep,
  type prepareFoundationLaunch, type prepareFoundationTrade, type prepareFoundationClaim, type prepareFoundationModuleAction } from "./client";
import { decodeFoundationLaunchSelectionsV1, readFoundationActionRuntimeV1, revalidateFoundationModuleActionV1, type FoundationActionRoleResolverV1 } from "./action-runtime";
import type { FoundationCatalogV1 } from "./catalog";
import { foundationBindingChainId, foundationChainProfile, foundationClientProfile, type FoundationChainId } from "./chains";
import { refreshFoundationAssetsV1 } from "./assets";
import { assertFoundationNativeBalance } from "./native-funding";
import { foundationTransactionGasLimit } from "./gas";
import { foundationHookAbi } from "./abi";
import { foundationFactoryVersion } from "./protocol";

export type FoundationPreparedSequence = Awaited<ReturnType<typeof prepareFoundationLaunch>> | Awaited<ReturnType<typeof prepareFoundationTrade>> | Awaited<ReturnType<typeof prepareFoundationClaim>> | Awaited<ReturnType<typeof prepareFoundationModuleAction>>;
export interface FoundationWalletPreparation {
  readonly sourceKind: "module-foundation-v1";
  readonly account: Address;
  readonly releaseDigest: Hex;
  readonly expiresAt: bigint;
  readonly transaction: Readonly<ModuleNativeWalletTransaction>;
}
interface PrivatePreparation {
  client: PublicClient; sequence: FoundationPreparedSequence; index: number;
  resolveAuthority: () => Promise<FoundationDeploymentBinding>;
  resolveCatalog?: () => Promise<FoundationCatalogV1>;
  resolveRole?: FoundationActionRoleResolverV1;
  state: "ready" | "validating" | "submitted";
  activeOperation?: string;
}
const prepared = new WeakMap<FoundationWalletPreparation, PrivatePreparation>();
const PREFIX = "programmable:foundation-pending:v1:";
export const FOUNDATION_PENDING_EVENT = "programmable:foundation-pending-change";

async function estimateCurrentWalletStep(value: FoundationWalletPreparation, binding: PrivatePreparation): Promise<ModuleNativeWalletTransaction> {
  assertFoundationWalletSubmissionContext(value);
  const nonce = readFoundationPending(value.account, value.transaction.chainId)!.nonce;
  const estimate = await binding.client.estimateGas({ account: value.account, to: value.transaction.to,
    data: value.transaction.data, value: BigInt(value.transaction.value), nonce });
  if (estimate <= 0n) throw new Error("The transaction gas limit could not be estimated.");
  assertFoundationWalletSubmissionContext(value);
  // Callback reserve checks can require much more available gas than the call ultimately consumes.
  // Estimate the exact step after prior approvals are actually confirmed, rather than using gasUsed.
  return Object.freeze({ ...value.transaction, gas: toHex(foundationTransactionGasLimit(estimate, value.transaction.chainId)) });
}

function immutableSnapshot<T>(value: T): T {
  const snapshot = structuredClone(value);
  const freeze = (node: unknown): void => {
    if (!node || typeof node !== "object" || Object.isFrozen(node)) return;
    for (const child of Object.values(node)) freeze(child);
    Object.freeze(node);
  };
  freeze(snapshot);
  return snapshot;
}

export function bindFoundationWalletStep(input: Omit<PrivatePreparation, "state" | "activeOperation">): FoundationWalletPreparation {
  assertFoundationPreparedSequence(input.sequence);
  const sequence = immutableSnapshot(input.sequence);
  const step = sequence.steps[input.index];
  if (!step || input.index < 0 || !Number.isInteger(input.index)) throw new Error("The transaction step is invalid.");
  if (sequence.kind === "launch" && step.kind === "launch" && foundationBindingChainId(sequence.binding) === 1) {
    assertFoundationEthereumStampEnvelope(step.transaction, sequence.account);
  }
  const transaction: ModuleNativeWalletTransaction = {
    chainId: foundationBindingChainId(sequence.binding), ...step.transaction, value: toHex(step.transaction.value),
    gas: toHex(foundationTransactionGasLimit(step.gasUsed, foundationBindingChainId(sequence.binding))),
    action: step.kind === "wrap" || step.kind === "claim" || step.kind === "module-action" ? "manage" : step.kind,
    description: step.effect,
  };
  const value = Object.freeze({ sourceKind: "module-foundation-v1" as const, account: sequence.account,
    releaseDigest: sequence.binding.releaseDigest, expiresAt: sequence.expiresAt,
    transaction: Object.freeze(transaction) });
  prepared.set(value, { ...input, sequence, state: "ready" });
  return value;
}

export async function revalidateFoundationWalletStep(value: FoundationWalletPreparation, account: Address): Promise<ModuleNativeWalletTransaction> {
  const binding = prepared.get(value);
  if (!binding || binding.state !== "ready" || getAddress(value.account) !== getAddress(account)) throw new Error("Prepare this transaction again with the selected wallet.");
  assertFoundationWalletSubmissionContext(value);
  if (value.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) throw new Error("The transaction review expired. Review again.");
  binding.state = "validating";
  try {
    // This resolver reads the actual accepted server release; a public JSON approval field is insufficient.
    const sequence = binding.sequence;
    const needsCatalog = sequence.kind === "module-action" || (sequence.kind === "launch" && sequence.parameters.modules.length > 0)
      || (sequence.kind === "trade" && Boolean(sequence.moduleReview?.selections.length));
    // The session shares only this in-flight authority/catalog read, never a settled approval.
    const original = sequence.binding;
    // Reading the already reviewed runtime can overlap the current admission lookup.
    // Nothing can proceed until both succeed and the current release matches below.
    const [current, catalog, infrastructure] = await Promise.all([
      binding.resolveAuthority(), needsCatalog ? binding.resolveCatalog?.() : undefined,
      sequence.kind === "module-action" ? undefined : assertFoundationInfrastructure(binding.client, original),
    ]);
    if (foundationBindingChainId(current) !== foundationBindingChainId(original) || current.releaseDigest !== original.releaseDigest || current.sourceCommit !== original.sourceCommit || current.startBlock !== original.startBlock
      || foundationFactoryVersion(current) !== foundationFactoryVersion(original) || current.lpCustodyId !== original.lpCustodyId
      || getAddress(current.factory.address) !== getAddress(original.factory.address)
      || current.factory.runtimeCodeHash !== original.factory.runtimeCodeHash
      || getAddress(current.hookDeployer.address) !== getAddress(original.hookDeployer.address)
      || current.hookDeployer.runtimeCodeHash !== original.hookDeployer.runtimeCodeHash) throw new Error("The authorized source release changed. Review again.");
    if (sequence.kind === "module-action") {
      if (!binding.resolveCatalog) throw new Error("The current module admission cannot be checked. Review again.");
      await revalidateFoundationModuleActionV1(sequence, { client: binding.client, catalog: catalog!,
        binding: current, account, resolveRole: binding.resolveRole });
      const transaction = await estimateCurrentWalletStep(value, binding);
      binding.state = "ready";
      return transaction;
    }
    if (sequence.kind === "launch" && current.ethereumGraph) await assertFoundationEthereumTransaction({ source: current.ethereumGraph, transaction: sequence.steps.at(-1)!.transaction });
    let checkpoint = infrastructure!;
    if (sequence.kind === "launch" && sequence.parameters.modules.length > 0) {
      if (!binding.resolveCatalog) throw new Error("The current module admissions cannot be checked. Review again.");
      // Re-decode and exactly re-encode against today's admissions; a stable host release does not freeze module approval.
      if (sequence.modulePackageIds.length !== sequence.parameters.modules.length) throw new Error("Restore the exact source identities from the launch metadata.");
      const assets = await refreshFoundationAssetsV1({ client: binding.client, pins: sequence.moduleAssetPins, checkpoint,
        context: { roles: { creator: sequence.account }, assets: {
          token: { chainId: foundationBindingChainId(current), address: sequence.result.token, decimals: 18 },
          quote: { chainId: foundationBindingChainId(current), address: sequence.parameters.quote, decimals: sequence.parameters.quoteDecimals } },
        components: { factory: current.ethereumGraph ? decodeFoundationEthereumTransaction(sequence.steps.at(-1)!.transaction).engine : current.factory.address, ...Object.fromEntries(Object.entries(foundationChainProfile(foundationBindingChainId(current)).infrastructure).map(([role, pin]) => [role, pin.address])) } } });
      decodeFoundationLaunchSelectionsV1({ chainId: foundationBindingChainId(current), catalog: catalog!, calldata: sequence.steps.at(-1)!.transaction.data,
        packageIds: sequence.modulePackageIds, context: assets.context });
    }
    if (sequence.kind !== "launch") await assertFoundationPool(binding.client, current, sequence.pool, checkpoint.blockNumber);
    if (sequence.kind === "trade") {
      const count = await binding.client.readContract({ address: sequence.pool.hook, abi: foundationHookAbi, functionName: "moduleCount", blockNumber: checkpoint.blockNumber });
      if (count > 8n || (count > 0n && (!binding.resolveCatalog || !sequence.moduleReview
        || BigInt(sequence.moduleReview.selections.length) !== count))) throw new Error("Verify this pool's current module admissions before trading.");
      if (count > 0n) {
        const runtime = await readFoundationActionRuntimeV1({ client: binding.client, binding: current, pool: sequence.pool,
          catalog: catalog ?? await binding.resolveCatalog!(), selections: sequence.moduleReview!.selections, context: sequence.moduleReview!.context });
        checkpoint = runtime.checkpoint;
      }
    }
    if (sequence.kind === "trade" && sequence.moduleAssetPins.length) await refreshFoundationAssetsV1({ client: binding.client, pins: sequence.moduleAssetPins, checkpoint });
    const remaining = sequence.steps.slice(binding.index);
    const checks: readonly FoundationBalanceCheck[] = sequence.kind === "claim"
      ? [{ token: sequence.pool.quote, account: sequence.recipient, minimumDelta: sequence.minimumOutput }]
      : sequence.balanceChecks;
    // Prior approved steps are omitted. Every remaining operation is simulated against fresh real balances and allowances.
    const legacyLaunch = sequence.kind === "launch" && foundationFactoryVersion(current) === "v2";
    if (legacyLaunch) {
      const checked = await simulateFoundationV2Launch({ client: binding.client, binding: current, parameters: sequence.parameters,
        steps: remaining, checkpoint, checks, expected: sequence.result, price: sequence.price });
      if (sequence.steps.some(step => step.transaction.value > 0n)) await assertFoundationNativeBalance(binding.client, account, checked.simulation.steps, checkpoint.blockNumber);
    }
    const [transaction] = await Promise.all([
      estimateCurrentWalletStep(value, binding),
      (async () => {
        if (!legacyLaunch) {
          const simulation = await simulateFoundationSequence(binding.client, remaining, checkpoint, checks);
          if (sequence.steps.some(step => step.transaction.value > 0n)) await assertFoundationNativeBalance(binding.client, account, simulation.steps, checkpoint.blockNumber);
        }
      })(),
    ]);
    assertFoundationWalletSubmissionContext(value);
    binding.state = "ready";
    return transaction;
  } catch (error) { binding.state = "ready"; throw error; }
}

export interface FoundationPendingOperation {
  schemaVersion: "programmable.foundation.pending.v1";
  chainId?: FoundationChainId; account: Address; releaseDigest: Hex; calldataHash: Hex; to: Address; value: Hex;
  transactionHash: Hex | null; createdAt: number;
  walletPhase?: "preparing" | "requested";
  /** The pending account nonce and canonical height immediately before this wallet request. */
  nonce: number; startBlock: string;
  operationId: string;
  metadata?: FoundationResolutionMetadata;
}
export type FoundationLaunchRetry = Readonly<{ account: Address; chainId: FoundationChainId; operationId: string; nonce: number }>;
function isRetryableLaunch(pending: FoundationPendingOperation | null): pending is FoundationPendingOperation {
  return Boolean(pending && !pending.transactionHash && pending.walletPhase !== "preparing"
    && pending.metadata?.operationKind === "launch" && pending.metadata.stepKind === "launch");
}
function matchesLaunchRetry(pending: FoundationPendingOperation | null, retry?: FoundationLaunchRetry) {
  return isRetryableLaunch(pending) && retry && pending.operationId === retry.operationId
    && foundationBindingChainId(pending) === retry.chainId && getAddress(pending.account) === getAddress(retry.account)
    && pending.nonce === retry.nonce;
}
function storeKey(account: Address, chainId: FoundationChainId = 4663) { return `${PREFIX}${foundationChainProfile(chainId).chainId}:${account.toLowerCase()}`; }
function signalChange() { window.dispatchEvent(new Event(FOUNDATION_PENDING_EVENT)); }
export function readFoundationPending(account: Address, chainId: FoundationChainId = 4663): FoundationPendingOperation | null {
  const raw = localStorage.getItem(storeKey(account, chainId));
  if (!raw) return null;
  if (raw.length > 4_096) throw new Error("The saved wallet operation cannot be read. Check wallet activity before continuing.");
  const value = JSON.parse(raw) as FoundationPendingOperation;
  if (foundationBindingChainId(value) !== chainId || value.schemaVersion !== "programmable.foundation.pending.v1" || getAddress(value.account) !== getAddress(account)
    || !/^0x[0-9a-fA-F]{64}$/.test(value.calldataHash) || !/^0x[0-9a-fA-F]{64}$/.test(value.releaseDigest)
    || !/^0x[0-9a-fA-F]+$/.test(value.value) || !Number.isSafeInteger(value.nonce) || value.nonce < 0
    || !/^\d+$/.test(value.startBlock) || !Number.isSafeInteger(value.createdAt) || typeof value.operationId !== "string" || !/^[a-f0-9-]{36}$/.test(value.operationId)
    || (value.transactionHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash))) {
    throw new Error("The saved wallet operation cannot be read. Check wallet activity before continuing.");
  }
  if (value.walletPhase !== undefined && value.walletPhase !== "preparing" && value.walletPhase !== "requested") throw new Error("The saved wallet phase cannot be read.");
  getAddress(value.to);
  return value;
}

/** A missing response may be retried only at its reserved nonce, never by advancing to another transaction. */
export async function readFoundationLaunchRetry(client: PublicClient, account: Address): Promise<FoundationLaunchRetry | null> {
  const chainId = foundationClientProfile(client).chainId;
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet recovery.");
  return navigator.locks.request(storeKey(account, chainId), { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) return null;
    const pending = readFoundationPending(account, chainId);
    if (!isRetryableLaunch(pending) || readFoundationResolution(account, chainId)) return null;
    if (await client.getChainId() !== chainId) throw new Error("Recovery is connected to the wrong chain.");
    const [confirmed, next, head] = await Promise.all([
      client.getTransactionCount({ address: account, blockTag: "latest" }),
      client.getTransactionCount({ address: account, blockTag: "pending" }),
      client.getBlock({ blockTag: "latest" }),
    ]);
    if (confirmed !== pending.nonce || next !== pending.nonce || head.number === null || !head.hash
      || head.number < BigInt(pending.startBlock) || readFoundationPending(account, chainId)?.operationId !== pending.operationId) return null;
    return Object.freeze({ account: getAddress(account), chainId, operationId: pending.operationId, nonce: pending.nonce });
  });
}

/** Provider calls are permitted only inside this exact durable, cross-tab-locked submission. */
export function assertFoundationWalletSubmissionContext(value: FoundationWalletPreparation): void {
  const binding = prepared.get(value), pending = readFoundationPending(value.account, value.transaction.chainId);
  if (!binding?.activeOperation || pending?.operationId !== binding.activeOperation
    || pending.transactionHash !== null || pending.releaseDigest !== value.releaseDigest
    || getAddress(pending.to) !== getAddress(value.transaction.to) || pending.calldataHash !== keccak256(value.transaction.data)
    || BigInt(pending.value) !== BigInt(value.transaction.value)
    || value.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) throw new Error("The wallet submission is no longer current. Review again.");
}

/** Bind the provider request to the same nonce recorded for unknown-outcome recovery. */
export async function foundationWalletRequestNonce(value: FoundationWalletPreparation): Promise<number> {
  assertFoundationWalletSubmissionContext(value);
  const binding = prepared.get(value)!;
  const current = await binding.client.getTransactionCount({ address: value.account, blockTag: "pending" });
  assertFoundationWalletSubmissionContext(value);
  const pending = readFoundationPending(value.account, value.transaction.chainId)!;
  if (pending.nonce !== current) throw new Error("Wallet activity changed the next transaction. Review again.");
  return pending.nonce;
}

/** Called immediately before invoking a wallet send method, while the submission lock is held. */
export function noteFoundationWalletRequest(value: FoundationWalletPreparation): void {
  assertFoundationWalletSubmissionContext(value);
  const key = storeKey(value.account, value.transaction.chainId);
  const pending = readFoundationPending(value.account, value.transaction.chainId)!;
  const serialized = JSON.stringify({ ...pending, walletPhase: "requested" });
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) throw new Error("The wallet request could not be saved.");
  signalChange();
}

/** Persist intent before invoking the wallet. Only adapters calling noteFoundationWalletRequest may opt into preflight tracking. */
export async function submitFoundationWalletStep(value: FoundationWalletPreparation,
  send: (value: FoundationWalletPreparation) => Promise<Hex>, trackPreflight = false, retry?: FoundationLaunchRetry): Promise<Hex> {
  const binding = prepared.get(value);
  if (!binding || binding.state !== "ready") throw new Error("This transaction is not ready for signing.");
  if (binding.sequence.kind === "launch" && value.transaction.action === "launch" && value.transaction.chainId === 1) {
    assertFoundationEthereumStampEnvelope({ ...value.transaction, value: BigInt(value.transaction.value) }, value.account);
  }
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet requests.");
  return navigator.locks.request(storeKey(value.account, value.transaction.chainId), { mode: "exclusive", ifAvailable: true }, async lock => {
    const previous = readFoundationPending(value.account, value.transaction.chainId);
    if (!lock || readFoundationResolution(value.account, value.transaction.chainId)
      || (previous && (!matchesLaunchRetry(previous, retry) || binding.sequence.kind !== "launch"
        || binding.sequence.steps.length !== 1 || binding.sequence.steps[0].kind !== "launch"))
      || (retry && !previous)) throw new Error("A previous wallet operation needs reconciliation first.");
    if (await binding.client.getChainId() !== value.transaction.chainId) throw new Error("The wallet operation is connected to the wrong network.");
    const [nonce, block] = await Promise.all([
      binding.client.getTransactionCount({ address: value.account, blockTag: "pending" }),
      binding.client.getBlock({ blockTag: "latest" }),
    ]);
    if (block.number === null || !block.hash) throw new Error("The current wallet nonce could not be bound to chain state.");
    if (previous && (nonce !== previous.nonce || block.number < BigInt(previous.startBlock)
      || await binding.client.getTransactionCount({ address: value.account, blockTag: "latest" }) !== previous.nonce)) {
      throw new Error("Your previous request is now visible onchain. Check its confirmation before trying again.");
    }
    const pending: FoundationPendingOperation = { schemaVersion: "programmable.foundation.pending.v1", chainId: value.transaction.chainId, account: value.account,
      releaseDigest: value.releaseDigest, calldataHash: keccak256(value.transaction.data), to: value.transaction.to,
      value: value.transaction.value, transactionHash: null, walletPhase: trackPreflight ? "preparing" : "requested", createdAt: Date.now(), nonce, startBlock: block.number.toString(), operationId: crypto.randomUUID(),
      metadata: { stepKind: binding.sequence.steps[binding.index].kind, operationKind: binding.sequence.kind,
        token: binding.sequence.kind === "launch" ? binding.sequence.result.token : binding.sequence.pool.token } };
    localStorage.setItem(storeKey(value.account, value.transaction.chainId), JSON.stringify(pending));
    if (!readFoundationPending(value.account, value.transaction.chainId)) throw new Error("The wallet operation could not be saved.");
    signalChange();
    binding.activeOperation = pending.operationId;
    try {
      const hash = await send(value);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet returned no valid transaction hash. Check wallet activity.");
      binding.state = "submitted";
      // Failure to persist the known hash leaves the earlier unknown operation in place.
      try { localStorage.setItem(storeKey(value.account, value.transaction.chainId), JSON.stringify({ ...pending, walletPhase: "requested", transactionHash: hash })); signalChange(); } catch { /* Return known hash for manual recovery. */ }
      return hash;
    } catch (error) {
      const failure = error as { code?: number; walletRequestAttempted?: boolean; walletRequestRejected?: boolean };
      if (failure.walletRequestAttempted === false || errorIsExplicitWalletRejection(error)) {
        // Cancelling a retry cannot prove that the original wallet request was cancelled too.
        if (previous) localStorage.setItem(storeKey(value.account, value.transaction.chainId), JSON.stringify(previous));
        else localStorage.removeItem(storeKey(value.account, value.transaction.chainId));
        signalChange();
      } else {
        // Unknown send adapters are conservative too: an error is not evidence of no broadcast.
        const current = readFoundationPending(value.account, value.transaction.chainId);
        if (current?.operationId === pending.operationId && current.walletPhase === "preparing") {
          localStorage.setItem(storeKey(value.account, value.transaction.chainId), JSON.stringify({ ...current, walletPhase: "requested" }));
          signalChange();
        }
      }
      throw error;
    } finally { binding.activeOperation = undefined; }
  });
}

/** Verify the exact mined call; discovery may also prove a finalized same-nonce replacement. */
export async function reconcileFoundationPending(client: PublicClient, account: Address, knownHash?: Hex, discover = false) {
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet recovery.");
  const chainId = foundationClientProfile(client).chainId;
  return navigator.locks.request(storeKey(account, chainId), { mode: "exclusive", ifAvailable: true }, async lock => {
  if (!lock) throw new Error("A wallet request is still active. Wait for it to complete.");
  const pending = readFoundationPending(account, chainId);
  if (!pending) throw new Error("No saved wallet operation needs recovery.");
  if (await client.getChainId() !== chainId) throw new Error("Recovery is connected to the wrong chain.");
  const hash = discover
    ? (await findFoundationTransactionByNonce(client, account, pending.nonce, BigInt(pending.startBlock))).hash
    : pending.transactionHash ?? knownHash;
  if (!hash) throw new Error("Find the transaction hash in your wallet activity before continuing.");
  const [transaction, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (getAddress(transaction.from) !== getAddress(account) || getAddress(receipt.from) !== getAddress(account)
    || transaction.to?.toLowerCase() !== receipt.to?.toLowerCase()
    || transaction.hash !== hash || receipt.transactionHash !== hash || transaction.nonce !== pending.nonce
    || (transaction.chainId !== undefined && transaction.chainId !== chainId)
    || receipt.blockNumber < BigInt(pending.startBlock) || transaction.blockNumber !== receipt.blockNumber
    || transaction.blockHash !== receipt.blockHash) throw new Error("This transaction does not match the saved wallet operation.");
  const exactCall = transaction.to && getAddress(transaction.to) === getAddress(pending.to)
    && keccak256(transaction.input) === pending.calldataHash && transaction.value === BigInt(pending.value);
  if (!exactCall && !discover) throw new Error("This transaction does not match the saved wallet operation.");
  if (!exactCall) {
    // A different call with this nonce must be final before an unknown launch can be released.
    const finalized = await client.getBlock({ blockTag: "finalized" });
    if (finalized.number === null || finalized.number < receipt.blockNumber) throw new Error("Your replacement transaction is confirmed but not final yet. Check again shortly.");
  }
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash !== receipt.blockHash) throw new Error("The wallet transaction is not in the canonical chain. Check again.");
  // Preserve a newer operation written in another tab.
  const current = readFoundationPending(account, chainId);
  if (current?.operationId === pending.operationId) {
    writeFoundationResolution({ ...pending, transactionHash: hash }, receipt, pending.metadata, !exactCall);
    localStorage.removeItem(storeKey(account, chainId)); signalChange();
  }
  return receipt;
  });
}

/** Read-only recovery also finds a lost hash, speed-up, or finalized cancellation by account nonce. */
export async function recoverFoundationPending(client: PublicClient, account: Address, knownHash?: Hex) {
  const chainId = foundationClientProfile(client).chainId;
  if (readFoundationPending(account, chainId)?.walletPhase === "preparing") {
    if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet recovery.");
    const released = await navigator.locks.request(storeKey(account, chainId), { mode: "exclusive", ifAvailable: true }, async lock => {
      if (!lock) throw new Error("A wallet request is still active. Wait for it to complete.");
      const pending = readFoundationPending(account, chainId);
      if (!pending || pending.walletPhase !== "preparing" || pending.transactionHash) return false;
      localStorage.removeItem(storeKey(account, chainId)); signalChange();
      return true;
    });
    if (released) return null;
  }
  if (knownHash || readFoundationPending(account, foundationClientProfile(client).chainId)?.transactionHash) {
    try { return await reconcileFoundationPending(client, account, knownHash); }
    catch { /* The wallet may have replaced the hash; discover the exact nonce onchain. */ }
  }
  return reconcileFoundationPending(client, account, undefined, true);
}

export function foundationStepSummary(step: FoundationPreparedStep, chainId: FoundationChainId = 4663) {
  return { label: step.label, to: step.transaction.to, chainId, value: step.transaction.value.toString(), effect: step.effect, spender: step.spender };
}

/** Read the chain only from this SDK's privately bound wallet preparation. */
export function foundationPreparedWalletChainId(value: FoundationWalletPreparation): FoundationChainId {
  const binding = prepared.get(value);
  if (!binding || foundationBindingChainId(binding.sequence.binding) !== value.transaction.chainId) throw new Error("Prepare this Module Mode transaction again.");
  return foundationBindingChainId(binding.sequence.binding);
}
