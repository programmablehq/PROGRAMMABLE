import { getAddress, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { ModuleNativeWalletTransaction } from "@/lib/module-mode/native-client";
import { readFoundationResolution, writeFoundationResolution, type FoundationResolutionMetadata } from "./result-store";
import { assertFoundationInfrastructure, assertFoundationPool, assertFoundationPreparedSequence, simulateFoundationSequence, simulateFoundationV2Launch,
  type FoundationBalanceCheck, type FoundationDeploymentBinding, type FoundationPreparedStep,
  type prepareFoundationLaunch, type prepareFoundationTrade, type prepareFoundationClaim, type prepareFoundationModuleAction } from "./client";
import { decodeFoundationLaunchSelectionsV1, readFoundationActionRuntimeV1, revalidateFoundationModuleActionV1, type FoundationActionRoleResolverV1 } from "./action-runtime";
import type { FoundationCatalogV1 } from "./catalog";
import { FOUNDATION_INFRASTRUCTURE } from "./constants";
import { refreshFoundationAssetsV1 } from "./assets";
import { assertFoundationNativeBalance } from "./native-funding";
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
const PREFIX = "programmable:foundation-pending:v1:4663:";
export const FOUNDATION_PENDING_EVENT = "programmable:foundation-pending-change";

async function estimateCurrentWalletStep(value: FoundationWalletPreparation, binding: PrivatePreparation): Promise<ModuleNativeWalletTransaction> {
  assertFoundationWalletSubmissionContext(value);
  const nonce = readFoundationPending(value.account)!.nonce;
  const estimate = await binding.client.estimateGas({ account: value.account, to: value.transaction.to,
    data: value.transaction.data, value: BigInt(value.transaction.value), nonce });
  if (estimate <= 0n) throw new Error("The transaction gas limit could not be estimated.");
  assertFoundationWalletSubmissionContext(value);
  // Callback reserve checks can require much more available gas than the call ultimately consumes.
  // Estimate the exact step after prior approvals are actually confirmed, rather than using gasUsed.
  return Object.freeze({ ...value.transaction, gas: toHex(estimate * 120n / 100n + 15_000n) });
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
  const transaction: ModuleNativeWalletTransaction = {
    chainId: 4663, ...step.transaction, value: toHex(step.transaction.value),
    gas: toHex(step.gasUsed * 120n / 100n + 15_000n),
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
    const current = await binding.resolveAuthority(), original = binding.sequence.binding;
    if (current.releaseDigest !== original.releaseDigest || current.sourceCommit !== original.sourceCommit || current.startBlock !== original.startBlock
      || foundationFactoryVersion(current) !== foundationFactoryVersion(original) || current.lpCustodyId !== original.lpCustodyId
      || getAddress(current.factory.address) !== getAddress(original.factory.address)
      || current.factory.runtimeCodeHash !== original.factory.runtimeCodeHash
      || getAddress(current.hookDeployer.address) !== getAddress(original.hookDeployer.address)
      || current.hookDeployer.runtimeCodeHash !== original.hookDeployer.runtimeCodeHash) throw new Error("The authorized source release changed. Review again.");
    const sequence = binding.sequence;
    if (sequence.kind === "module-action") {
      if (!binding.resolveCatalog) throw new Error("The current module admission cannot be checked. Review again.");
      await revalidateFoundationModuleActionV1(sequence, { client: binding.client, catalog: await binding.resolveCatalog(),
        binding: current, account, resolveRole: binding.resolveRole });
      const transaction = await estimateCurrentWalletStep(value, binding);
      binding.state = "ready";
      return transaction;
    }
    let checkpoint = await assertFoundationInfrastructure(binding.client, current);
    if (sequence.kind === "launch" && sequence.parameters.modules.length > 0) {
      if (!binding.resolveCatalog) throw new Error("The current module admissions cannot be checked. Review again.");
      // Re-decode and exactly re-encode against today's admissions; a stable host release does not freeze module approval.
      if (sequence.modulePackageIds.length !== sequence.parameters.modules.length) throw new Error("Restore the exact source identities from the launch metadata.");
      const assets = await refreshFoundationAssetsV1({ client: binding.client, pins: sequence.moduleAssetPins, checkpoint,
        context: { roles: { creator: sequence.account }, assets: {
          token: { chainId: 4663, address: sequence.result.token, decimals: 18 },
          quote: { chainId: 4663, address: sequence.parameters.quote, decimals: sequence.parameters.quoteDecimals } },
        components: { factory: current.factory.address, ...Object.fromEntries(Object.entries(FOUNDATION_INFRASTRUCTURE).map(([role, pin]) => [role, pin.address])) } } });
      decodeFoundationLaunchSelectionsV1({ catalog: await binding.resolveCatalog(), calldata: sequence.steps.at(-1)!.transaction.data,
        packageIds: sequence.modulePackageIds, context: assets.context });
    }
    if (sequence.kind !== "launch") await assertFoundationPool(binding.client, current, sequence.pool, checkpoint.blockNumber);
    if (sequence.kind === "trade") {
      const count = await binding.client.readContract({ address: sequence.pool.hook, abi: foundationHookAbi, functionName: "moduleCount", blockNumber: checkpoint.blockNumber });
      if (count > 8n || (count > 0n && (!binding.resolveCatalog || !sequence.moduleReview
        || BigInt(sequence.moduleReview.selections.length) !== count))) throw new Error("Verify this pool's current module admissions before trading.");
      if (count > 0n) {
        const runtime = await readFoundationActionRuntimeV1({ client: binding.client, binding: current, pool: sequence.pool,
          catalog: await binding.resolveCatalog!(), selections: sequence.moduleReview!.selections, context: sequence.moduleReview!.context });
        checkpoint = runtime.checkpoint;
      }
    }
    if (sequence.kind === "trade" && sequence.moduleAssetPins.length) await refreshFoundationAssetsV1({ client: binding.client, pins: sequence.moduleAssetPins, checkpoint });
    const remaining = sequence.steps.slice(binding.index);
    const checks: readonly FoundationBalanceCheck[] = sequence.kind === "claim"
      ? [{ token: sequence.pool.quote, account: sequence.recipient, minimumDelta: sequence.minimumOutput }]
      : sequence.balanceChecks;
    // Prior approved steps are omitted. Every remaining operation is simulated against fresh real balances and allowances.
    if (sequence.kind === "launch" && foundationFactoryVersion(current) === "v2") {
      const checked = await simulateFoundationV2Launch({ client: binding.client, binding: current, parameters: sequence.parameters,
        steps: remaining, checkpoint, checks, expected: sequence.result, price: sequence.price });
      if (sequence.steps.some(step => step.kind === "wrap")) await assertFoundationNativeBalance(binding.client, account, checked.simulation.steps, checkpoint.blockNumber);
    } else {
      const simulation = await simulateFoundationSequence(binding.client, remaining, checkpoint, checks);
      if (sequence.steps.some(step => step.kind === "wrap")) await assertFoundationNativeBalance(binding.client, account, simulation.steps, checkpoint.blockNumber);
    }
    const transaction = await estimateCurrentWalletStep(value, binding);
    binding.state = "ready";
    return transaction;
  } catch (error) { binding.state = "ready"; throw error; }
}

export interface FoundationPendingOperation {
  schemaVersion: "programmable.foundation.pending.v1";
  account: Address; releaseDigest: Hex; calldataHash: Hex; to: Address; value: Hex;
  transactionHash: Hex | null; createdAt: number;
  /** The pending account nonce and canonical height immediately before this wallet request. */
  nonce: number; startBlock: string;
  operationId: string;
  metadata?: FoundationResolutionMetadata;
}
function storeKey(account: Address) { return `${PREFIX}${account.toLowerCase()}`; }
function signalChange() { window.dispatchEvent(new Event(FOUNDATION_PENDING_EVENT)); }
export function readFoundationPending(account: Address): FoundationPendingOperation | null {
  const raw = localStorage.getItem(storeKey(account));
  if (!raw) return null;
  if (raw.length > 4_096) throw new Error("The saved wallet operation cannot be read. Check wallet activity before continuing.");
  const value = JSON.parse(raw) as FoundationPendingOperation;
  if (value.schemaVersion !== "programmable.foundation.pending.v1" || getAddress(value.account) !== getAddress(account)
    || !/^0x[0-9a-fA-F]{64}$/.test(value.calldataHash) || !/^0x[0-9a-fA-F]{64}$/.test(value.releaseDigest)
    || !/^0x[0-9a-fA-F]+$/.test(value.value) || !Number.isSafeInteger(value.nonce) || value.nonce < 0
    || !/^\d+$/.test(value.startBlock) || !Number.isSafeInteger(value.createdAt) || typeof value.operationId !== "string" || !/^[a-f0-9-]{36}$/.test(value.operationId)
    || (value.transactionHash !== null && !/^0x[0-9a-fA-F]{64}$/.test(value.transactionHash))) {
    throw new Error("The saved wallet operation cannot be read. Check wallet activity before continuing.");
  }
  getAddress(value.to);
  return value;
}

/** Provider calls are permitted only inside this exact durable, cross-tab-locked submission. */
export function assertFoundationWalletSubmissionContext(value: FoundationWalletPreparation): void {
  const binding = prepared.get(value), pending = readFoundationPending(value.account);
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
  const pending = readFoundationPending(value.account)!;
  if (pending.nonce !== current) throw new Error("Wallet activity changed the next transaction. Review again.");
  return pending.nonce;
}

/** Persist intent before invoking the wallet. An uncertain outcome stays blocked across reloads. */
export async function submitFoundationWalletStep(value: FoundationWalletPreparation,
  send: (value: FoundationWalletPreparation) => Promise<Hex>): Promise<Hex> {
  const binding = prepared.get(value);
  if (!binding || binding.state !== "ready") throw new Error("This transaction is not ready for signing.");
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet requests.");
  return navigator.locks.request(storeKey(value.account), { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock || readFoundationPending(value.account) || readFoundationResolution(value.account)) throw new Error("A previous wallet operation needs reconciliation first.");
    if (await binding.client.getChainId() !== 4663) throw new Error("The wallet operation is connected to the wrong network.");
    const [nonce, block] = await Promise.all([
      binding.client.getTransactionCount({ address: value.account, blockTag: "pending" }),
      binding.client.getBlock({ blockTag: "latest" }),
    ]);
    if (block.number === null || !block.hash) throw new Error("The current wallet nonce could not be bound to chain state.");
    const pending: FoundationPendingOperation = { schemaVersion: "programmable.foundation.pending.v1", account: value.account,
      releaseDigest: value.releaseDigest, calldataHash: keccak256(value.transaction.data), to: value.transaction.to,
      value: value.transaction.value, transactionHash: null, createdAt: Date.now(), nonce, startBlock: block.number.toString(), operationId: crypto.randomUUID(),
      metadata: { stepKind: binding.sequence.steps[binding.index].kind, operationKind: binding.sequence.kind,
        token: binding.sequence.kind === "launch" ? binding.sequence.result.token : binding.sequence.pool.token } };
    localStorage.setItem(storeKey(value.account), JSON.stringify(pending));
    if (!readFoundationPending(value.account)) throw new Error("The wallet operation could not be saved.");
    signalChange();
    binding.activeOperation = pending.operationId;
    try {
      const hash = await send(value);
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("The wallet returned no valid transaction hash. Check wallet activity.");
      binding.state = "submitted";
      // Failure to persist the known hash leaves the earlier unknown operation in place.
      try { localStorage.setItem(storeKey(value.account), JSON.stringify({ ...pending, transactionHash: hash })); signalChange(); } catch { /* Return known hash for manual recovery. */ }
      return hash;
    } catch (error) {
      const failure = error as { code?: number; walletRequestAttempted?: boolean; walletRequestRejected?: boolean };
      if (failure.walletRequestAttempted === false || failure.walletRequestRejected === true || failure.code === 4001) {
        localStorage.removeItem(storeKey(value.account)); signalChange();
      }
      throw error;
    } finally { binding.activeOperation = undefined; }
  });
}

