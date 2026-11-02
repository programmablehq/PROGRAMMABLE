import "server-only";

import {
  CommandParser,
  UniversalRouterVersion,
} from "@uniswap/universal-router-sdk";
import {
  decodeFunctionData,
  getAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  CLASSIC_TICK_SPACING,
  NATIVE_ETH,
  assertClassicDeadline,
  classicUniversalRouterAbi,
  type ClassicTradeSide,
} from "./classic";
import { MAX_TRADE_SLIPPAGE_BPS } from "./policy";
import {UNISWAP_TRADING_API_ROUTER_VERSION,UNISWAP_HOSTED_MAINNET_ROUTER} from "../uniswap/trading-api-router";

const QUOTE_URL =
  "https://trade-api.gateway.uniswap.org/v1/quote";
const SWAP_URL =
  "https://trade-api.gateway.uniswap.org/v1/swap";
const UNIVERSAL_ROUTER_VERSION = UNISWAP_TRADING_API_ROUTER_VERSION;
const UINT128_MAX = (1n << 128n) - 1n;
const MAX_GAS_LIMIT = 30_000_000n;
const MAX_CALLDATA_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const SENDER_AS_RECIPIENT =
  "0x0000000000000000000000000000000000000001" as Address;
const ROUTER_AS_RECIPIENT =
  "0x0000000000000000000000000000000000000002" as Address;

/**
 * Universal Router v2.1.2 currently listed for Ethereum by the official
 * Trading API supported-chains table and selected explicitly on every API
 * request. This is intentionally separate from Programmable's direct-route
 * deployment snapshot, which uses the registry's standard router.
 */
export const UNISWAP_API_MAINNET_UNIVERSAL_ROUTER = getAddress(
  UNISWAP_HOSTED_MAINNET_ROUTER,
);

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OfficialUniswapApiTradeInput = {
  chainId: number;
  owner: Address;
  token: Address;
  hook: Address;
  side: ClassicTradeSide;
  amountIn: bigint;
  slippageBps: number;
  deadline: bigint;
};

export type OfficialUniswapApiTradeOptions = {
  /**
   * Supply this only from server configuration. It is sent only in the
   * x-api-key header and is never included in the returned trade payload.
   */
  apiKey?: string;
  allowedHooks: readonly Address[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: bigint;
};

export type PreparedOfficialUniswapApiTrade = {
  provider: "uniswap-trading-api";
  chainId: 1;
  owner: Address;
  token: Address;
  hook: Address;
  side: "buy";
  quote: {
    requestId: string;
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    slippageBps: number;
    deadline: string;
  };
  transaction: {
    kind: "swap";
    chainId: 1;
    to: Address;
    from: Address;
    data: Hex;
    value: string;
    gasLimit: string;
  };
};

export class UniswapApiUnavailableError extends Error {
  constructor() {
    super("The official Uniswap route is unavailable");
    this.name = "UniswapApiUnavailableError";
  }
}

function unavailable(): never {
  throw new UniswapApiUnavailableError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function responseAddress(value: unknown): Address {
  if (typeof value !== "string") unavailable();
  try {
    return getAddress(value);
  } catch {
    unavailable();
  }
}

function positiveInteger(
  value: unknown,
  maximum = UINT128_MAX,
): bigint {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^[1-9]\d*$/.test(value)
  ) {
    unavailable();
  }
  const parsed = BigInt(value);
  if (parsed > maximum) unavailable();
  return parsed;
}

function unsignedInteger(
  value: unknown,
  maximum = UINT128_MAX,
): bigint {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^\d+$/.test(value)
  ) {
    unavailable();
  }
  const parsed = BigInt(value);
  if (parsed > maximum) unavailable();
  return parsed;
}

function parsedInteger(value: unknown, maximum = UINT128_MAX): bigint {
  if (
    typeof value === "bigint" ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0)
  ) {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > maximum) unavailable();
    return parsed;
  }
  if (
    typeof value === "string" ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as { toString?: unknown }).toString === "function")
  ) {
    const rendered = String(value);
    if (!/^\d+$/.test(rendered) || rendered.length > 78) unavailable();
    const parsed = BigInt(rendered);
    if (parsed > maximum) unavailable();
    return parsed;
  }
  unavailable();
}

function requestAddress(value: Address): Address {
  try {
    const address = getAddress(value);
    if (sameAddress(address, NATIVE_ETH)) unavailable();
    return address;
  } catch {
    unavailable();
  }
}

