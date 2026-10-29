import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  http,
  keccak256,
  type EIP1193RequestFn,
  type HttpTransportConfig,
  type Transport,
} from "viem";

const CACHE_SCHEMA = "programmable-rpc-log-cursor-v4";
const CACHE_DIRECTORY = "indexes/rpc-log-cursors/v4";
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu;
const DECIMAL = /^(?:0|[1-9]\d*)$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/iu;
const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PERSISTENT_RPC_CACHE_LIMITS = Object.freeze({
  maxCursorSegments: 16,
  maxSegmentBytes: 4 * 1024 * 1024,
  maxCursorBytes: 64 * 1024,
  maxRuntimeBytes: 256 * 1024,
  maxSegmentReadsPerOperation: 16,
});

type JsonRpcRequest = Parameters<EIP1193RequestFn>[0];
type JsonRpcRequestOptions = Parameters<EIP1193RequestFn>[1];
type JsonRpcResult = Awaited<ReturnType<EIP1193RequestFn>>;

export type PersistentRpcCacheRecord = Readonly<{
  etag: string;
  value: unknown;
}>;

export type PersistentRpcCacheStore = Readonly<{
  read(path: string): Promise<PersistentRpcCacheRecord | null>;
  create(path: string, value: unknown): Promise<"created" | "exists">;
  replace(
    path: string,
    value: unknown,
    expectedEtag: string,
  ): Promise<"replaced" | "conflict">;
}>;

type LogSegment = Readonly<{
  fromBlock: string;
  toBlock: string;
  blockHash: string;
  path: string;
  contentHash: string;
  byteLength: number;
}>;

type LogCursorPayload = Readonly<{
  chainId: number;
  providerId: string;
  streamId: string;
  startBlock: string;
  cursorBlock: string;
  cursorBlockHash: string;
  integrityCommitId?: string;
  segments: readonly LogSegment[];
}>;

type CursorReference = Readonly<{
  path: string;
  contentHash: string;
}>;

type IntegrityCheckpointHeadPayload = Readonly<{
  chainId: number;
  checkpointGroupId: string;
  integrityCommitId: string;
  previousIntegrityCommitId: string | null;
}>;

type IntegrityCheckpointWindow = Readonly<{
  fromBlock: string;
  toBlock: string;
  boundaryBlockHash: string;
}>;

type IntegrityCursorBinding = Readonly<{
  providerId: string;
  streamId: string;
  streamIdentity: string;
  cursorKey: string;
  cursorPath: string;
  cursorContentHash: string;
}>;

type LogSegmentPayload = Readonly<{
  chainId: number;
  providerId: string;
  streamId: string;
  fromBlock: string;
  toBlock: string;
  blockHash: string;
  logs: readonly unknown[];
}>;

type CacheEnvelope = Readonly<{
  schemaVersion: typeof CACHE_SCHEMA;
  contentHash: string;
  payload: unknown;
}>;

type LogFilter = Record<string, unknown> & {
  fromBlock: string;
  toBlock: string;
};

type PersistentRequestInput = Readonly<{
  chainId: number;
  providerId: string;
  request: EIP1193RequestFn;
  store: PersistentRpcCacheStore | null;
  maxLogBlockRange?: bigint;
  immutableCodeBindings?: readonly ImmutableCodeBinding[];
}>;

export type ImmutableCodeBinding = Readonly<{
  address: `0x${string}`;
  expectedRuntimeCodeHash: `0x${string}`;
  notBeforeBlock: bigint;
}>;

type RuntimeCodePayload = Readonly<{
  chainId: number;
  providerId: string;
  address: string;
  expectedRuntimeCodeHash: string;
  notBeforeBlock: string;
  observedAtBlock: string;
  observedAtBlockHash: string;
  code: string;
}>;

export class PersistentRpcCacheError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistentRpcCacheError";
  }
}

export class PersistentRpcCacheReorgError extends PersistentRpcCacheError {
  constructor(message: string) {
    super(message);
    this.name = "PersistentRpcCacheReorgError";
  }
}

function fail(message: string): never {
  throw new PersistentRpcCacheError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function envelope(payload: unknown): CacheEnvelope {
  return {
    schemaVersion: CACHE_SCHEMA,
    contentHash: digest(payload),
    payload,
  };
}

function persistedByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function assertByteLimit(value: unknown, maximum: number, label: string) {
  const byteLength = persistedByteLength(value);
  if (byteLength > maximum) {
    fail(`Persistent RPC cache ${label} exceeds ${maximum} bytes`);
  }
  return byteLength;
}

function unwrapEnvelope(value: unknown) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CACHE_SCHEMA ||
    typeof value.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.contentHash) ||
    digest(value.payload) !== value.contentHash
  ) {
    fail("Persistent RPC cache envelope is invalid");
  }
  return value.payload;
}

function quantity(value: unknown, label: string) {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    fail(`Persistent RPC cache ${label} is invalid`);
  }
  return BigInt(value);
}

function quantityHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function requireBytes32(value: unknown, label: string) {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    fail(`Persistent RPC cache ${label} is invalid`);
  }
  return value.toLowerCase();
}

function parseFilter(request: JsonRpcRequest): LogFilter | null {
  if (request.method !== "eth_getLogs" || !Array.isArray(request.params)) {
    return null;
  }
  const filter = request.params[0];
  if (
    !isRecord(filter) ||
    typeof filter.fromBlock !== "string" ||
    typeof filter.toBlock !== "string" ||
    !HEX_QUANTITY.test(filter.fromBlock) ||
    !HEX_QUANTITY.test(filter.toBlock)
  ) {
    return null;
  }
  if (BigInt(filter.fromBlock) > BigInt(filter.toBlock)) {
    fail("Persistent RPC cache log range is inverted");
  }
  return filter as LogFilter;
}

function normalizedStreamFilter(filter: LogFilter) {
  const stream: Record<string, unknown> = { ...filter };
  delete stream.fromBlock;
  delete stream.toBlock;
  return stream;
}

function streamId(input: PersistentRequestInput, filter: LogFilter) {
  return digest({
    schemaVersion: CACHE_SCHEMA,
    chainId: input.chainId,
    providerId: input.providerId,
    filter: normalizedStreamFilter(filter),
  });
}

function streamIdentity(input: PersistentRequestInput, filter: LogFilter) {
  return digest({
    schemaVersion: CACHE_SCHEMA,
    chainId: input.chainId,
    filter: normalizedStreamFilter(filter),
  });
}

function cursorKey(input: PersistentRequestInput, id: string) {
  return `${input.providerId}:${id}`;
}

function checkpointHeadPath(chainId: number, checkpointGroupId: string) {
  return `${CACHE_DIRECTORY}/${chainId}/checkpoints/${checkpointGroupId}.json`;
}

function integrityCommitPath(
  chainId: number,
  integrityCommitId: string,
) {
  return `${CACHE_DIRECTORY}/${chainId}/integrity/${integrityCommitId}.json`;
}

function cursorVersionPath(
  input: PersistentRequestInput,
  id: string,
  contentHash: string,
) {
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/${id}/cursors/${contentHash}.json`;
}

function segmentPath(
  input: PersistentRequestInput,
  id: string,
  fromBlock: bigint,
  toBlock: bigint,
  contentHash: string,
) {
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/${id}/segments/${fromBlock}-${toBlock}-${contentHash}.json`;
}

