import { getAddress, type Address, type Hex, type TransactionReceipt } from "viem";
import type { FoundationPendingOperation } from "./wallet";

const PREFIX = "programmable:foundation-resolution:v1:4663:";
const PENDING_LOCK_PREFIX = "programmable:foundation-pending:v1:4663:";
const MAX_BYTES = 4_096;
const SCHEMA = "programmable.foundation.resolution.v1" as const;
export const FOUNDATION_RESOLUTION_EVENT = "programmable:foundation-resolution-change";

export interface FoundationResolutionMetadata {
  stepKind: "approve" | "launch" | "buy" | "sell" | "claim" | "module-action";
  operationKind: "launch" | "trade" | "claim" | "module-action";
  token?: Address;
}
/** A display/recovery record only. It never acts as a preparation or permission to send. */
export interface FoundationResolution {
  schemaVersion: typeof SCHEMA;
  account: Address;
  operationId: string;
  releaseDigest: Hex;
  calldataHash: Hex;
  to: Address;
  value: Hex;
  nonce: number;
  startBlock: string;
  createdAt: number;
  transactionHash: Hex;
  status: "success" | "reverted";
  blockNumber: string;
  blockHash: Hex;
  resolvedAt: number;
  metadata?: FoundationResolutionMetadata;
}

function invalid(): never { throw new Error("The saved transaction result cannot be verified. Check wallet activity before continuing."); }
function storageKey(account: Address) { return `${PREFIX}${getAddress(account).toLowerCase()}`; }
function address(value: unknown): Address {
  if (typeof value !== "string") return invalid();
  const result = getAddress(value);
  if (BigInt(result) === 0n) return invalid();
  return result;
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value) || BigInt(value) === 0n) return invalid();
  return value.toLowerCase() as Hex;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function quantity(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= (1n << 256n)) return invalid();
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function metadata(value: unknown): FoundationResolutionMetadata | undefined {
  if (value === undefined) return undefined;
  const item = object(value);
  if (typeof item.stepKind !== "string" || typeof item.operationKind !== "string"
    || !["approve", "launch", "buy", "sell", "claim", "module-action"].includes(item.stepKind)
    || !["launch", "trade", "claim", "module-action"].includes(item.operationKind)) return invalid();
  const stepKind = item.stepKind as FoundationResolutionMetadata["stepKind"];
  const operationKind = item.operationKind as FoundationResolutionMetadata["operationKind"];
  const allowed = operationKind === "trade" ? ["approve", "buy", "sell"]
    : operationKind === "launch" ? ["approve", "launch"]
      : operationKind === "module-action" ? ["approve", "module-action"] : ["claim"];
  if (!allowed.includes(stepKind)) return invalid();
  return Object.freeze({ stepKind, operationKind, ...(item.token === undefined ? {} : { token: address(item.token) }) });
}
function parse(value: unknown, account: Address): FoundationResolution {
  const item = object(value);
  if (item.schemaVersion !== SCHEMA || address(item.account) !== getAddress(account)
    || typeof item.operationId !== "string" || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.operationId)
    || typeof item.value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(item.value)
    || (item.status !== "success" && item.status !== "reverted")) return invalid();
  const startBlock = quantity(item.startBlock), blockNumber = quantity(item.blockNumber);
  if (BigInt(blockNumber) < BigInt(startBlock)) return invalid();
  const extra = metadata(item.metadata);
  return Object.freeze({ schemaVersion: SCHEMA, account: address(item.account), operationId: item.operationId,
    releaseDigest: hash(item.releaseDigest), calldataHash: hash(item.calldataHash), to: address(item.to),
    value: item.value.toLowerCase() as Hex, nonce: integer(item.nonce), startBlock, createdAt: integer(item.createdAt),
    transactionHash: hash(item.transactionHash), status: item.status, blockNumber, blockHash: hash(item.blockHash),
    resolvedAt: integer(item.resolvedAt), ...(extra === undefined ? {} : { metadata: extra }) });
}
function changed() { window.dispatchEvent(new Event(FOUNDATION_RESOLUTION_EVENT)); }

export function readFoundationResolution(account: Address): FoundationResolution | null {
  const raw = localStorage.getItem(storageKey(account));
  if (raw === null) return null;
  if (!raw || raw.length > MAX_BYTES) return invalid();
  return parse(JSON.parse(raw), account);
}

/** Call while holding the wallet's account WebLock, after exact canonical receipt validation and before clearing pending. */
export function writeFoundationResolution(pending: FoundationPendingOperation, receipt: TransactionReceipt,
  detail?: FoundationResolutionMetadata): FoundationResolution {
  if (pending.schemaVersion !== "programmable.foundation.pending.v1" || !receipt.to
    || address(receipt.from) !== address(pending.account) || address(receipt.to) !== address(pending.to)
    || (pending.transactionHash !== null && hash(pending.transactionHash) !== hash(receipt.transactionHash))) return invalid();
  const result = parse({ schemaVersion: SCHEMA, account: pending.account, operationId: pending.operationId,
    releaseDigest: pending.releaseDigest, calldataHash: pending.calldataHash, to: pending.to, value: pending.value,
    nonce: pending.nonce, startBlock: pending.startBlock, createdAt: pending.createdAt,
    transactionHash: receipt.transactionHash, status: receipt.status, blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash, resolvedAt: Date.now(), metadata: detail }, pending.account);
  const current = readFoundationResolution(result.account);
  if (current) {
    if (current.operationId !== result.operationId) throw new Error("Review the saved transaction result before resolving another operation.");
    // Retrying the same already saved receipt is safe, including after a failed pending-store cleanup.
    if (JSON.stringify({ ...current, resolvedAt: 0 }) !== JSON.stringify({ ...result, resolvedAt: 0 })) return invalid();
    return current;
  }
  const serialized = JSON.stringify(result);
  if (serialized.length > MAX_BYTES) return invalid();
  localStorage.setItem(storageKey(result.account), serialized);
  if (localStorage.getItem(storageKey(result.account)) !== serialized) throw new Error("The confirmed transaction result could not be saved. Keep its hash and retry recovery.");
  changed();
  return result;
}

/** The UI must explicitly acknowledge this exact displayed operation; another tab's newer result is preserved. */
export async function acknowledgeFoundationResolution(account: Address, operationId: string): Promise<void> {
  if (!navigator.locks) throw new Error("This browser cannot safely coordinate transaction results.");
  await navigator.locks.request(`${PENDING_LOCK_PREFIX}${getAddress(account).toLowerCase()}`, { mode: "exclusive", ifAvailable: true }, async lock => {
    if (!lock) throw new Error("A wallet request or recovery is active. Wait for it to complete.");
    const current = readFoundationResolution(account);
    if (!current || current.operationId !== operationId) throw new Error("The saved transaction result changed. Review the current result first.");
    localStorage.removeItem(storageKey(account));
    if (localStorage.getItem(storageKey(account)) !== null) throw new Error("The transaction result could not be acknowledged.");
    changed();
  });
}