function validApiKey(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function allowedHook(
  hook: Address,
  allowlist: readonly Address[],
) {
  return allowlist.some((candidate) => {
    try {
      return sameAddress(getAddress(candidate), hook);
    } catch {
      return false;
    }
  });
}

function timeoutMs(value: number | undefined) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_TIMEOUT_MS
  ) {
    unavailable();
  }
  return value;
}

async function readBoundedJsonResponse(
  response: Response,
  maximumBytes: number,
) {
  const contentType = response.headers.get("content-type");
  if (
    contentType === null ||
    !/^application\/json(?:\s*;|$)/i.test(contentType)
  ) {
    unavailable();
  }
  if (!response.body) unavailable();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        unavailable();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  return JSON.parse(text) as unknown;
}

function eligible(
  input: OfficialUniswapApiTradeInput,
  options: OfficialUniswapApiTradeOptions,
) {
  if (
    typeof window !== "undefined" ||
    input.chainId !== 1 ||
    input.side !== "buy" ||
    !validApiKey(options.apiKey)
  ) {
    return false;
  }
  try {
    const hook = requestAddress(input.hook);
    requestAddress(input.owner);
    requestAddress(input.token);
    return allowedHook(hook, options.allowedHooks);
  } catch {
    return false;
  }
}

async function fetchJson(
  url: string,
  body: unknown,
  options: {
    apiKey: string;
    fetchImpl: FetchLike;
    timeoutMs: number;
  },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-key": options.apiKey,
        "x-universal-router-version": UNIVERSAL_ROUTER_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) unavailable();
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      (!/^\d+$/.test(declaredLength) ||
        Number(declaredLength) > MAX_RESPONSE_BYTES)
    ) {
      unavailable();
    }

    return await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES);
  } catch {
    unavailable();
  } finally {
    clearTimeout(timer);
  }
}

function requiredRequestId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256
  ) {
    unavailable();
  }
  return value;
}

function assertRouteToken(
  value: unknown,
  expected: Address,
) {
  if (!isRecord(value) || value.chainId !== 1) unavailable();
  if (!sameAddress(responseAddress(value.address), expected)) {
    unavailable();
  }
}

function numericPoolField(value: unknown) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^-?\d+$/.test(String(value))
  ) {
    unavailable();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) unavailable();
  return parsed;
}

function validateDirectV4Route(
  value: unknown,
  input: {
    tokenIn: Address;
    tokenOut: Address;
    hook: Address;
    amountIn: bigint;
    amountOut: bigint;
  },
) {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !Array.isArray(value[0]) ||
    value[0].length !== 1
  ) {
    unavailable();
  }
  const pool = value[0][0];
  if (
    !isRecord(pool) ||
    pool.type !== "v4-pool" ||
    numericPoolField(pool.fee) !== 0 ||
    numericPoolField(pool.tickSpacing) !== CLASSIC_TICK_SPACING ||
    !sameAddress(responseAddress(pool.hooks), input.hook)
  ) {
    unavailable();
  }
  responseAddress(pool.address);
  assertRouteToken(pool.tokenIn, input.tokenIn);
  assertRouteToken(pool.tokenOut, input.tokenOut);
  if (
    pool.amountIn !== undefined &&
    positiveInteger(pool.amountIn) !== input.amountIn
  ) {
    unavailable();
  }
  if (
    pool.amountOut !== undefined &&
    positiveInteger(pool.amountOut) !== input.amountOut
  ) {
    unavailable();
  }
}

