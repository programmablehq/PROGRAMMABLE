import { describe, expect, it, vi } from "vitest";
import {Actions,URVersion,V4Planner} from "@uniswap/v4-sdk";
import {
  CommandType,
  RoutePlanner,
  UniversalRouterVersion,
} from "@uniswap/universal-router-sdk";
import {
  encodeFunctionData,
  getAddress,
  type Address,
} from "viem";

import {
  NATIVE_ETH,
  buildClassicSwapTransaction,
  classicUniversalRouterAbi,
  createClassicPoolKey,
  type ClassicTradeDeployment,
} from "../lib/trade/classic";
import {
  UNISWAP_API_MAINNET_UNIVERSAL_ROUTER,
  UniswapApiUnavailableError,
  prepareOfficialUniswapApiTrade,
  tryPrepareOfficialUniswapApiTrade,
} from "../lib/trade/uniswap-api.server";

vi.mock("server-only", () => ({}));

const OWNER = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const HOOK = getAddress("0x2222222222222222222222222222222222222222");
const OTHER_HOOK = getAddress(
  "0x3333333333333333333333333333333333333333",
);
const POOL_MANAGER = getAddress(
  "0x000000000004444c5dc75cB358380D2e3dE08A90",
);
const API_KEY = "server-only-test-key";