function runtimeCodePath(
  input: PersistentRequestInput,
  binding: ImmutableCodeBinding,
) {
  const runtimeProofVersion = "v2";
  const releaseBinding = digest({
    runtimeProofVersion,
    expectedRuntimeCodeHash: binding.expectedRuntimeCodeHash.toLowerCase(),
    notBeforeBlock: quantityHex(binding.notBeforeBlock),
  });
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/runtime-${runtimeProofVersion}/${binding.address.toLowerCase()}/${releaseBinding}.json`;
}

function parseCursor(
  value: unknown,
  input: PersistentRequestInput,
  id: string,
): LogCursorPayload {
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    payload.streamId !== id ||
    typeof payload.startBlock !== "string" ||
    typeof payload.cursorBlock !== "string" ||
    !HEX_QUANTITY.test(payload.startBlock) ||
    !HEX_QUANTITY.test(payload.cursorBlock) ||
    !BYTES32.test(String(payload.cursorBlockHash ?? "")) ||
    (payload.integrityCommitId !== undefined &&
      (typeof payload.integrityCommitId !== "string" ||
        !UUID.test(payload.integrityCommitId))) ||
    !Array.isArray(payload.segments) ||
    payload.segments.length === 0 ||
    payload.segments.length > PERSISTENT_RPC_CACHE_LIMITS.maxCursorSegments
  ) {
    fail("Persistent RPC log cursor is invalid");
  }

  let previousTo: bigint | null = null;
  const segments = payload.segments.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.fromBlock !== "string" ||
      typeof candidate.toBlock !== "string" ||
      !HEX_QUANTITY.test(candidate.fromBlock) ||
      !HEX_QUANTITY.test(candidate.toBlock) ||
      !BYTES32.test(String(candidate.blockHash ?? "")) ||
      typeof candidate.path !== "string" ||
      !candidate.path.startsWith(`${CACHE_DIRECTORY}/`) ||
      typeof candidate.contentHash !== "string" ||
      !/^[0-9a-f]{64}$/u.test(candidate.contentHash) ||
      typeof candidate.byteLength !== "number" ||
      !Number.isSafeInteger(candidate.byteLength) ||
      candidate.byteLength <= 0 ||
      candidate.byteLength > PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes
    ) {
      fail("Persistent RPC log cursor segment is invalid");
    }
    const fromBlock = BigInt(candidate.fromBlock);
    const toBlock = BigInt(candidate.toBlock);
    if (
      toBlock < fromBlock ||
      (previousTo !== null && fromBlock <= previousTo)
    ) {
      fail("Persistent RPC log cursor segments overlap or are unordered");
    }
    previousTo = toBlock;
    return candidate as LogSegment;
  });
  const first = segments[0] as LogSegment;
  const last = segments.at(-1) as LogSegment;
  if (
    BigInt(payload.startBlock) !== BigInt(first.fromBlock) ||
    BigInt(payload.cursorBlock) !== BigInt(last.toBlock) ||
    String(payload.cursorBlockHash).toLowerCase() !==
      last.blockHash.toLowerCase()
  ) {
    fail("Persistent RPC log cursor boundary is invalid");
  }
  const cursor: LogCursorPayload = {
    chainId: input.chainId,
    providerId: input.providerId,
    streamId: id,
    startBlock: payload.startBlock,
    cursorBlock: payload.cursorBlock,
    cursorBlockHash: String(payload.cursorBlockHash).toLowerCase(),
    ...(typeof payload.integrityCommitId === "string"
      ? { integrityCommitId: payload.integrityCommitId }
      : {}),
    segments,
  };
  assertByteLimit(
    envelope(cursor),
    PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
    "cursor",
  );
  return cursor;
}

function parseCheckpointHead(
  value: unknown,
  chainId: number,
  checkpointGroupId: string,
) {
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== chainId ||
    payload.checkpointGroupId !== checkpointGroupId ||
    typeof payload.integrityCommitId !== "string" ||
    !UUID.test(payload.integrityCommitId) ||
    (payload.previousIntegrityCommitId !== null &&
      (typeof payload.previousIntegrityCommitId !== "string" ||
        !UUID.test(payload.previousIntegrityCommitId) ||
        payload.previousIntegrityCommitId === payload.integrityCommitId))
  ) {
    fail("Persistent RPC integrity checkpoint is invalid");
  }
  const head: IntegrityCheckpointHeadPayload = {
    chainId,
    checkpointGroupId,
    integrityCommitId: payload.integrityCommitId,
    previousIntegrityCommitId: payload.previousIntegrityCommitId as string | null,
  };
  assertByteLimit(
    envelope(head),
    PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
    "integrity checkpoint",
  );
  return head;
}

function allowedAddresses(filter: LogFilter) {
  const value = filter.address;
  const addresses = typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value
      : [];
  return new Set(
    addresses
      .filter((address): address is string =>
        typeof address === "string" && ADDRESS.test(address)
      )
      .map((address) => address.toLowerCase()),
  );
}

function logPosition(log: Record<string, unknown>) {
  return [
    quantity(log.blockNumber, "log block number"),
    quantity(log.transactionIndex, "transaction index"),
    quantity(log.logIndex, "log index"),
  ] as const;
}

function comparePosition(
  left: readonly [bigint, bigint, bigint],
  right: readonly [bigint, bigint, bigint],
) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function validateLogs(
  value: unknown,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
) {
  if (!Array.isArray(value)) fail("Persistent RPC log result is not an array");
  const addresses = allowedAddresses(filter);
  const identities = new Set<string>();
  let previousPosition: readonly [bigint, bigint, bigint] | null = null;
  for (const candidate of value) {
    if (!isRecord(candidate)) fail("Persistent RPC log is invalid");
    const position = logPosition(candidate);
    if (
      position[0] < fromBlock ||
      position[0] > toBlock ||
      candidate.removed === true ||
      !BYTES32.test(String(candidate.blockHash ?? "")) ||
      !BYTES32.test(String(candidate.transactionHash ?? "")) ||
      typeof candidate.address !== "string" ||
      !ADDRESS.test(candidate.address) ||
      (addresses.size > 0 && !addresses.has(candidate.address.toLowerCase())) ||
      !Array.isArray(candidate.topics) ||
      !candidate.topics.every(
        (topic) => typeof topic === "string" && BYTES32.test(topic),
      ) ||
      typeof candidate.data !== "string" ||
      !/^0x(?:[0-9a-f]{2})*$/iu.test(candidate.data)
    ) {
      fail("Persistent RPC log provenance is invalid");
    }
    if (previousPosition && comparePosition(previousPosition, position) > 0) {
      fail("Persistent RPC logs are not canonically ordered");
    }
    previousPosition = position;
    const identity = [
      String(candidate.blockHash).toLowerCase(),
      String(candidate.transactionHash).toLowerCase(),
      String(candidate.logIndex).toLowerCase(),
    ].join(":");
    if (identities.has(identity)) {
      fail("Persistent RPC logs contain duplicate provenance");
    }
    identities.add(identity);
  }
  return value as readonly unknown[];
}

function parseSegment(
  value: unknown,
  input: PersistentRequestInput,
  id: string,
  descriptor: LogSegment,
  filter: LogFilter,
) {
  if (persistedByteLength(value) !== descriptor.byteLength) {
    fail("Persistent RPC log segment byte length changed");
  }
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    payload.streamId !== id ||
    payload.fromBlock !== descriptor.fromBlock ||
    payload.toBlock !== descriptor.toBlock ||
    String(payload.blockHash ?? "").toLowerCase() !==
      descriptor.blockHash.toLowerCase() ||
    digest(payload) !== descriptor.contentHash
  ) {
    fail("Persistent RPC log segment binding is invalid");
  }
  return validateLogs(
    payload.logs,
    filter,
    BigInt(descriptor.fromBlock),
    BigInt(descriptor.toBlock),
  );
}

function blockHashFromResult(value: unknown, expectedBlock: bigint) {
  if (
    !isRecord(value) ||
    quantity(value.number, "block number") !== expectedBlock
  ) {
    fail("Persistent RPC cache received the wrong block");
  }
  return requireBytes32(value.hash, "block hash");
}

function blockRequest(blockNumber: bigint): JsonRpcRequest {
  return {
    method: "eth_getBlockByNumber",
    params: [quantityHex(blockNumber), false],
  } as JsonRpcRequest;
}

async function readBlockHash(
  request: EIP1193RequestFn,
  blockNumber: bigint,
  options?: JsonRpcRequestOptions,
) {
  return blockHashFromResult(
    await request(blockRequest(blockNumber), options),
    blockNumber,
  );
}

async function withStableBlockAnchor<T>(
  input: PersistentRequestInput,
  blockNumber: bigint,
  operation: () => Promise<T>,
  options?: JsonRpcRequestOptions,
) {
  const before = await readBlockHash(input.request, blockNumber, options);
  const value = await operation();
  const after = await readBlockHash(input.request, blockNumber, options);
  if (before !== after) {
    throw new PersistentRpcCacheReorgError(
      `Persistent RPC provider ${input.providerId} changed the canonical anchor during a read`,
    );
  }
  return { value, blockHash: after };
}

type BlockHashProof = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

type IntegrityScopeBinding = Readonly<{
  input: PersistentRequestInput;
  proof: BlockHashProof;
  options?: JsonRpcRequestOptions;
}>;

type IntegrityScope = {
  id: number;
  commitId: string;
  phase: "open" | "finalizing" | "closed";
  bindings: Map<string, IntegrityScopeBinding>;
  prechecks: Map<string, Promise<void>>;
  expectedCursorBindings?: number;
  expectedProviderCount?: number;
  expectedStreamsPerProvider?: number;
  requireCheckpointWindow: boolean;
  requiredInitialFromBlock?: string;
  requireContiguousCheckpointWindow: boolean;
  allowCheckpointWindowExtension: boolean;
  checkpointGroupId: string;
  checkpointWindow?: IntegrityCheckpointWindow;
  cursorDrafts: Map<string, CursorReference>;
  checkpoint?: Readonly<{
    store: PersistentRpcCacheStore;
    chainId: number;
    path: string;
    etag: string | null;
    pointedIntegrityCommitId: string | null;
    integrityCommitId: string | null;
    checkpointWindow: IntegrityCheckpointWindow | null;
  }>;
  persistenceBindings: Array<
    {
      input: PersistentRequestInput;
      store: PersistentRpcCacheStore;
      cursors: Map<string, IntegrityCursorBinding>;
    }
  >;
};

const integrityScopes = new AsyncLocalStorage<IntegrityScope>();
let nextIntegrityScopeId = 1;
const requestDomainIds = new WeakMap<object, number>();
let nextRequestDomainId = 1;

function requestDomainId(input: PersistentRequestInput) {
  let id = requestDomainIds.get(input);
  if (!id) {
    id = nextRequestDomainId;
    nextRequestDomainId += 1;
    requestDomainIds.set(input, id);
  }
  return id;
}

function integrityProofKey(input: PersistentRequestInput, blockNumber: bigint) {
  return `${requestDomainId(input)}:${input.chainId}:${input.providerId}:${blockNumber}`;
}

type IntegrityMarkerStatus = "pending" | "committed" | "aborted";

function integrityMarker(
  chainId: number,
  checkpointGroupId: string,
  integrityCommitId: string,
  status: IntegrityMarkerStatus,
  previousIntegrityCommitId: string | null,
  checkpointWindow: IntegrityCheckpointWindow | null,
  cursors: readonly IntegrityCursorBinding[],
) {
  return envelope({
    chainId,
    checkpointGroupId,
    integrityCommitId,
    status,
    previousIntegrityCommitId,
    checkpointWindow,
    cursors: [...cursors].sort((left, right) =>
      left.cursorPath.localeCompare(right.cursorPath)
    ),
  });
}

function parseIntegrityMarker(
  value: unknown,
  chainId: number,
  checkpointGroupId: string,
  integrityCommitId: string,
) {
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== chainId ||
    payload.checkpointGroupId !== checkpointGroupId ||
    payload.integrityCommitId !== integrityCommitId ||
    (payload.status !== "pending" &&
      payload.status !== "committed" &&
      payload.status !== "aborted") ||
    (payload.previousIntegrityCommitId !== null &&
      (typeof payload.previousIntegrityCommitId !== "string" ||
        !UUID.test(payload.previousIntegrityCommitId))) ||
    (payload.checkpointWindow !== null &&
      (!isRecord(payload.checkpointWindow) ||
        typeof payload.checkpointWindow.fromBlock !== "string" ||
        !DECIMAL.test(payload.checkpointWindow.fromBlock) ||
        typeof payload.checkpointWindow.toBlock !== "string" ||
        !DECIMAL.test(payload.checkpointWindow.toBlock) ||
        BigInt(payload.checkpointWindow.fromBlock) >
          BigInt(payload.checkpointWindow.toBlock) ||
        typeof payload.checkpointWindow.boundaryBlockHash !== "string" ||
        !BYTES32.test(payload.checkpointWindow.boundaryBlockHash))) ||
    !Array.isArray(payload.cursors) ||
    payload.cursors.length === 0 ||
    payload.cursors.length > 32
  ) {
    fail("Persistent RPC integrity commit is invalid");
  }
  const cursors = new Map<string, IntegrityCursorBinding>();
  for (const candidate of payload.cursors) {
    if (
      !isRecord(candidate) ||
      typeof candidate.providerId !== "string" ||
      candidate.providerId.length < 1 ||
      typeof candidate.streamId !== "string" ||
      !/^[0-9a-f]{64}$/u.test(candidate.streamId) ||
      typeof candidate.streamIdentity !== "string" ||
      !/^[0-9a-f]{64}$/u.test(candidate.streamIdentity) ||
      typeof candidate.cursorKey !== "string" ||
      candidate.cursorKey !== `${candidate.providerId}:${candidate.streamId}` ||
      typeof candidate.cursorPath !== "string" ||
      !candidate.cursorPath.startsWith(
        `${CACHE_DIRECTORY}/${chainId}/${candidate.providerId}/${candidate.streamId}/cursors/`,
      ) ||
      typeof candidate.cursorContentHash !== "string" ||
      !/^[0-9a-f]{64}$/u.test(candidate.cursorContentHash) ||
      cursors.has(candidate.cursorKey)
    ) {
      fail("Persistent RPC integrity commit cursor binding is invalid");
    }
    cursors.set(candidate.cursorKey, {
      providerId: candidate.providerId,
      streamId: candidate.streamId,
      streamIdentity: candidate.streamIdentity,
      cursorKey: candidate.cursorKey,
      cursorPath: candidate.cursorPath,
      cursorContentHash: candidate.cursorContentHash,
    });
  }
  return {
    status: payload.status,
    previousIntegrityCommitId: payload.previousIntegrityCommitId as string | null,
    checkpointWindow: payload.checkpointWindow as IntegrityCheckpointWindow | null,
    cursors,
  };
}

async function transitionIntegrityMarker(
  chainId: number,
  checkpointGroupId: string,
  store: PersistentRpcCacheStore,
  integrityCommitId: string,
  status: Exclude<IntegrityMarkerStatus, "pending">,
  previousIntegrityCommitId: string | null,
  checkpointWindow: IntegrityCheckpointWindow | null,
  cursors: readonly IntegrityCursorBinding[],
) {
  const path = integrityCommitPath(chainId, integrityCommitId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.read(path);
    if (!record) {
      if (status === "aborted") return;
      fail("Persistent RPC pending integrity commit is missing");
    }
    const current = parseIntegrityMarker(
      record.value,
      chainId,
      checkpointGroupId,
      integrityCommitId,
    );
    const expected = new Map(cursors.map((candidate) => [candidate.cursorKey, candidate]));
    if (
      current.previousIntegrityCommitId !== previousIntegrityCommitId ||
      canonicalJson(current.checkpointWindow) !== canonicalJson(checkpointWindow) ||
      current.cursors.size !== expected.size ||
      [...expected].some(
        ([pathKey, binding]) =>
          canonicalJson(current.cursors.get(pathKey)) !== canonicalJson(binding),
      )
    ) {
      fail("Persistent RPC integrity commit cursor set changed");
    }
    if (
      current.status === status ||
      (current.status === "aborted" && status === "aborted")
    ) {
      return;
    }
    if (current.status !== "pending" && status === "committed") {
      fail("Persistent RPC integrity commit cannot be promoted");
    }
    const marker = integrityMarker(
      chainId,
      checkpointGroupId,
      integrityCommitId,
      status,
      previousIntegrityCommitId,
      checkpointWindow,
      cursors,
    );
    assertByteLimit(
      marker,
      PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
      "integrity commit",
    );
    if (await store.replace(path, marker, record.etag) === "replaced") return;
  }
  fail("Persistent RPC integrity commit update conflicted repeatedly");
}

function logBlockProofs(logs: readonly unknown[]) {
  const proofs = new Map<bigint, string>();
  for (const candidate of logs) {
    if (!isRecord(candidate)) fail("Persistent RPC log is invalid");
    const blockNumber = quantity(candidate.blockNumber, "log block number");
    const blockHash = requireBytes32(candidate.blockHash, "log block hash");
    const existing = proofs.get(blockNumber);
    if (existing && existing !== blockHash) {
      fail("Persistent RPC logs disagree on a block hash");
    }
    proofs.set(blockNumber, blockHash);
  }
  return [...proofs].map(([blockNumber, blockHash]) => ({
    blockNumber,
    blockHash,
  }));
}

function mergeBlockProofs(proofs: readonly BlockHashProof[]) {
  const merged = new Map<bigint, string>();
  for (const proof of proofs) {
    const blockHash = requireBytes32(proof.blockHash, "block proof hash");
    const existing = merged.get(proof.blockNumber);
    if (existing && existing !== blockHash) {
      fail("Persistent RPC proofs disagree on a block hash");
    }
    merged.set(proof.blockNumber, blockHash);
  }
  return [...merged].map(([blockNumber, blockHash]) => ({
    blockNumber,
    blockHash,
  }));
}

async function assertCanonicalBlockProofs(
  input: PersistentRequestInput,
  proofs: readonly BlockHashProof[],
  options?: JsonRpcRequestOptions,
) {
  for (const proof of mergeBlockProofs(proofs)) {
    const canonical = await readBlockHash(
      input.request,
      proof.blockNumber,
      options,
    );
    if (canonical !== proof.blockHash) {
      throw new PersistentRpcCacheReorgError(
        `Persistent RPC provider ${input.providerId} returned a non-canonical log block`,
      );
    }
  }
}

async function registerScopedBlockProofs(
  input: PersistentRequestInput,
  proofs: readonly BlockHashProof[],
  validateNow: boolean,
  options?: JsonRpcRequestOptions,
) {
  const scope = integrityScopes.getStore();
  if (!scope) return false;
  if (scope.phase !== "open") {
    fail("Persistent RPC integrity scope is already sealed");
  }
  for (const proof of mergeBlockProofs(proofs)) {
    const key = integrityProofKey(input, proof.blockNumber);
    const existing = scope.bindings.get(key);
    if (
      existing &&
      existing.proof.blockHash.toLowerCase() !== proof.blockHash.toLowerCase()
    ) {
      fail("Persistent RPC integrity scope proofs disagree on a block hash");
    }
    if (!existing) scope.bindings.set(key, { input, proof, options });
    if (validateNow) {
      let precheck = scope.prechecks.get(key);
      if (!precheck) {
        precheck = assertCanonicalBlockProofs(input, [proof], options);
        scope.prechecks.set(key, precheck);
      }
      await precheck;
    }
  }
  return true;
}

export function bindPersistentRpcIntegrityCheckpointWindow(
  input: Readonly<{
    fromBlock: bigint;
    toBlock: bigint;
    boundaryBlockHash: string;
  }>,
) {
  const scope = integrityScopes.getStore();
  if (!scope || scope.phase !== "open") {
    fail("Persistent RPC checkpoint window requires an open integrity scope");
  }
  if (input.fromBlock > input.toBlock) {
    fail("Persistent RPC checkpoint window is inverted");
  }
  const checkpointWindow: IntegrityCheckpointWindow = {
    fromBlock: input.fromBlock.toString(),
    toBlock: input.toBlock.toString(),
    boundaryBlockHash: requireBytes32(
      input.boundaryBlockHash,
      "checkpoint boundary block hash",
    ),
  };
  if (
    scope.checkpointWindow &&
    canonicalJson(scope.checkpointWindow) !== canonicalJson(checkpointWindow)
  ) {
    fail("Persistent RPC integrity scope has conflicting checkpoint windows");
  }
  scope.checkpointWindow = checkpointWindow;
}

export async function withPersistentRpcIntegrityScope<T>(
  operation: () => Promise<T>,
  input: Readonly<{
    checkpointGroup?: string;
    expectedCursorBindings?: number;
    expectedProviderCount?: number;
    expectedStreamsPerProvider?: number;
    requireCheckpointWindow?: boolean;
    requiredInitialFromBlock?: bigint;
    requireContiguousCheckpointWindow?: boolean;
    allowCheckpointWindowExtension?: boolean;
    signal?: AbortSignal;
  }> = {},
) {
  if (integrityScopes.getStore()) return operation();
  for (const value of [
    input.expectedCursorBindings,
    input.expectedProviderCount,
    input.expectedStreamsPerProvider,
  ]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 1 || value > 32)
    ) {
      fail("Persistent RPC integrity scope expectation is invalid");
    }
  }
  if (
    input.expectedCursorBindings !== undefined &&
    input.expectedProviderCount !== undefined &&
    input.expectedStreamsPerProvider !== undefined &&
    input.expectedProviderCount * input.expectedStreamsPerProvider !==
      input.expectedCursorBindings
  ) {
    fail("Persistent RPC integrity scope expectations disagree");
  }
  const scope: IntegrityScope = {
    id: nextIntegrityScopeId,
    commitId: randomUUID(),
    phase: "open",
    bindings: new Map(),
    prechecks: new Map(),
    expectedCursorBindings: input.expectedCursorBindings,
    expectedProviderCount: input.expectedProviderCount,
    expectedStreamsPerProvider: input.expectedStreamsPerProvider,
    requireCheckpointWindow: input.requireCheckpointWindow === true,
    ...(input.requiredInitialFromBlock !== undefined
      ? { requiredInitialFromBlock: input.requiredInitialFromBlock.toString() }
      : {}),
    requireContiguousCheckpointWindow:
      input.requireContiguousCheckpointWindow === true,
    allowCheckpointWindowExtension:
      input.allowCheckpointWindowExtension === true,
    checkpointGroupId: digest({
      checkpointGroup: input.checkpointGroup ?? "isolated",
    }),
    cursorDrafts: new Map(),
    persistenceBindings: [],
  };
  nextIntegrityScopeId += 1;
  return integrityScopes.run(scope, async () => {
    try {
      input.signal?.throwIfAborted();
      const result = await operation();
      input.signal?.throwIfAborted();
      scope.phase = "finalizing";
      const finalBindings = [...scope.bindings.entries()];
      const commitProofKeys = new Set<string>();
      for (const { input } of scope.persistenceBindings) {
        let commitProof: readonly [string, IntegrityScopeBinding] | null = null;
        for (const binding of finalBindings) {
          if (binding[1].input !== input) continue;
          if (
            !commitProof ||
            binding[1].proof.blockNumber > commitProof[1].proof.blockNumber
          ) {
            commitProof = binding;
          }
        }
        if (!commitProof) {
          fail("Persistent RPC integrity commit has no canonical proof");
        }
        commitProofKeys.add(commitProof[0]);
      }
      for (const [key, binding] of finalBindings) {
        if (commitProofKeys.has(key)) continue;
        input.signal?.throwIfAborted();
        await assertCanonicalBlockProofs(
          binding.input,
          [binding.proof],
          binding.options,
        );
        input.signal?.throwIfAborted();
      }
      const persistence = scope.persistenceBindings[0];
      if (!persistence) return result;
      const cursorBindings = scope.persistenceBindings.flatMap(
        (binding) => [...binding.cursors.values()],
      );
      if (
        scope.expectedCursorBindings !== undefined &&
        cursorBindings.length !== scope.expectedCursorBindings
      ) {
        fail("Persistent RPC integrity scope has incomplete cursor coverage");
      }
      const providerStreams = new Map<string, Set<string>>();
      for (const binding of cursorBindings) {
        const streams = providerStreams.get(binding.providerId) ?? new Set();
        streams.add(binding.streamIdentity);
        providerStreams.set(binding.providerId, streams);
      }
      if (
        scope.expectedProviderCount !== undefined &&
        providerStreams.size !== scope.expectedProviderCount
      ) {
        fail("Persistent RPC integrity scope has incomplete provider coverage");
      }
      if (
        scope.expectedStreamsPerProvider !== undefined &&
        [...providerStreams.values()].some(
          (streams) => streams.size !== scope.expectedStreamsPerProvider,
        )
      ) {
        fail("Persistent RPC integrity scope has incomplete stream coverage");
      }
      const canonicalStreams = [...providerStreams.values()][0];
      if (
        canonicalStreams &&
        [...providerStreams.values()].some(
          (streams) =>
            streams.size !== canonicalStreams.size ||
            [...canonicalStreams].some((stream) => !streams.has(stream)),
        )
      ) {
        fail("Persistent RPC providers do not cover the same event streams");
      }
      if (scope.requireCheckpointWindow && !scope.checkpointWindow) {
        fail("Persistent RPC integrity scope has no checkpoint window");
      }
      if (scope.checkpointWindow) {
        const previousWindow = scope.checkpoint?.checkpointWindow ?? null;
        if (
          previousWindow === null &&
          scope.requiredInitialFromBlock !== undefined &&
          scope.checkpointWindow.fromBlock !== scope.requiredInitialFromBlock
        ) {
          fail("Persistent RPC checkpoint baseline does not start at its release boundary");
        }
        if (
          previousWindow !== null &&
          scope.requireContiguousCheckpointWindow &&
          BigInt(scope.checkpointWindow.fromBlock) !==
            BigInt(previousWindow.toBlock) + 1n
        ) {
          const previousToBlock = BigInt(previousWindow.toBlock);
          const requestedFromBlock = BigInt(scope.checkpointWindow.fromBlock);
          const requestedToBlock = BigInt(scope.checkpointWindow.toBlock);
          if (
            !scope.allowCheckpointWindowExtension ||
            requestedFromBlock > previousToBlock ||
            requestedToBlock <= previousToBlock
          ) {
            fail("Persistent RPC checkpoint window is not contiguous with its committed baseline");
          }
          scope.checkpointWindow = {
            ...scope.checkpointWindow,
            fromBlock: (previousToBlock + 1n).toString(),
          };
        }
      }
      if (scope.checkpointWindow) {
        for (const binding of cursorBindings) {
          const requestInput = scope.persistenceBindings.find(
            (candidate) => candidate.input.providerId === binding.providerId,
          )?.input;
          input.signal?.throwIfAborted();
          const cursorRecord = await persistence.store.read(binding.cursorPath);
          input.signal?.throwIfAborted();
          if (!requestInput || !cursorRecord) {
            fail("Persistent RPC checkpoint cursor is missing");
          }
          const cursor = parseCursor(
            cursorRecord.value,
            requestInput,
            binding.streamId,
          );
          if (scope.requiredInitialFromBlock !== undefined) {
            let nextCoveredBlock = BigInt(scope.requiredInitialFromBlock);
            for (const segment of cursor.segments) {
              if (BigInt(segment.fromBlock) !== nextCoveredBlock) {
                fail("Persistent RPC checkpoint cursor has incomplete historical coverage");
              }
              nextCoveredBlock = BigInt(segment.toBlock) + 1n;
            }
            if (
              nextCoveredBlock !== BigInt(scope.checkpointWindow.toBlock) + 1n
            ) {
              fail("Persistent RPC checkpoint cursor has incomplete historical coverage");
            }
          }
          if (
            BigInt(cursor.cursorBlock) !==
              BigInt(scope.checkpointWindow.toBlock) ||
            cursor.cursorBlockHash.toLowerCase() !==
              scope.checkpointWindow.boundaryBlockHash.toLowerCase()
          ) {
            fail(
              `Persistent RPC checkpoint cursors do not share its boundary: expected ${scope.checkpointWindow.toBlock}:${scope.checkpointWindow.boundaryBlockHash}, received ${cursor.cursorBlock}:${cursor.cursorBlockHash}`,
            );
          }
        }
      }
      const path = integrityCommitPath(
        persistence.input.chainId,
        scope.commitId,
      );
      try {
        const marker = integrityMarker(
          persistence.input.chainId,
          scope.checkpointGroupId,
          scope.commitId,
          "pending",
          scope.checkpoint?.integrityCommitId ?? null,
          scope.checkpointWindow ?? null,
          cursorBindings,
        );
        assertByteLimit(
          marker,
          PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
          "integrity commit",
        );
        input.signal?.throwIfAborted();
        const created = await persistence.store.create(path, marker);
        input.signal?.throwIfAborted();
        if (created !== "created") {
          const record = await persistence.store.read(path);
          input.signal?.throwIfAborted();
          const existing = record
            ? parseIntegrityMarker(
                record.value,
                persistence.input.chainId,
                scope.checkpointGroupId,
                scope.commitId,
              )
            : null;
          if (
            !existing ||
            existing.status !== "pending" ||
            existing.previousIntegrityCommitId !==
              (scope.checkpoint?.integrityCommitId ?? null) ||
            canonicalJson(existing.checkpointWindow) !==
              canonicalJson(scope.checkpointWindow ?? null) ||
            existing.cursors.size !== cursorBindings.length ||
            cursorBindings.some(
              (binding) =>
                canonicalJson(existing.cursors.get(binding.cursorKey)) !==
                canonicalJson(binding),
            )
          ) {
            fail("Persistent RPC integrity commit already exists");
          }
        }
        const checkpoint = scope.checkpoint;
        if (
          !checkpoint ||
          checkpoint.store !== persistence.store ||
          checkpoint.chainId !== persistence.input.chainId
        ) {
          fail("Persistent RPC integrity scope has no stable checkpoint base");
        }
        const nextCheckpoint = envelope({
          chainId: checkpoint.chainId,
          checkpointGroupId: scope.checkpointGroupId,
          integrityCommitId: scope.commitId,
          previousIntegrityCommitId: checkpoint.integrityCommitId,
        } satisfies IntegrityCheckpointHeadPayload);
        assertByteLimit(
          nextCheckpoint,
          PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
          "integrity checkpoint",
        );
        input.signal?.throwIfAborted();
        const published = checkpoint.etag === null
          ? await checkpoint.store.create(checkpoint.path, nextCheckpoint)
          : await checkpoint.store.replace(
              checkpoint.path,
              nextCheckpoint,
              checkpoint.etag,
            );
        input.signal?.throwIfAborted();
        if (
          (checkpoint.etag === null && published !== "created") ||
          (checkpoint.etag !== null && published !== "replaced")
        ) {
          fail("Persistent RPC integrity checkpoint publish conflicted");
        }
        for (const [key, binding] of finalBindings) {
          if (!commitProofKeys.has(key)) continue;
          input.signal?.throwIfAborted();
          await assertCanonicalBlockProofs(
            binding.input,
            [binding.proof],
            binding.options,
          );
          input.signal?.throwIfAborted();
        }
        input.signal?.throwIfAborted();
        await transitionIntegrityMarker(
          persistence.input.chainId,
          scope.checkpointGroupId,
          persistence.store,
          scope.commitId,
          "committed",
          scope.checkpoint?.integrityCommitId ?? null,
          scope.checkpointWindow ?? null,
          cursorBindings,
        );
        input.signal?.throwIfAborted();
      } catch (error) {
        await transitionIntegrityMarker(
          persistence.input.chainId,
          scope.checkpointGroupId,
          persistence.store,
          scope.commitId,
          "aborted",
          scope.checkpoint?.integrityCommitId ?? null,
          scope.checkpointWindow ?? null,
          cursorBindings,
        );
        throw error;
      }
      return result;
    } finally {
      scope.phase = "closed";
    }
  });
}

async function assertCanonicalRuntimeCode(
  input: PersistentRequestInput,
  request: JsonRpcRequest,
  blockNumber: bigint,
  expectedCode: string,
  expectedBlockHash: string,
  options?: JsonRpcRequestOptions,
) {
  const stable = await withStableBlockAnchor(
    input,
    blockNumber,
    () => input.request(request, options),
    options,
  );
  if (
    stable.blockHash !== expectedBlockHash.toLowerCase() ||
    stable.value !== expectedCode
  ) {
    throw new PersistentRpcCacheReorgError(
      `Persistent RPC provider ${input.providerId} changed the runtime proof during persistence`,
    );
  }
}

function immutableCodeBinding(
  input: PersistentRequestInput,
  request: JsonRpcRequest,
) {
  if (request.method !== "eth_getCode" || !Array.isArray(request.params)) {
    return null;
  }
  const address = request.params[0];
  const block = request.params[1];
  if (
    typeof address !== "string" ||
    !ADDRESS.test(address) ||
    typeof block !== "string" ||
    !HEX_QUANTITY.test(block)
  ) {
    return null;
  }
  const binding = input.immutableCodeBindings?.find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  );
  if (!binding || BigInt(block) < binding.notBeforeBlock) return null;
  return { binding, blockNumber: BigInt(block) };
}

function parseRuntimeCode(
  value: unknown,
  input: PersistentRequestInput,
  binding: ImmutableCodeBinding,
) {
  assertByteLimit(
    value,
    PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes,
    "runtime proof",
  );
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    String(payload.address ?? "").toLowerCase() !==
      binding.address.toLowerCase() ||
    String(payload.expectedRuntimeCodeHash ?? "").toLowerCase() !==
      binding.expectedRuntimeCodeHash.toLowerCase() ||
    payload.notBeforeBlock !== quantityHex(binding.notBeforeBlock) ||
    typeof payload.observedAtBlock !== "string" ||
    !HEX_QUANTITY.test(payload.observedAtBlock) ||
    BigInt(payload.observedAtBlock) < binding.notBeforeBlock ||
    !BYTES32.test(String(payload.observedAtBlockHash ?? "")) ||
    typeof payload.code !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/iu.test(payload.code) ||
    keccak256(payload.code as `0x${string}`).toLowerCase() !==
      binding.expectedRuntimeCodeHash.toLowerCase()
  ) {
    fail("Persistent RPC runtime-code binding is invalid");
  }
  return payload as RuntimeCodePayload;
}

function requestWithRange(
  request: JsonRpcRequest,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
): JsonRpcRequest {
  return {
    ...request,
    params: [
      {
        ...filter,
        fromBlock: quantityHex(fromBlock),
        toBlock: quantityHex(toBlock),
      },
    ],
  } as JsonRpcRequest;
}

function* splitLogRange(
  fromBlock: bigint,
  toBlock: bigint,
  maximumRange: bigint | undefined,
) {
  if (maximumRange === undefined) {
    yield [fromBlock, toBlock] as const;
    return;
  }
  if (maximumRange <= 0n) {
    fail("Persistent RPC maximum log block range must be positive");
  }
  for (let start = fromBlock; start <= toBlock; start += maximumRange) {
    const end = start + maximumRange - 1n;
    yield [start, end < toBlock ? end : toBlock] as const;
  }
}

function logsInRequestedRange(
  logs: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
) {
  return logs.filter((candidate) => {
    if (!isRecord(candidate)) return false;
    const block = quantity(candidate.blockNumber, "log block number");
    return block >= fromBlock && block <= toBlock;
  });
}

function recordScopedCursorPersistence(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  binding: IntegrityCursorBinding,
) {
  const scope = integrityScopes.getStore();
  if (!scope) {
    fail("Persistent RPC cursor persistence requires an integrity scope");
  }
  if (scope.phase !== "open") {
    fail("Persistent RPC integrity scope is already sealed");
  }
  const existing = scope.persistenceBindings.find(
    (candidate) =>
      candidate.store === store &&
      candidate.input === input,
  );
  if (existing) {
    existing.cursors.set(binding.cursorKey, binding);
    return;
  }
  if (
    scope.persistenceBindings.some(
      (candidate) =>
        candidate.input.chainId !== input.chainId ||
        candidate.store !== store,
    )
  ) {
    fail("Persistent RPC integrity scope cannot span chains or stores");
  }
  scope.persistenceBindings.push({
    input,
    store,
    cursors: new Map([[binding.cursorKey, binding]]),
  });
}

async function loadCursor(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
) {
  const scope = integrityScopes.getStore();
  const key = cursorKey(input, id);
  if (
    scope?.checkpoint &&
    (scope.checkpoint.store !== store ||
      scope.checkpoint.chainId !== input.chainId)
  ) {
    fail("Persistent RPC integrity scope cannot span chains or stores");
  }
  const draft = scope?.cursorDrafts.get(key);
  if (draft) {
    const cursorRecord = await store.read(draft.path);
    if (!cursorRecord || digest(cursorRecord.value) !== draft.contentHash) {
      fail("Persistent RPC draft cursor binding is invalid");
    }
    return {
      cursor: parseCursor(cursorRecord.value, input, id),
      reference: draft,
    };
  }

  const path = checkpointHeadPath(
    input.chainId,
    scope?.checkpointGroupId ?? digest({ cursorKey: key }),
  );
  const record = await store.read(path);
  const checkpointGroupId = scope?.checkpointGroupId ?? digest({ cursorKey: key });
  const head = record
    ? parseCheckpointHead(record.value, input.chainId, checkpointGroupId)
    : null;
  if (!head) {
    if (scope) {
      if (scope.checkpoint) {
        if (
          scope.checkpoint.store !== store ||
          scope.checkpoint.chainId !== input.chainId ||
          scope.checkpoint.etag !== null ||
          scope.checkpoint.pointedIntegrityCommitId !== null ||
          scope.checkpoint.integrityCommitId !== null
        ) {
          fail("Persistent RPC integrity scope checkpoint changed during its read");
        }
      } else {
        scope.checkpoint = {
          store,
          chainId: input.chainId,
          path,
          etag: null,
          pointedIntegrityCommitId: null,
          integrityCommitId: null,
          checkpointWindow: null,
        };
      }
    }
    return { cursor: null };
  }
  const pointedCommit = await store.read(
    integrityCommitPath(input.chainId, head.integrityCommitId),
  );
  if (!pointedCommit) fail("Persistent RPC integrity checkpoint marker is missing");
  const pointedMarker = parseIntegrityMarker(
    pointedCommit.value,
    input.chainId,
    checkpointGroupId,
    head.integrityCommitId,
  );
  if (pointedMarker.previousIntegrityCommitId !== head.previousIntegrityCommitId) {
    fail("Persistent RPC checkpoint lineage is invalid");
  }
  let acceptedIntegrityCommitId: string | null = head.integrityCommitId;
  let marker = pointedMarker;
  if (pointedMarker.status !== "committed") {
    acceptedIntegrityCommitId = head.previousIntegrityCommitId;
    if (acceptedIntegrityCommitId === null) {
      if (scope) {
        const nextCheckpoint = {
          store,
          chainId: input.chainId,
          path,
          etag: record?.etag ?? null,
          pointedIntegrityCommitId: head.integrityCommitId,
          integrityCommitId: null,
          checkpointWindow: null,
        };
        if (
          scope.checkpoint &&
          (scope.checkpoint.store !== nextCheckpoint.store ||
            scope.checkpoint.chainId !== nextCheckpoint.chainId ||
            scope.checkpoint.path !== nextCheckpoint.path ||
            scope.checkpoint.etag !== nextCheckpoint.etag ||
            scope.checkpoint.pointedIntegrityCommitId !==
              nextCheckpoint.pointedIntegrityCommitId ||
            scope.checkpoint.integrityCommitId !== null)
        ) {
          fail("Persistent RPC integrity scope checkpoint changed during its read");
        }
        scope.checkpoint = nextCheckpoint;
      }
      return { cursor: null };
    }
    const previousCommit = await store.read(
      integrityCommitPath(input.chainId, acceptedIntegrityCommitId),
    );
    if (!previousCommit) {
      fail("Persistent RPC previous checkpoint marker is missing");
    }
    marker = parseIntegrityMarker(
      previousCommit.value,
      input.chainId,
      checkpointGroupId,
      acceptedIntegrityCommitId,
    );
    if (marker.status !== "committed") {
      fail("Persistent RPC previous checkpoint is not committed");
    }
  }
  if (scope) {
    if (scope.checkpoint) {
      if (
        scope.checkpoint.store !== store ||
        scope.checkpoint.chainId !== input.chainId ||
        scope.checkpoint.etag !== (record?.etag ?? null) ||
        scope.checkpoint.pointedIntegrityCommitId !== head.integrityCommitId ||
        scope.checkpoint.integrityCommitId !== acceptedIntegrityCommitId
      ) {
        fail("Persistent RPC integrity scope checkpoint changed during its read");
      }
    } else {
      scope.checkpoint = {
        store,
        chainId: input.chainId,
        path,
        etag: record?.etag ?? null,
        pointedIntegrityCommitId: head.integrityCommitId,
        integrityCommitId: acceptedIntegrityCommitId,
        checkpointWindow: marker.checkpointWindow,
      };
    }
  }
  const binding = marker.cursors.get(key);
  if (
    marker.status !== "committed" ||
    !binding ||
    binding.providerId !== input.providerId ||
    binding.streamId !== id ||
    binding.streamIdentity !== streamIdentity(input, filter)
  ) {
    fail("Persistent RPC integrity checkpoint cursor binding is missing");
  }
  const cursorRecord = await store.read(binding.cursorPath);
  if (
    !cursorRecord ||
    digest(cursorRecord.value) !== binding.cursorContentHash
  ) {
    fail("Persistent RPC integrity checkpoint cursor is invalid");
  }
  const cursor = parseCursor(cursorRecord.value, input, id);
  if (cursor.integrityCommitId !== acceptedIntegrityCommitId) {
    fail("Persistent RPC cursor is bound to the wrong integrity checkpoint");
  }
  return {
    cursor,
    reference: {
      path: binding.cursorPath,
      contentHash: binding.cursorContentHash,
    },
  };
}

async function assertCanonicalCursor(
  request: EIP1193RequestFn,
  cursor: LogCursorPayload,
  options?: JsonRpcRequestOptions,
) {
  const blockNumber = BigInt(cursor.cursorBlock);
  const block = await request(blockRequest(blockNumber), options);
  const hash = blockHashFromResult(block, blockNumber);
  if (hash !== cursor.cursorBlockHash.toLowerCase()) {
    throw new PersistentRpcCacheReorgError(
      "Persistent RPC log cursor is no longer canonical",
    );
  }
}

async function readCoveredLogs(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  cursor: LogCursorPayload,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
) {
  if (
    cursor.segments.length >
    PERSISTENT_RPC_CACHE_LIMITS.maxSegmentReadsPerOperation
  ) {
    fail("Persistent RPC cursor exceeds its segment-read budget");
  }
  const logs: unknown[] = [];
  const gaps: Array<readonly [bigint, bigint]> = [];
  let nextMissingBlock = fromBlock;
  for (const descriptor of cursor.segments) {
    const segmentFrom = BigInt(descriptor.fromBlock);
    const segmentTo = BigInt(descriptor.toBlock);
    if (segmentTo < fromBlock) continue;
    if (segmentFrom > toBlock) break;
    if (segmentFrom > nextMissingBlock) {
      gaps.push([nextMissingBlock, segmentFrom - 1n]);
    }
    const record = await store.read(descriptor.path);
    if (!record) fail("Persistent RPC log segment is missing");
    const segmentLogs = parseSegment(
      record.value,
      input,
      id,
      descriptor,
      filter,
    );
    logs.push(...logsInRequestedRange(segmentLogs, fromBlock, toBlock));
    nextMissingBlock = segmentTo + 1n;
    if (nextMissingBlock > toBlock) break;
  }
  if (nextMissingBlock <= toBlock) gaps.push([nextMissingBlock, toBlock]);
  return { logs, gaps };
}

async function createSegment(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  blockHash: string,
  logs: readonly unknown[],
) {
  const payload: LogSegmentPayload = {
    chainId: input.chainId,
    providerId: input.providerId,
    streamId: id,
    fromBlock: quantityHex(fromBlock),
    toBlock: quantityHex(toBlock),
    blockHash,
    logs: validateLogs(logs, filter, fromBlock, toBlock),
  };
  const contentHash = digest(payload);
  const path = segmentPath(
    input,
    id,
    fromBlock,
    toBlock,
    contentHash,
  );
  const wrappedPayload = envelope(payload);
  const descriptor: LogSegment = {
    fromBlock: payload.fromBlock,
    toBlock: payload.toBlock,
    blockHash,
    path,
    contentHash,
    byteLength: assertByteLimit(
      wrappedPayload,
      PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes,
      "log segment",
    ),
  };
  const created = await store.create(path, wrappedPayload);
  if (created === "exists") {
    const existing = await store.read(path);
    if (!existing) fail("Persistent RPC log segment raced and disappeared");
    parseSegment(existing.value, input, id, descriptor, filter);
  }
  return descriptor;
}

async function mergeAdjacentSegments(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
  left: LogSegment,
  right: LogSegment,
) {
  const leftTo = BigInt(left.toBlock);
  const rightFrom = BigInt(right.fromBlock);
  if (leftTo + 1n !== rightFrom) {
    fail("Persistent RPC compaction requires adjacent segments");
  }
  const [leftRecord, rightRecord] = await Promise.all([
    store.read(left.path),
    store.read(right.path),
  ]);
  if (!leftRecord || !rightRecord) {
    fail("Persistent RPC compaction source is missing");
  }
  const logs = [
    ...parseSegment(leftRecord.value, input, id, left, filter),
    ...parseSegment(rightRecord.value, input, id, right, filter),
  ];
  return createSegment(
    store,
    input,
    id,
    filter,
    BigInt(left.fromBlock),
    BigInt(right.toBlock),
    right.blockHash,
    logs,
  );
}

async function compactSegments(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
  candidates: readonly LogSegment[],
) {
  const segments = [...candidates].sort((left, right) =>
    BigInt(left.fromBlock) < BigInt(right.fromBlock) ? -1 : 1,
  );
  while (segments.length > PERSISTENT_RPC_CACHE_LIMITS.maxCursorSegments) {
    let mergeAt = -1;
    let smallestCombinedBytes = Number.POSITIVE_INFINITY;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const left = segments[index] as LogSegment;
      const right = segments[index + 1] as LogSegment;
      const combinedBytes = left.byteLength + right.byteLength;
      if (
        BigInt(left.toBlock) + 1n === BigInt(right.fromBlock) &&
        combinedBytes <= PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes &&
        combinedBytes < smallestCombinedBytes
      ) {
        mergeAt = index;
        smallestCombinedBytes = combinedBytes;
      }
    }
    if (mergeAt < 0) {
      fail("Persistent RPC cursor reached its bounded compaction capacity");
    }
    const compacted = await mergeAdjacentSegments(
      store,
      input,
      id,
      filter,
      segments[mergeAt] as LogSegment,
      segments[mergeAt + 1] as LogSegment,
    );
    segments.splice(mergeAt, 2, compacted);
  }
  return segments;
}

async function persistSegment(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  loaded: Awaited<ReturnType<typeof loadCursor>>,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  blockHash: string,
  logs: readonly unknown[],
) {
  const integrityScope = integrityScopes.getStore();
  const key = cursorKey(input, id);
  const descriptor = await createSegment(
    store,
    input,
    id,
    filter,
    fromBlock,
    toBlock,
    blockHash,
    logs,
  );

  const current = integrityScope?.cursorDrafts.has(key)
    ? await loadCursor(store, input, id, filter)
    : loaded;
  if (current.cursor) {
    const exact = current.cursor.segments.find(
      (candidate) =>
        BigInt(candidate.fromBlock) === fromBlock &&
        BigInt(candidate.toBlock) === toBlock,
    );
    if (exact) {
      if (
        exact.contentHash !== descriptor.contentHash ||
        exact.blockHash.toLowerCase() !== descriptor.blockHash.toLowerCase()
      ) {
        fail("Persistent RPC log segment range changed content");
      }
      return;
    }
    if (
      current.cursor.segments.some(
        (candidate) =>
          fromBlock <= BigInt(candidate.toBlock) &&
          toBlock >= BigInt(candidate.fromBlock),
      )
    ) {
      fail("Persistent RPC log segment overlaps concurrent coverage");
    }
  }
  const segments = await compactSegments(
    store,
    input,
    id,
    filter,
    [...(current.cursor?.segments ?? []), descriptor],
  );
  const first = segments[0] as LogSegment;
  const last = segments.at(-1) as LogSegment;
  const next: LogCursorPayload = {
    chainId: input.chainId,
    providerId: input.providerId,
    streamId: id,
    startBlock: first.fromBlock,
    cursorBlock: last.toBlock,
    cursorBlockHash: last.blockHash,
    ...(integrityScope
      ? { integrityCommitId: integrityScope.commitId }
      : {}),
    segments,
  };
  const nextEnvelope = envelope(next);
  assertByteLimit(
    nextEnvelope,
    PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
    "cursor",
  );
  const cursorContentHash = digest(nextEnvelope);
  const versionPath = cursorVersionPath(input, id, cursorContentHash);
  const createdVersion = await store.create(versionPath, nextEnvelope);
  if (createdVersion === "exists") {
    const version = await store.read(versionPath);
    if (!version || digest(version.value) !== cursorContentHash) {
      fail("Persistent RPC cursor version binding is invalid");
    }
    parseCursor(version.value, input, id);
  }
  const nextReference: CursorReference = {
    path: versionPath,
    contentHash: cursorContentHash,
  };
  const binding: IntegrityCursorBinding = {
    providerId: input.providerId,
    streamId: id,
    streamIdentity: streamIdentity(input, filter),
    cursorKey: key,
    cursorPath: versionPath,
    cursorContentHash,
  };
  if (!integrityScope) fail("Persistent RPC cursor persistence requires an integrity scope");
  integrityScope.cursorDrafts.set(key, nextReference);
  recordScopedCursorPersistence(store, input, binding);
}

const requestFlights = new Map<string, Promise<JsonRpcResult>>();
const automaticScopeFlights = new Map<string, Promise<JsonRpcResult>>();

export function createPersistentRpcRequest(
  input: PersistentRequestInput,
): EIP1193RequestFn {
  const validateBlock = async (
    blockNumber: bigint,
    expectedBlockHash: string,
    options?: JsonRpcRequestOptions,
  ) => {
    const hash = await readBlockHash(input.request, blockNumber, options);
    if (hash !== expectedBlockHash.toLowerCase()) {
      throw new PersistentRpcCacheReorgError(
        "Persistent RPC runtime-code proof is no longer canonical",
      );
    }
  };
  const validateCursor = async (
    cursor: LogCursorPayload,
    options?: JsonRpcRequestOptions,
  ) => assertCanonicalCursor(input.request, cursor, options);
  const wrapped = async (
    request: JsonRpcRequest,
    options?: JsonRpcRequestOptions,
  ): Promise<JsonRpcResult> => {
    const integrityScope = integrityScopes.getStore();
    const assertScopeLease = () => {
      if (integrityScope && integrityScope.phase !== "open") {
        fail("Persistent RPC integrity scope is already sealed");
      }
    };
    assertScopeLease();
    const codeBinding = immutableCodeBinding(input, request);
    if (codeBinding && input.store) {
      const path = runtimeCodePath(input, codeBinding.binding);
      const existing = await input.store.read(path);
      assertScopeLease();
      if (existing) {
        const proof = parseRuntimeCode(existing.value, input, codeBinding.binding);
        if (BigInt(proof.observedAtBlock) <= codeBinding.blockNumber) {
          await validateBlock(
            BigInt(proof.observedAtBlock),
            proof.observedAtBlockHash,
            options,
          );
          assertScopeLease();
          return proof.code;
        }
      }
      const stableCode = await withStableBlockAnchor(
        input,
        codeBinding.blockNumber,
        () => input.request(request, options),
        options,
      );
      assertScopeLease();
      const code = stableCode.value;
      if (
        typeof code !== "string" ||
        !/^0x(?:[0-9a-f]{2})+$/iu.test(code) ||
        keccak256(code as `0x${string}`).toLowerCase() !==
          codeBinding.binding.expectedRuntimeCodeHash.toLowerCase()
      ) {
        fail("RPC runtime code does not match its immutable release binding");
      }
      const payload: RuntimeCodePayload = {
        chainId: input.chainId,
        providerId: input.providerId,
        address: codeBinding.binding.address.toLowerCase(),
        expectedRuntimeCodeHash:
          codeBinding.binding.expectedRuntimeCodeHash.toLowerCase(),
        notBeforeBlock: quantityHex(codeBinding.binding.notBeforeBlock),
        observedAtBlock: quantityHex(codeBinding.blockNumber),
        observedAtBlockHash: stableCode.blockHash,
        code,
      };
      const runtimeEnvelope = envelope(payload);
      assertByteLimit(
        runtimeEnvelope,
        PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes,
        "runtime proof",
      );
      const created = await input.store.create(path, runtimeEnvelope);
      assertScopeLease();
      if (created === "exists") {
        const raced = await input.store.read(path);
        assertScopeLease();
        if (!raced) fail("Persistent RPC runtime proof raced and disappeared");
        parseRuntimeCode(raced.value, input, codeBinding.binding);
      }
      await assertCanonicalRuntimeCode(
        input,
        request,
        codeBinding.blockNumber,
        code,
        stableCode.blockHash,
        options,
      );
      assertScopeLease();
      return code;
    }
    const filter = parseFilter(request);
    if (!filter) {
      const result = await input.request(request, options);
      assertScopeLease();
      return result;
    }
    if (input.store && !integrityScope) {
      const automaticFlightKey = digest({
        requestDomainId: requestDomainId(input),
        providerId: input.providerId,
        filter,
      });
      const existing = automaticScopeFlights.get(automaticFlightKey);
      if (existing) return existing;
      const automatic = (async () => {
        for (let attempt = 0; attempt < 4; attempt += 1) {
          try {
            return await withPersistentRpcIntegrityScope(
              () => wrapped(request, options),
              {
                checkpointGroup: `isolated:${cursorKey(
                  input,
                  streamId(input, filter),
                )}`,
                expectedCursorBindings: 1,
                expectedProviderCount: 1,
                expectedStreamsPerProvider: 1,
              },
            );
          } catch (error) {
            if (
              attempt === 3 ||
              !(error instanceof PersistentRpcCacheError) ||
              error.message !==
                "Persistent RPC integrity checkpoint publish conflicted"
            ) {
              throw error;
            }
          }
        }
        fail("Persistent RPC automatic checkpoint retry exhausted");
      })();
      automaticScopeFlights.set(automaticFlightKey, automatic);
      try {
        return await automatic;
      } finally {
        if (automaticScopeFlights.get(automaticFlightKey) === automatic) {
          automaticScopeFlights.delete(automaticFlightKey);
        }
      }
    }
    const fromBlock = BigInt(filter.fromBlock);
    const toBlock = BigInt(filter.toBlock);
    if (!input.store) {
      if (
        input.maxLogBlockRange === undefined ||
        toBlock - fromBlock + 1n <= input.maxLogBlockRange
      ) {
        const result = await input.request(request, options);
        assertScopeLease();
        return result;
      }
      const logs: unknown[] = [];
      let completedRanges = 0;
      for (const [rangeFrom, rangeTo] of splitLogRange(
        fromBlock,
        toBlock,
        input.maxLogBlockRange,
      )) {
        try {
          logs.push(
            ...validateLogs(
              await input.request(
                requestWithRange(request, filter, rangeFrom, rangeTo),
                options,
              ),
              filter,
              rangeFrom,
              rangeTo,
            ),
          );
          assertScopeLease();
          completedRanges += 1;
        } catch (error) {
          if (completedRanges > 0) {
            throw new PersistentRpcCacheError(
              "Persistent RPC passthrough stopped after a partial range; refusing to replay its prefix",
              { cause: error },
            );
          }
          throw error;
        }
      }
      const validated = validateLogs(logs, filter, fromBlock, toBlock);
      assertScopeLease();
      return validated;
    }
    const id = streamId(input, filter);
    const flightKey = digest({
      providerId: input.providerId,
      chainId: input.chainId,
      id,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      integrityScopeId: integrityScope?.id ?? null,
      requestDomainId: requestDomainId(input),
    });
    const existingFlight = requestFlights.get(flightKey);
    if (existingFlight) {
      const result = await existingFlight;
      assertScopeLease();
      return result;
    }

    const value = (async () => {
      const loaded = await loadCursor(
        input.store as PersistentRpcCacheStore,
        input,
        id,
        filter,
      );
      assertScopeLease();
      let logs: unknown[] = [];
      let gaps: Array<readonly [bigint, bigint]> = [[fromBlock, toBlock]];
      const newAnchors: BlockHashProof[] = [];
      if (loaded.cursor) {
        const cursorProof = {
          blockNumber: BigInt(loaded.cursor.cursorBlock),
          blockHash: loaded.cursor.cursorBlockHash,
        };
        if (
          !(await registerScopedBlockProofs(
            input,
            [cursorProof],
            true,
            options,
          ))
        ) {
          await validateCursor(loaded.cursor, options);
        }
        assertScopeLease();
        const covered = await readCoveredLogs(
          input.store as PersistentRpcCacheStore,
          input,
          id,
          loaded.cursor,
          filter,
          fromBlock,
          toBlock,
        );
        assertScopeLease();
        logs = covered.logs;
        gaps = covered.gaps;
      }
      for (const [gapFrom, gapTo] of gaps) {
        for (const [missingFrom, missingTo] of splitLogRange(
          gapFrom,
          gapTo,
          input.maxLogBlockRange,
        )) {
          const stableLogs = await withStableBlockAnchor(
            input,
            missingTo,
            () =>
              input.request(
                requestWithRange(request, filter, missingFrom, missingTo),
                options,
              ),
            options,
          );
          assertScopeLease();
          const fetchedLogs = validateLogs(
            stableLogs.value,
            filter,
            missingFrom,
            missingTo,
          );
          const fetchedLogProofs = logBlockProofs(fetchedLogs);
          const newAnchor = {
            blockNumber: missingTo,
            blockHash: stableLogs.blockHash,
          };
          const nonAnchorLogProofs = mergeBlockProofs([
            ...fetchedLogProofs,
            newAnchor,
          ]).filter((proof) => proof.blockNumber !== missingTo);
          if (
            !(await registerScopedBlockProofs(
              input,
              nonAnchorLogProofs,
              true,
              options,
            ))
          ) {
            await assertCanonicalBlockProofs(
              input,
              nonAnchorLogProofs,
              options,
            );
          }
          assertScopeLease();
          await registerScopedBlockProofs(
            input,
            [newAnchor, ...fetchedLogProofs],
            false,
            options,
          );
          assertScopeLease();
          await persistSegment(
            input.store as PersistentRpcCacheStore,
            input,
            id,
            loaded,
            filter,
            missingFrom,
            missingTo,
            stableLogs.blockHash,
            fetchedLogs,
          );
          assertScopeLease();
          newAnchors.push(newAnchor);
          logs.push(...fetchedLogs);
        }
      }
      const orderedLogs = [...logs].sort((left, right) =>
        comparePosition(
          logPosition(left as Record<string, unknown>),
          logPosition(right as Record<string, unknown>),
        ),
      );
      const validatedLogs = validateLogs(
        orderedLogs,
        filter,
        fromBlock,
        toBlock,
      );
      if (!integrityScope) {
        const finalProofs = logBlockProofs(validatedLogs);
        if (loaded.cursor) {
          finalProofs.push({
            blockNumber: BigInt(loaded.cursor.cursorBlock),
            blockHash: loaded.cursor.cursorBlockHash,
          });
        }
        finalProofs.push(...newAnchors);
        await assertCanonicalBlockProofs(input, finalProofs, options);
        assertScopeLease();
      }
      assertScopeLease();
      return validatedLogs;
    })() as Promise<JsonRpcResult>;
    requestFlights.set(flightKey, value);
    try {
      const result = await value;
      assertScopeLease();
      return result;
    } finally {
      if (requestFlights.get(flightKey) === value) {
        requestFlights.delete(flightKey);
      }
    }
  };
  return wrapped as EIP1193RequestFn;
}

function blobToken(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.OPS_BLOB_READ_WRITE_TOKEN?.trim() ||
    environment.BLOB_READ_WRITE_TOKEN?.trim() ||
    null
  );
}

export function createEnvironmentPersistentRpcCacheStore(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const token = blobToken(environment);
  return token ? createVercelBlobPersistentRpcCacheStore(token) : null;
}

export function persistentRpcCachePathByteLimit(path: string) {
  if (!path.startsWith(`${CACHE_DIRECTORY}/`)) {
    fail("Persistent RPC cache path uses a retired namespace");
  }
  if (path.includes("/checkpoints/") || path.includes("/cursors/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes;
  }
  if (path.includes("/segments/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes;
  }
  if (path.includes("/runtime-v2/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes;
  }
  if (path.includes("/integrity/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes;
  }
  fail("Persistent RPC cache path has no byte limit");
}

export function persistentRpcProviderId(rpcUrl: string) {
  return digest({ rpcUrl });
}

function contentLength(headers: Readonly<{ get(name: string): string | null }>) {
  const value = headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    fail("Persistent RPC Blob Content-Length is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail("Persistent RPC Blob Content-Length is unsafe");
  }
  return parsed;
}

const VERCEL_BLOB_STRONG_ETAG = /^"[0-9a-f]{32}"$/iu;

export function normalizePersistentRpcBlobEtag(value: string) {
  const normalized = value.trim();
  if (!VERCEL_BLOB_STRONG_ETAG.test(normalized)) {
    fail("Persistent RPC Blob ETag is invalid");
  }
  return normalized;
}

export function bindPrivateBlobReadMetadata(input: Readonly<{
  responseEtag: string;
  headEtag: string;
  headSize: number;
}>) {
  const responseEtag = normalizePersistentRpcBlobEtag(input.responseEtag);
  const headEtag = normalizePersistentRpcBlobEtag(input.headEtag);
  if (
    responseEtag.length < 1 ||
    headEtag.length < 1 ||
    responseEtag !== headEtag
  ) {
    fail("Persistent RPC Blob changed while it was being read");
  }
  if (!Number.isSafeInteger(input.headSize) || input.headSize < 0) {
    fail("Persistent RPC Blob HEAD size is invalid");
  }
  return {
    etag: headEtag,
    declaredSize: input.headSize,
  } as const;
}

export async function readBoundedBlobJson(input: Readonly<{
  stream: ReadableStream<Uint8Array>;
  maximumBytes: number;
  declaredSize: number;
  declaredContentLength: number | null;
}>) {
  if (
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes <= 0 ||
    !Number.isSafeInteger(input.declaredSize) ||
    input.declaredSize < 0 ||
    input.declaredSize > input.maximumBytes ||
    (input.declaredContentLength !== null &&
      (!Number.isSafeInteger(input.declaredContentLength) ||
        input.declaredContentLength < 0 ||
        input.declaredContentLength > input.maximumBytes ||
        input.declaredContentLength !== input.declaredSize))
  ) {
    await input.stream.cancel("Persistent RPC Blob declaration exceeds limit");
    fail("Persistent RPC Blob declaration exceeds or conflicts with its limit");
  }

  const reader = input.stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel("Persistent RPC Blob chunk is invalid");
        fail("Persistent RPC Blob chunk is invalid");
      }
      totalBytes += result.value.byteLength;
      if (
        totalBytes > input.maximumBytes ||
        totalBytes > input.declaredSize ||
        (input.declaredContentLength !== null &&
          totalBytes > input.declaredContentLength)
      ) {
        await reader.cancel("Persistent RPC Blob stream exceeds limit");
        fail("Persistent RPC Blob stream exceeds its declared byte limit");
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The original bounded-read failure remains authoritative.
    }
    if (error instanceof PersistentRpcCacheError) throw error;
    throw new PersistentRpcCacheError(
      "Persistent RPC Blob stream could not be read safely",
      { cause: error },
    );
  } finally {
    reader.releaseLock();
  }
  if (
    totalBytes !== input.declaredSize ||
    (input.declaredContentLength !== null &&
      totalBytes !== input.declaredContentLength)
  ) {
    fail("Persistent RPC Blob stream length does not match its declaration");
  }
  try {
    return JSON.parse(chunks.join("")) as unknown;
  } catch (error) {
    throw new PersistentRpcCacheError(
      "Persistent RPC Blob JSON is invalid",
      { cause: error },
    );
  }
}

type PersistentRpcBlobGetResult =
  | Readonly<{
      statusCode: 200;
      stream: ReadableStream<Uint8Array>;
      headers: Readonly<{ get(name: string): string | null }>;
      blob: Readonly<{ etag: string; size: number }>;
    }>
  | Readonly<{
      statusCode: 304;
      stream: null;
      headers: Readonly<{ get(name: string): string | null }>;
      blob: Readonly<{ etag: string; size: null }>;
    }>
  | null;

type PersistentRpcBlobClient = Readonly<{
  get(
    path: string,
    options: Readonly<{
      access: "private";
      token: string;
      useCache: false;
      headers: Readonly<{ "accept-encoding": "identity" }>;
    }>,
  ): Promise<PersistentRpcBlobGetResult>;
  head(
    path: string,
    options: Readonly<{ token: string }>,
  ): Promise<Readonly<{ etag: string; size: number }>>;
  put(
    path: string,
    value: string,
    options: Readonly<{
      access: "private";
      contentType: "application/json";
      addRandomSuffix: false;
      allowOverwrite: boolean;
      cacheControlMaxAge: 60;
      ifMatch?: string;
      token: string;
    }>,
  ): Promise<unknown>;
}>;

type PersistentRpcBlobClientLoader = () => Promise<PersistentRpcBlobClient>;

const PRIVATE_BLOB_READ_ATTEMPTS = 3;

async function loadPersistentRpcBlobClient(): Promise<PersistentRpcBlobClient> {
  const { get, head, put } = await import("@vercel/blob");
  return { get, head, put };
}

export function createVercelBlobPersistentRpcCacheStore(
  token: string,
  loadClient: PersistentRpcBlobClientLoader = loadPersistentRpcBlobClient,
): PersistentRpcCacheStore {
  return {
    async read(path) {
      const { get, head } = await loadClient();
      const maximumBytes = persistentRpcCachePathByteLimit(path);
      for (let attempt = 1; attempt <= PRIVATE_BLOB_READ_ATTEMPTS; attempt += 1) {
        const result = await get(path, {
          access: "private",
          token,
          useCache: false,
          headers: { "accept-encoding": "identity" },
        });
        if (!result || result.statusCode !== 200 || !result.stream) return null;
        let metadata;
        try {
          const current = await head(path, { token });
          metadata = bindPrivateBlobReadMetadata({
            responseEtag: result.blob.etag,
            headEtag: current.etag,
            headSize: current.size,
          });
        } catch (error) {
          await result.stream.cancel(
            "Persistent RPC Blob metadata could not be bound",
          );
          throw error;
        }
        try {
          return {
            etag: metadata.etag,
            value: await readBoundedBlobJson({
              stream: result.stream,
              maximumBytes,
              declaredSize: metadata.declaredSize,
              declaredContentLength: result.headers.get("content-encoding")
                ? null
                : contentLength(result.headers),
            }),
          };
        } catch (error) {
          try {
            await result.stream.cancel(
              "Persistent RPC Blob read could not be bound",
            );
          } catch {
            // The original bounded-read failure remains authoritative.
          }
          if (
            !(error instanceof PersistentRpcCacheError) ||
            attempt === PRIVATE_BLOB_READ_ATTEMPTS ||
            error.message !==
              "Persistent RPC Blob stream length does not match its declaration"
          ) {
            throw error;
          }
        }
      }
      fail("Persistent RPC Blob read retry budget was exhausted");
    },
    async create(path, value) {
      const { get, put } = await loadClient();
      try {
        await put(path, JSON.stringify(value), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          token,
        });
        return "created";
      } catch (error) {
        const existing = await get(path, {
          access: "private",
          token,
          useCache: false,
          headers: { "accept-encoding": "identity" },
        });
        if (existing?.statusCode === 200) return "exists";
        throw error;
      }
    },
    async replace(path, value, expectedEtag) {
      const { get, put } = await loadClient();
      try {
        await put(path, JSON.stringify(value), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          ifMatch: expectedEtag,
          token,
        });
        return "replaced";
      } catch (error) {
        const current = await get(path, {
          access: "private",
          token,
          useCache: false,
          headers: { "accept-encoding": "identity" },
        });
        if (
          current?.statusCode === 200 &&
          normalizePersistentRpcBlobEtag(current.blob.etag) !== expectedEtag
        ) {
          return "conflict";
        }
        throw error;
      }
    },
  };
}

export function createMemoryPersistentRpcCacheStore(): PersistentRpcCacheStore {
  const values = new Map<string, { etag: string; value: unknown }>();
  let generation = 0;
  return {
    async read(path) {
      return values.get(path) ?? null;
    },
    async create(path, value) {
      if (values.has(path)) return "exists";
      generation += 1;
      values.set(path, { etag: `memory-${generation}`, value });
      return "created";
    },
    async replace(path, value, expectedEtag) {
      const current = values.get(path);
      if (!current || current.etag !== expectedEtag) return "conflict";
      generation += 1;
      values.set(path, { etag: `memory-${generation}`, value });
      return "replaced";
    },
  };
}

export function persistentRpcHttp(
  rpcUrl: string,
  input: Readonly<{
    chainId: number;
    http?: HttpTransportConfig;
    maxLogBlockRange?: bigint;
    immutableCodeBindings?: readonly ImmutableCodeBinding[];
    store?: PersistentRpcCacheStore | null;
  }>,
): Transport {
  const underlying = http(rpcUrl, input.http);
  const providerId = persistentRpcProviderId(rpcUrl);
  return (transportInput) => {
    const transport = underlying(transportInput);
    const token = blobToken();
    return {
      ...transport,
      request: createPersistentRpcRequest({
        chainId: input.chainId,
        providerId,
        request: transport.request,
        maxLogBlockRange: input.maxLogBlockRange,
        immutableCodeBindings: input.immutableCodeBindings,
        store: input.store === undefined
          ? token
            ? createVercelBlobPersistentRpcCacheStore(token)
            : null
          : input.store,
      }),
    };
  };
}