function validateQuote(
  value: unknown,
  input: {
    owner: Address;
    token: Address;
    hook: Address;
    amountIn: bigint;
    slippageBps: number;
  },
) {
  if (
    !isRecord(value) ||
    value.routing !== "CLASSIC" ||
    value.permitData !== null ||
    !isRecord(value.quote)
  ) {
    unavailable();
  }
  const requestId = requiredRequestId(value.requestId);
  const quote = value.quote;
  if (
    quote.chainId !== 1 ||
    quote.tradeType !== "EXACT_INPUT" ||
    !sameAddress(responseAddress(quote.swapper), input.owner) ||
    !isRecord(quote.input) ||
    !isRecord(quote.output)
  ) {
    unavailable();
  }
  if (
    !sameAddress(responseAddress(quote.input.token), NATIVE_ETH) ||
    positiveInteger(quote.input.amount) !== input.amountIn ||
    !sameAddress(responseAddress(quote.output.token), input.token) ||
    !sameAddress(responseAddress(quote.output.recipient), input.owner)
  ) {
    unavailable();
  }
  const amountOut = positiveInteger(quote.output.amount);
  const amountOutMinimum = positiveInteger(
    quote.output.minimumAmount,
  );
  const localMinimum =
    (amountOut * BigInt(10_000 - input.slippageBps)) / 10_000n;
  if (
    amountOutMinimum > amountOut ||
    amountOutMinimum < localMinimum
  ) {
    unavailable();
  }
  if (
    quote.slippage !== undefined &&
    (typeof quote.slippage !== "number" ||
      !Number.isFinite(quote.slippage) ||
      Math.abs(quote.slippage - input.slippageBps / 100) >
        Number.EPSILON)
  ) {
    unavailable();
  }
  if (
    quote.txFailureReasons !== undefined &&
    (!Array.isArray(quote.txFailureReasons) ||
      quote.txFailureReasons.length !== 0)
  ) {
    unavailable();
  }
  if (
    quote.priceImpact !== undefined &&
    (typeof quote.priceImpact !== "number" ||
      !Number.isFinite(quote.priceImpact) ||
      quote.priceImpact < 0 ||
      quote.priceImpact > 100)
  ) {
    unavailable();
  }
  if (
    quote.portionBips !== undefined &&
    Number(quote.portionBips) !== 0
  ) {
    unavailable();
  }
  if (
    quote.portionAmount !== undefined &&
    unsignedInteger(quote.portionAmount) !== 0n
  ) {
    unavailable();
  }
  validateDirectV4Route(quote.route, {
    tokenIn: NATIVE_ETH,
    tokenOut: input.token,
    hook: input.hook,
    amountIn: input.amountIn,
    amountOut,
  });

  return {
    requestId,
    quote,
    amountOut,
    amountOutMinimum,
  };
}

type ParsedParam = {
  name: string;
  value: unknown;
};

function actionParams(value: unknown): readonly ParsedParam[] {
  if (!Array.isArray(value)) unavailable();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      !("value" in entry)
    ) {
      unavailable();
    }
  }
  return value as ParsedParam[];
}

function param(params: readonly ParsedParam[], name: string) {
  const matching = params.filter((entry) => entry.name === name);
  if (matching.length !== 1) unavailable();
  return matching[0].value;
}

function safeRecipient(value: unknown, owner: Address) {
  const recipient = responseAddress(value);
  if (
    !sameAddress(recipient, owner) &&
    !sameAddress(recipient, SENDER_AS_RECIPIENT)
  ) {
    unavailable();
  }
  return recipient;
}

function assertParsedPoolKey(
  value: unknown,
  input: { token: Address; hook: Address },
) {
  if (!isRecord(value)) unavailable();
  if (
    !sameAddress(responseAddress(value.currency0), NATIVE_ETH) ||
    !sameAddress(responseAddress(value.currency1), input.token) ||
    numericPoolField(value.fee) !== 0 ||
    numericPoolField(value.tickSpacing) !== CLASSIC_TICK_SPACING ||
    !sameAddress(responseAddress(value.hooks), input.hook)
  ) {
    unavailable();
  }
}