/** Only an exact mined transaction (success or revert) resolves an uncertain send. */
export async function reconcileFoundationPending(client: PublicClient, account: Address, knownHash?: Hex) {
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate wallet recovery.");
  return navigator.locks.request(storeKey(account), { mode: "exclusive", ifAvailable: true }, async lock => {
  if (!lock) throw new Error("A wallet request is still active. Wait for it to complete.");
  const pending = readFoundationPending(account);
  const hash = pending?.transactionHash ?? knownHash;
  if (!pending || !hash) throw new Error("Find the transaction hash in your wallet activity before continuing.");
  if (await client.getChainId() !== 4663) throw new Error("Recovery is connected to the wrong chain.");
  const [transaction, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (!transaction.to || getAddress(transaction.from) !== getAddress(account) || getAddress(transaction.to) !== getAddress(pending.to)
    || transaction.hash !== hash || receipt.transactionHash !== hash || transaction.nonce !== pending.nonce
    || (transaction.chainId !== undefined && transaction.chainId !== 4663)
    || receipt.blockNumber < BigInt(pending.startBlock) || transaction.blockNumber !== receipt.blockNumber
    || transaction.blockHash !== receipt.blockHash
    || keccak256(transaction.input) !== pending.calldataHash || transaction.value !== BigInt(pending.value)) throw new Error("This transaction does not match the saved wallet operation.");
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (canonical.hash !== receipt.blockHash) throw new Error("The wallet transaction is not in the canonical chain. Check again.");
  // Preserve a newer operation written in another tab.
  const current = readFoundationPending(account);
  if (current?.operationId === pending.operationId) {
    writeFoundationResolution(pending, receipt, pending.metadata);
    localStorage.removeItem(storeKey(account)); signalChange();
  }
  return receipt;
  });
}

export function foundationStepSummary(step: FoundationPreparedStep) {
  return { label: step.label, to: step.transaction.to, chainId: 4663, value: step.transaction.value.toString(), effect: step.effect, spender: step.spender };
}