const deployment: ClassicTradeDeployment = {
  chainId: 1,
  poolManager: POOL_MANAGER,
  v4Quoter: getAddress("0x4444444444444444444444444444444444444444"),
  universalRouter: UNISWAP_API_MAINNET_UNIVERSAL_ROUTER,
  universalRouterVersion: "2.0",
  permit2: getAddress(
    "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  ),
  hook: HOOK,
};

function adapterInput(
  overrides: Partial<{
    chainId: number;
    owner: Address;
    token: Address;
    hook: Address;
    side: "buy" | "sell";
    amountIn: bigint;
    slippageBps: number;
    deadline: bigint;
  }> = {},
) {
  return {
    chainId: 1,
    owner: OWNER,
    token: TOKEN,
    hook: HOOK,
    side: "buy" as const,
    amountIn: 1_000n,
    slippageBps: 100,
    deadline: 1_300n,
    ...overrides,
  };
}

function swapCalldata(overrides: {
  amountIn?: bigint;
  deadline?: bigint;
  safetyRecipient?: Address;
  includeSafetySweep?: boolean;
} = {}) {
  const amountIn=overrides.amountIn??1000n;
  const v4=new V4Planner();
  v4.addAction(Actions.SWAP_EXACT_IN_SINGLE,[{poolKey:createClassicPoolKey(TOKEN,deployment),zeroForOne:true,
    amountIn,amountOutMinimum:1980n,minHopPriceX36:0n,hookData:"0x"}],URVersion.V2_1_2);
  v4.addAction(Actions.SETTLE_ALL,[NATIVE_ETH,amountIn],URVersion.V2_1_2);
  v4.addAction(Actions.TAKE_ALL,[TOKEN,1980n],URVersion.V2_1_2);
  const planner = new RoutePlanner();
  planner.addCommand(CommandType.V4_SWAP,[v4.finalize()],false,UniversalRouterVersion.V2_1_2);
  if (overrides.includeSafetySweep !== false) {
    planner.addCommand(
      CommandType.SWEEP,
      [NATIVE_ETH, overrides.safetyRecipient ?? OWNER, 0],
      false,
      UniversalRouterVersion.V2_1_2,
    );
  }
  return encodeFunctionData({
    abi: classicUniversalRouterAbi,
    functionName: "execute",
    args: [
      planner.commands as `0x${string}`,
      planner.inputs as `0x${string}`[],
      overrides.deadline ?? 1_300n,
    ],
  });
}

function quoteResponse(
  overrides: {
    hook?: Address;
    recipient?: Address;
    permitData?: unknown;
    amountIn?: string;
    amountOut?: string;
    minimumAmount?: string;
  } = {},
) {
  return {
    requestId: "quote-request",
    routing: "CLASSIC",
    permitData: overrides.permitData ?? null,
    quote: {
      chainId: 1,
      swapper: OWNER,
      tradeType: "EXACT_INPUT",
      slippage: 1,
      input: {
        token: NATIVE_ETH,
        amount: overrides.amountIn ?? "1000",
      },
      output: {
        token: TOKEN,
        amount: overrides.amountOut ?? "2000",
        minimumAmount: overrides.minimumAmount ?? "1980",
        recipient: overrides.recipient ?? OWNER,
      },
      gasUseEstimate: "300000",
      txFailureReasons: [],
      route: [
        [
          {
            type: "v4-pool",
            address: POOL_MANAGER,
            tokenIn: {
              address: NATIVE_ETH,
              chainId: 1,
              decimals: "18",
            },
            tokenOut: {
              address: TOKEN,
              chainId: 1,
              decimals: "18",
            },
            sqrtRatioX96: "79228162514264337593543950336",
            liquidity: "1000000",
            tickCurrent: "0",
            fee: "0",
            tickSpacing: "200",
            hooks: overrides.hook ?? HOOK,
            amountIn: "1000",
            amountOut: "2000",
          },
        ],
      ],
    },
  };
}

function swapResponse(
  overrides: {
    to?: Address;
    from?: Address;
    data?: `0x${string}`;
    value?: string;
    chainId?: number;
    gasLimit?: string;
  } = {},
) {
  return {
    requestId: "swap-request",
    swap: {
      to: overrides.to ?? UNISWAP_API_MAINNET_UNIVERSAL_ROUTER,
      from: overrides.from ?? OWNER,
      data: overrides.data ?? swapCalldata(),
      value: overrides.value ?? "1000",
      chainId: overrides.chainId ?? 1,
      gasLimit: overrides.gasLimit ?? "300000",
    },
  };
}

function queuedFetch(...payloads: unknown[]) {
  const queue = [...payloads];
  return vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      const payload = queue.shift();
      if (payload === undefined) {
        throw new Error("Unexpected fetch");
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
}

describe("official Uniswap Trading API adapter", () => {
  it("prepares an allowlisted direct v4 Mainnet buy without exposing the key", async () => {
    const fetchImpl = queuedFetch(quoteResponse(), swapResponse());

    const prepared = await prepareOfficialUniswapApiTrade(
      adapterInput(),
      {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl,
        now: 1_000n,
      },
    );

    expect(prepared).toMatchObject({
      provider: "uniswap-trading-api",
      chainId: 1,
      owner: OWNER,
      token: TOKEN,
      hook: HOOK,
      side: "buy",
      quote: {
        amountIn: "1000",
        amountOut: "2000",
        amountOutMinimum: "1980",
        slippageBps: 100,
        deadline: "1300",
        requestId: "quote-request",
      },
      transaction: {
        kind: "swap",
        chainId: 1,
        to: UNISWAP_API_MAINNET_UNIVERSAL_ROUTER,
        from: OWNER,
        value: "1000",
        gasLimit: "300000",
      },
    });
    expect(JSON.stringify(prepared)).not.toContain(API_KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [quoteUrl, quoteInit] = fetchImpl.mock.calls[0];
    expect(quoteUrl).toBe(
      "https://trade-api.gateway.uniswap.org/v1/quote",
    );
    const quoteHeaders = new Headers(quoteInit?.headers);
    expect(quoteHeaders.get("x-api-key")).toBe(API_KEY);
    expect(quoteHeaders.get("x-universal-router-version")).toBe("2.1.2");
    const quoteBody = JSON.parse(String(quoteInit?.body));
    expect(quoteBody).toEqual({
      type: "EXACT_INPUT",
      amount: "1000",
      tokenInChainId: 1,
      tokenOutChainId: 1,
      tokenIn: NATIVE_ETH,
      tokenOut: TOKEN,
      swapper: OWNER,
      recipient: OWNER,
      slippageTolerance: 1,
      routingPreference: "BEST_PRICE",
      protocols: ["V4"],
      hooksOptions: "V4_HOOKS_ONLY",
      permitAmount: "EXACT",
    });
    expect(JSON.stringify(quoteBody)).not.toContain(API_KEY);

    const [swapUrl, swapInit] = fetchImpl.mock.calls[1];
    expect(swapUrl).toBe(
      "https://trade-api.gateway.uniswap.org/v1/swap",
    );
    expect(new Headers(swapInit?.headers).get("x-universal-router-version")).toBe("2.1.2");
    const swapBody = JSON.parse(String(swapInit?.body));
    expect(swapBody).toMatchObject({
      refreshGasPrice: true,
      simulateTransaction: true,
      safetyMode: "SAFE",
      deadline: 1300,
    });
    expect(swapBody.quote).toEqual(quoteResponse().quote);
    expect(JSON.stringify(swapBody)).not.toContain(API_KEY);
  });

  it("does not contact the API for missing keys, sells, or non-allowlisted hooks", async () => {
    const fetchImpl = vi.fn();
    const options = {
      apiKey: API_KEY,
      allowedHooks: [HOOK],
      fetchImpl,
      now: 1_000n,
    };

    await expect(
      tryPrepareOfficialUniswapApiTrade(adapterInput(), {
        ...options,
        apiKey: undefined,
      }),
    ).resolves.toBeNull();
    await expect(
      tryPrepareOfficialUniswapApiTrade(
        adapterInput({ side: "sell" }),
        options,
      ),
    ).resolves.toBeNull();
    await expect(
      tryPrepareOfficialUniswapApiTrade(
        adapterInput({ hook: OTHER_HOOK }),
        options,
      ),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a retired 2.0 router target",
      quote: quoteResponse(),
      swap: swapResponse({to:getAddress("0x66a9893cc07d91d95644aedd05d03f95e1dba8af")}),
    },
    {
      name: "old 2.0 calldata at the new router",
      quote: quoteResponse(),
      swap: swapResponse({data:buildClassicSwapTransaction({deployment,poolKey:createClassicPoolKey(TOKEN,deployment),side:"buy",amountIn:1000n,
        quotedAmountOut:2000n,slippageBps:100,now:1000n,deadline:1300n}).data}),
    },
    {
      name: "a route through another hook",
      quote: quoteResponse({ hook: OTHER_HOOK }),
      swap: swapResponse(),
    },
    {
      name: "an output recipient other than the swapper",
      quote: quoteResponse({ recipient: OTHER_HOOK }),
      swap: swapResponse(),
    },
    {
      name: "a Universal Router target other than the canonical target",
      quote: quoteResponse(),
      swap: swapResponse({ to: OTHER_HOOK }),
    },
    {
      name: "a transaction value above the exact ETH input",
      quote: quoteResponse(),
      swap: swapResponse({ value: "1001" }),
    },
    {
      name: "calldata with a different exact input amount",
      quote: quoteResponse(),
      swap: swapResponse({ data: swapCalldata({ amountIn: 999n }) }),
    },
    {
      name: "calldata with a different deadline",
      quote: quoteResponse(),
      swap: swapResponse({ data: swapCalldata({ deadline: 1_301n }) }),
    },
    {
      name: "calldata with a different safety recipient",
      quote: quoteResponse(),
      swap: swapResponse({
        data: swapCalldata({ safetyRecipient: OTHER_HOOK }),
      }),
    },
    {
      name: "calldata without the requested safe native sweep",
      quote: quoteResponse(),
      swap: swapResponse({
        data: swapCalldata({ includeSafetySweep: false }),
      }),
    },
  ])("rejects $name", async ({ quote, swap }) => {
    await expect(
      prepareOfficialUniswapApiTrade(adapterInput(), {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl: queuedFetch(quote, swap),
        now: 1_000n,
      }),
    ).rejects.toBeInstanceOf(UniswapApiUnavailableError);
  });

  it("falls back without exposing an upstream error body or API key", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: `upstream included ${API_KEY}`,
        }),
        { status: 500 },
      );
    });

    await expect(
      tryPrepareOfficialUniswapApiTrade(adapterInput(), {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl,
        now: 1_000n,
      }),
    ).resolves.toBeNull();

    try {
      await prepareOfficialUniswapApiTrade(adapterInput(), {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl,
        now: 1_000n,
      });
      throw new Error("Expected the adapter to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(UniswapApiUnavailableError);
      expect(String(error)).not.toContain(API_KEY);
      expect(String(error)).not.toContain("upstream included");
    }
  });

  it("rejects a JSON-looking response with a non-JSON content type", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(quoteResponse()), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    await expect(
      prepareOfficialUniswapApiTrade(adapterInput(), {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl,
        now: 1_000n,
      }),
    ).rejects.toBeInstanceOf(UniswapApiUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops reading a streamed response as soon as the byte cap is exceeded", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(128 * 1024);
    const fetchImpl = vi.fn(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            controller.enqueue(chunk);
            if (pulls === 12) controller.close();
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await expect(
      prepareOfficialUniswapApiTrade(adapterInput(), {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl,
        now: 1_000n,
      }),
    ).rejects.toBeInstanceOf(UniswapApiUnavailableError);
    expect(pulls).toBeLessThan(12);
  });

  it("aborts a stalled request and returns control to the direct-route fallback", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    await expect(
      tryPrepareOfficialUniswapApiTrade(adapterInput(), {
        apiKey: API_KEY,
        allowedHooks: [HOOK],
        fetchImpl,
        now: 1_000n,
        timeoutMs: 10,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