function validateUniversalRouterCalldata(
  data: Hex,
  input: {
    owner: Address;
    token: Address;
    hook: Address;
    amountIn: bigint;
    amountOut: bigint;
    amountOutMinimum: bigint;
    deadline: bigint;
  },
) {
  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({
      abi: classicUniversalRouterAbi,
      data,
    });
  } catch {
    unavailable();
  }
  if (
    decoded.functionName !== "execute" ||
    decoded.args.length !== 3 ||
    decoded.args[2] !== input.deadline
  ) {
    unavailable();
  }

  let commands: ReturnType<typeof CommandParser.parseCalldata>["commands"];
  try {
    commands = CommandParser.parseCalldata(
      data,
      UniversalRouterVersion.V2_1_2,
    ).commands;
  } catch {
    unavailable();
  }
  if (
    commands.length < 1 ||
    commands.length > 3 ||
    commands[0].commandName !== "V4_SWAP" ||
    commands.filter(({ commandName }) => commandName === "V4_SWAP")
      .length !== 1 ||
    commands.some(
      ({ commandName }) =>
        commandName !== "V4_SWAP" && commandName !== "SWEEP",
    )
  ) {
    unavailable();
  }

  let topLevelOutputMinimum = 0n;
  let outputSweepCount = 0;
  let nativeSweepCount = 0;
  for (const command of commands.slice(1)) {
    const token = responseAddress(param(command.params, "token"));
    const recipient = safeRecipient(
      param(command.params, "recipient"),
      input.owner,
    );
    void recipient;
    const amountMinimum = parsedInteger(
      param(command.params, "amountMin"),
    );
    if (sameAddress(token, input.token)) {
      outputSweepCount += 1;
      topLevelOutputMinimum = amountMinimum;
    } else if (sameAddress(token, NATIVE_ETH)) {
      nativeSweepCount += 1;
      if (amountMinimum !== 0n) unavailable();
    } else {
      unavailable();
    }
  }
  if (outputSweepCount > 1 || nativeSweepCount !== 1) unavailable();

  const actions = commands[0].params;
  if (actions.length !== 3) unavailable();
  const swapAction = actions[0];
  const settleAction = actions[1];
  const takeAction = actions[2];
  if (
    swapAction.name !== "SWAP_EXACT_IN_SINGLE" ||
    (settleAction.name !== "SETTLE" &&
      settleAction.name !== "SETTLE_ALL") ||
    (takeAction.name !== "TAKE" &&
      takeAction.name !== "TAKE_ALL")
  ) {
    unavailable();
  }

  const swapParams = actionParams(swapAction.value);
  const swap = param(swapParams, "swap");
  if (!isRecord(swap)) unavailable();
  assertParsedPoolKey(swap.poolKey, input);
  // This field is present in the 2.1.x ABI. Decode it explicitly so a 2.0
  // parser cannot silently discard the per-hop price constraint.
  parsedInteger(swap.minHopPriceX36,(1n<<256n)-1n);
  if (
    swap.zeroForOne !== true ||
    parsedInteger(swap.amountIn) !== input.amountIn ||
    !isHex(swap.hookData) ||
    swap.hookData !== "0x"
  ) {
    unavailable();
  }
  const swapMinimum = parsedInteger(swap.amountOutMinimum);
  if (swapMinimum > input.amountOut) unavailable();

  const settleParams = actionParams(settleAction.value);
  if (
    !sameAddress(
      responseAddress(param(settleParams, "currency")),
      NATIVE_ETH,
    )
  ) {
    unavailable();
  }
  if (settleAction.name === "SETTLE_ALL") {
    if (
      parsedInteger(param(settleParams, "maxAmount")) !==
      input.amountIn
    ) {
      unavailable();
    }
  } else if (
    parsedInteger(param(settleParams, "amount")) !== input.amountIn ||
    param(settleParams, "payerIsUser") !== false
  ) {
    unavailable();
  }

  const takeParams = actionParams(takeAction.value);
  if (
    !sameAddress(
      responseAddress(param(takeParams, "currency")),
      input.token,
    )
  ) {
    unavailable();
  }
  let takeMinimum = 0n;
  if (takeAction.name === "TAKE_ALL") {
    takeMinimum = parsedInteger(param(takeParams, "minAmount"));
  } else {
    const recipient = responseAddress(
      param(takeParams, "recipient"),
    );
    if (
      !sameAddress(recipient, ROUTER_AS_RECIPIENT) &&
      !sameAddress(recipient, input.owner) &&
      !sameAddress(recipient, SENDER_AS_RECIPIENT)
    ) {
      unavailable();
    }
    const amount = parsedInteger(param(takeParams, "amount"));
    if (amount > input.amountOut || outputSweepCount !== 1) {
      unavailable();
    }
  }

  const enforcedMinimum = [swapMinimum, takeMinimum, topLevelOutputMinimum]
    .reduce((highest, candidate) =>
      candidate > highest ? candidate : highest,
    );
  if (
    enforcedMinimum < input.amountOutMinimum ||
    enforcedMinimum > input.amountOut
  ) {
    unavailable();
  }
}

function validateSwap(
  value: unknown,
  input: {
    owner: Address;
    token: Address;
    hook: Address;
    amountIn: bigint;
    amountOut: bigint;
    amountOutMinimum: bigint;
    deadline: bigint;
  },
) {
  if (!isRecord(value) || !isRecord(value.swap)) unavailable();
  requiredRequestId(value.requestId);
  const swap = value.swap;
  const to = responseAddress(swap.to);
  const from = responseAddress(swap.from);
  if (
    !sameAddress(to, UNISWAP_API_MAINNET_UNIVERSAL_ROUTER) ||
    !sameAddress(from, input.owner) ||
    swap.chainId !== 1 ||
    typeof swap.data !== "string" ||
    !isHex(swap.data) ||
    swap.data === "0x" ||
    (swap.data.length - 2) % 2 !== 0 ||
    (swap.data.length - 2) / 2 > MAX_CALLDATA_BYTES
  ) {
    unavailable();
  }
  const valueWei = unsignedInteger(swap.value);
  if (valueWei !== input.amountIn) unavailable();
  const gasLimit = positiveInteger(swap.gasLimit, MAX_GAS_LIMIT);
  validateUniversalRouterCalldata(swap.data, input);

  return {
    kind: "swap" as const,
    chainId: 1 as const,
    to,
    from,
    data: swap.data,
    value: valueWei.toString(),
    gasLimit: gasLimit.toString(),
  };
}

export async function prepareOfficialUniswapApiTrade(
  rawInput: OfficialUniswapApiTradeInput,
  options: OfficialUniswapApiTradeOptions,
): Promise<PreparedOfficialUniswapApiTrade> {
  if (!eligible(rawInput, options) || !validApiKey(options.apiKey)) {
    unavailable();
  }

  const owner = requestAddress(rawInput.owner);
  const token = requestAddress(rawInput.token);
  const hook = requestAddress(rawInput.hook);
  if (
    rawInput.amountIn <= 0n ||
    rawInput.amountIn > UINT128_MAX ||
    !Number.isInteger(rawInput.slippageBps) ||
    rawInput.slippageBps < 1 ||
    rawInput.slippageBps > MAX_TRADE_SLIPPAGE_BPS
  ) {
    unavailable();
  }
  const now =
    options.now ?? BigInt(Math.floor(Date.now() / 1_000));
  try {
    assertClassicDeadline(now, rawInput.deadline);
  } catch {
    unavailable();
  }
  if (
    rawInput.deadline <= 0n ||
    rawInput.deadline > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    unavailable();
  }

  const fetchOptions = {
    apiKey: options.apiKey,
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: timeoutMs(options.timeoutMs),
  };
  const quoteResponse = await fetchJson(
    QUOTE_URL,
    {
      type: "EXACT_INPUT",
      amount: rawInput.amountIn.toString(),
      tokenInChainId: 1,
      tokenOutChainId: 1,
      tokenIn: NATIVE_ETH,
      tokenOut: token,
      swapper: owner,
      recipient: owner,
      slippageTolerance: rawInput.slippageBps / 100,
      routingPreference: "BEST_PRICE",
      protocols: ["V4"],
      hooksOptions: "V4_HOOKS_ONLY",
      permitAmount: "EXACT",
    },
    fetchOptions,
  );
  const quote = validateQuote(quoteResponse, {
    owner,
    token,
    hook,
    amountIn: rawInput.amountIn,
    slippageBps: rawInput.slippageBps,
  });
  const swapResponse = await fetchJson(
    SWAP_URL,
    {
      quote: quote.quote,
      refreshGasPrice: true,
      simulateTransaction: true,
      safetyMode: "SAFE",
      deadline: Number(rawInput.deadline),
    },
    fetchOptions,
  );
  const transaction = validateSwap(swapResponse, {
    owner,
    token,
    hook,
    amountIn: rawInput.amountIn,
    amountOut: quote.amountOut,
    amountOutMinimum: quote.amountOutMinimum,
    deadline: rawInput.deadline,
  });

  return {
    provider: "uniswap-trading-api",
    chainId: 1,
    owner,
    token,
    hook,
    side: "buy",
    quote: {
      requestId: quote.requestId,
      amountIn: rawInput.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      amountOutMinimum: quote.amountOutMinimum.toString(),
      slippageBps: rawInput.slippageBps,
      deadline: rawInput.deadline.toString(),
    },
    transaction,
  };
}

/**
 * Optional adapter boundary. A null result means callers must keep using the
 * existing code-hash-pinned direct v4 route. No API response is trusted enough
 * to bypass validation and no API error is surfaced with provider details.
 */
export async function tryPrepareOfficialUniswapApiTrade(
  input: OfficialUniswapApiTradeInput,
  options: OfficialUniswapApiTradeOptions,
): Promise<PreparedOfficialUniswapApiTrade | null> {
  if (!eligible(input, options)) return null;
  try {
    return await prepareOfficialUniswapApiTrade(input, options);
  } catch {
    return null;
  }
}
