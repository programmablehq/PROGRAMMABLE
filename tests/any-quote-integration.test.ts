import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, erc20Abi, getAddress, getCreate2Address, keccak256, parseAbi, parseAbiParameters, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { fixture, ACCOUNT, CODE, CODE_HASH, QUOTE, TOKEN, addr, hash } from "./module-engine-fixture";
import { moduleEngineReleaseIdentity, computeModuleEngineReleaseDigest, computeModuleEngineHostManifestHash, ENGINE_ZERO_ADDRESS as ZERO, type ModuleEngineAnyQuoteReleaseIdentity } from "@/lib/module-engine/catalog";
import { MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_SOURCE_ID, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_PROFILE_ID, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { ANY_QUOTE_CONFIGURATION_ABI, createAnyQuoteConfigurationSchema } from "@/lib/module-engine/any-quote-configuration";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID, ANY_QUOTE_WETH, type AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";
import { anyQuoteEvidenceHashV1, anyQuoteModulePoolKeyV1, anyQuotePoolIdV1, buildAnyQuoteSwapV1 } from "@/lib/module-engine/any-quote/route";
import { planAnyQuoteInitialPriceV1, encodeAnyQuoteConfigurationV1 } from "@/lib/module-engine/any-quote/price";
import { anyQuoteLaunchIntent, anyQuoteMinimumOutput, anyQuotePoolFor, assertAnyQuoteConfiguration, assertAnyQuoteLaunchPreparation, predictAnyQuoteToken, anyQuoteLaunchExecutionDeadline, buildAnyQuoteInitialBuy, type AnyQuoteLaunchPreparation, type AnyQuoteTradeQuote } from "@/lib/module-engine/any-quote/integration";
import { compileModuleEngineLaunch, predictModuleEngineAddress } from "@/lib/module-engine/operation-plan";
import { prepareModuleEngineLaunch, prepareModuleEngineSourceLaunchV1, prepareModuleEngineAnyQuoteSwap, prepareModuleEngineAnyQuoteApproval, prepareModuleEngineApproval, prepareModuleEngineClaim, readModuleEngineLaunch, readModuleEngineAdministration, readModuleEngineFeeControls, prepareModuleEngineFeeChange, revalidateModuleEngineTransaction, releaseModuleEnginePreparation, verifyModuleEngineLaunchReceipt, verifyModuleEngineClaimReceipt } from "@/lib/module-engine/client";
import { assertModuleEngineOperationAvailability, fetchModuleEngineAvailability } from "@/lib/module-engine/availability-client";
import { ENGINE_CONTEXT, moduleEngineAnyQuoteHookAbi, moduleEngineAnyQuoteLedgerAbi, moduleEngineHostAbi, moduleEngineLaunchParameters, moduleEnginePlanParameters } from "@/lib/module-engine/abi";
import { readAnyQuoteLaunchPreview, readAnyQuoteReadiness, readAnyQuoteTradeQuote } from "@/lib/server/module-engine/any-quote";
import { readAnyQuoteIdentityLaunchPreviewV1 } from "@/lib/server/module-engine/any-quote-preparation";
import { assertAnyQuoteLifecycleIdentityV1, prepareAnyQuoteLifecycleApprovalV1, prepareAnyQuoteLifecycleClaimV1, prepareAnyQuoteLifecycleLaunchV1, prepareAnyQuoteLifecycleSwapV1,
  revalidateAnyQuoteLifecyclePreparationV1, verifyAnyQuoteLifecycleReceiptV1, type AnyQuoteLifecyclePreparationV1 } from "@/lib/module-engine/any-quote/lifecycle";
import { anyQuoteJsonRequest } from "@/lib/server/module-engine/any-quote-http";
import { settlementRpcFixture } from "./any-quote-settlement-fixture";
import { anyQuoteUiFixture } from "./module-engine-any-quote-ui-fixture";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
// Load the actual native Node operator adapter at the same runtime boundary as its CLI.
const { anyQuoteWalletStep } = createRequire(import.meta.url)("../contracts/scripts/module-engine/operation-rpc.mjs") as {
  anyQuoteWalletStep(plan: unknown, stepIndex: number, preparation: unknown): { to: Address; data: Hex; value: string };
};
const { publicationWalletRequest } = createRequire(import.meta.url)("../contracts/scripts/module-mode/publication-rpc.mjs") as {
  publicationWalletRequest(plan: unknown, observation: unknown, ceilings: unknown): { to: Address; data: Hex; value: Hex; nonce: Hex };
};

vi.mock("server-only", () => ({}));

vi.mock("@/lib/module-engine/any-quote/types", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/module-engine/any-quote/types")>();
  return { ...actual, ANY_QUOTE_INFRASTRUCTURE: { ...actual.ANY_QUOTE_INFRASTRUCTURE,
    poolManagerCodeHash: keccak256("0x60006000"), universalRouterCodeHash: keccak256("0x60006000"), v4QuoterCodeHash: keccak256("0x60006000") } };
});

const registrationAbi = parseAbi(["event QuoteLaunchRegistered(bytes32 indexed launchId,address indexed asset,bytes32 configurationHash,address[] creatorWallets,uint16[] creatorSharesBps)"]);
function sharedFixture() {
  const f = fixture();
  const identity: ModuleEngineAnyQuoteReleaseIdentity = { ...moduleEngineReleaseIdentity(f.release), sourceVersion: MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION,
    engineProfile: MODULE_ENGINE_ANY_QUOTE_PROFILE, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID,
    contracts: { ...f.release.contracts, poolManager: { address: ANY_QUOTE_INFRASTRUCTURE.poolManager.toLowerCase() as Hex, runtimeCodeHash: CODE_HASH },
      sharedHook: { address: addr(901), runtimeCodeHash: CODE_HASH }, universalRouter: { address: ANY_QUOTE_INFRASTRUCTURE.universalRouter.toLowerCase() as Hex, runtimeCodeHash: CODE_HASH }, nativeRouteGuard: { address: addr(903), runtimeCodeHash: CODE_HASH } } };
  identity.releaseDigest = computeModuleEngineReleaseDigest(identity);
  const release = { ...f.release, ...identity };
  Object.assign(f.release, release);
  const m = f.template.manifest.manifest;
  m.release = identity; m.catalogDefinition = { ...m.catalogDefinition, interface: "quote-shared-v1", configurationAbi: ANY_QUOTE_CONFIGURATION_ABI, schema: createAnyQuoteConfigurationSchema(identity), defaults: {} };
  f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
  let platformWallet = addr(99);
  // Exact AnyQuoteLedgerV1.registerLaunch ABI; this commitment is independent of Host config bytes.
  const ledgerConfigurationHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,address,bytes32,address,address[],uint16[]"),
    [release.economicsPolicyId, 4663n, release.contracts.ledger.address, identity.contracts.poolManager.address, identity.contracts.sharedHook.address, f.host, f.launch.launchId, QUOTE, [ACCOUNT], [10_000]]));
  const feeState = { configurationHash: ledgerConfigurationHash, creatorWallets: [ACCOUNT] };
  const registration = { address: release.contracts.ledger.address, blockNumber: 100n, blockHash: f.blockHash, transactionHash: hash(199), transactionIndex: 0, logIndex: 0, removed: false,
    topics: encodeEventTopics({ abi: registrationAbi, eventName: "QuoteLaunchRegistered", args: { launchId: f.launch.launchId, asset: QUOTE } }),
    data: encodeAbiParameters(parseAbiParameters("bytes32,address[],uint16[]"), [ledgerConfigurationHash, [ACCOUNT], [10_000]]) };
  f.client.getLogs = vi.fn(async input => {
    expect(input).toMatchObject({ address: release.contracts.ledger.address, args: { launchId: f.launch.launchId, asset: QUOTE }, fromBlock: 1n, strict: true });
    expect(input.toBlock).toBeGreaterThanOrEqual(100n);
    return [registration];
  }) as NonNullable<typeof f.client.getLogs>;
  const originalRead = vi.mocked(f.client.readContract).getMockImplementation()!;
  vi.mocked(f.client.readContract).mockImplementation(async input => {
    const fn = input.functionName;
    if (fn === "SOURCE_VERSION") return MODULE_ENGINE_ANY_QUOTE_SOURCE_ID;
    if (fn === "ECONOMICS_POLICY_ID") return MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID;
    if (fn === "quoteFeeProfileId") return MODULE_ENGINE_ANY_QUOTE_PROFILE_ID;
    if (fn === "sharedHook" || fn === "hook") return identity.contracts.sharedHook.address;
    if (fn === "host") return release.contracts.host.address;
    if (fn === "ledger") return release.contracts.ledger.address;
    if (fn === "poolManager" || fn === "quotePoolManager") return identity.contracts.poolManager.address;
    if (fn === "quotePoolManagerCodeHash") return CODE_HASH;
    if (fn === "nativeRouteGuard") return identity.contracts.nativeRouteGuard.address;
    if (fn === "NATIVE_ROUTE_GUARD_CODE_HASH") return CODE_HASH;
    if (fn === "UNIVERSAL_ROUTER") return identity.contracts.universalRouter.address;
    if (fn === "UNIVERSAL_ROUTER_CODE_HASH") return CODE_HASH;
    if (fn === "PROTOCOL_FEE_BPS" || fn === "AUTHOR_POOL_FEE_BPS" || fn === "feeTerms" || fn === "claimable") throw new Error("Native fee ABI used for quote asset");
    if (fn === "platformFeeBps") return 30;
    if (fn === "quoteAsset") return QUOTE;
    if (fn === "decimals" && input.address?.toLowerCase() === QUOTE.toLowerCase()) return 36;
    if (fn === "configurationHash") return feeState.configurationHash;
    if (fn === "creatorRecipients") return [feeState.creatorWallets, [10_000], 0n];
    if (fn === "poolIdOf" || fn === "poolId") return hash(801);
    if (fn === "claimableQuote" || fn === "claimedBy") { expect(input.args).toEqual([QUOTE, ACCOUNT]); return fn === "claimableQuote" ? f.state.claimable : f.state.claimed; }
    if (fn === "contributionByLaunch") return 2n;
    if (fn === "treasury") return platformWallet;
    if (fn === "contextHash") return keccak256(encodeAbiParameters(parseAbiParameters(ENGINE_CONTEXT), [{ host: f.host, launchId: f.launch.launchId, token: TOKEN, creator: ACCOUNT, quoteAsset: QUOTE, feeCollector: release.contracts.ledger.address }]));
    return originalRead(input);
  });
  vi.mocked(f.client.call).mockImplementation(async ({ data }) => {
    const decoded = decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: data! });
    if (decoded.functionName === "claimQuoteTo") return { data: encodeFunctionResult({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "claimQuoteTo", result: f.state.claimable }) };
    if (decoded.functionName === "changePlatformWallet") return { data: "0x" };
    throw new Error("Unexpected quote simulation");
  });
  const intent = anyQuoteLaunchIntent({ ...f.launchInput, releaseDigest: release.releaseDigest, initialBuyWei: "0", slippageBps: 100 });
  const token = predictAnyQuoteToken(intent, identity), now = f.state.timestamp, expiry = (now + 120n).toString();
  const price = planAnyQuoteInitialPriceV1({ token, quoteAsset: QUOTE, quoteDecimals: 36, quoteUsd: { numerator: "2", denominator: "1" } });
  const externalKey = { currency0: ANY_QUOTE_NATIVE, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
  const externalRoute = { provider: "uniswap-v4-initialize", chainId: 4663, tokenIn: ANY_QUOTE_WETH, tokenOut: QUOTE, amountIn: "1000", amountOut: "3000", validUntil: expiry,
    checkpoint: { number: "100", hash: f.blockHash, timestamp: now.toString() }, evidenceHash: hash(821),
    hops: [{ protocol: "V4", tokenIn: ANY_QUOTE_NATIVE, tokenOut: QUOTE, poolId: anyQuotePoolIdV1(externalKey), key: externalKey, hookData: "0x" }] } as const;
  const readiness = { status: "compatible", chainId: 4663, quoteAsset: QUOTE, token: { name: "Quote", symbol: "Q", decimals: 36 }, checkpoint: { number: "100", hash: f.blockHash, timestamp: now.toString() },
    price: { usd: price.quoteUsd, source: "chainlink", observedAt: now.toString(), validUntil: expiry, evidenceHash: hash(81), heartbeatSeconds: 86400 },
    routes: { buy: externalRoute, sell: externalRoute }, validUntil: expiry, evidenceHash: hash(82), checks: { codeAndMetadata: "verified", routePools: "verified-at-checkpoint", externalQuotes: "same-block-bidirectional", fullExecution: "required-before-signing" } } as const;
  const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v1", intent, readinessEvidenceHash: readiness.evidenceHash, price, validUntil: expiry });
  const preview: AnyQuoteLaunchPreparation = { schemaVersion: "programmable.any-quote.launch-preview.v1", intent, readiness, predictedToken: token, pool: anyQuotePoolFor(token, QUOTE, identity.contracts.sharedHook.address),
    ...encodeAnyQuoteConfigurationV1({ sharedHook: identity.contracts.sharedHook.address, quoteAsset: QUOTE, initialTick: price.initialTick, validUntil: BigInt(expiry), priceEvidenceHash }), initialTick: price.initialTick, validUntil: expiry,
    actualFdvUsd: price.actualFdvUsd, evidenceHash: "0x", initialBuy: null };
  preview.evidenceHash = anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined });
  return { ...f, release, identity, intent, preview, registration, feeState, setPlatformWallet: (next: Hex) => { platformWallet = next; } };
}

function tradeFixture(buy: boolean) {
  const f = sharedFixture(), pool = anyQuotePoolFor(TOKEN, QUOTE, f.identity.contracts.sharedHook.address), expiry = f.preview.validUntil;
  const key = { currency0: ANY_QUOTE_NATIVE, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
  const quote: AnyQuoteTradeQuote = { schemaVersion: "programmable.any-quote.trade-quote.v1", releaseDigest: f.release.releaseDigest, templateId: f.intent.templateId,
    account: ACCOUNT, token: TOKEN, quoteAsset: QUOTE, recipient: ACCOUNT, buy, inputAmount: "1000", output: "2000", minimumOutput: "1980", slippageBps: 100,
    validUntil: expiry, checkpoint: f.preview.readiness.checkpoint, pool, evidenceHash: "0x",
    externalRoute: { provider: "uniswap-trading-api", chainId: 4663, tokenIn: buy ? ANY_QUOTE_WETH : QUOTE, tokenOut: buy ? QUOTE : ANY_QUOTE_WETH,
      amountIn: buy ? "1000" : "3000", amountOut: buy ? "3000" : "2000", validUntil: expiry, checkpoint: f.preview.readiness.checkpoint, evidenceHash: hash(821),
      hops: [{ protocol: "V4", tokenIn: buy ? ANY_QUOTE_NATIVE : QUOTE, tokenOut: buy ? QUOTE : ANY_QUOTE_NATIVE, poolId: anyQuotePoolIdV1(key), key, hookData: "0x" }] } };
  quote.evidenceHash = anyQuoteEvidenceHashV1({ ...quote, evidenceHash: undefined });
  const allowance = { amount: 1000n, expiration: Number(expiry) }, originalRead = vi.mocked(f.client.readContract).getMockImplementation()!;
  vi.mocked(f.client.readContract).mockImplementation(async input => {
    if (input.functionName === "poolIdOf" || input.functionName === "poolId") return pool.poolId;
    if (input.functionName === "poolKey") return anyQuoteModulePoolKeyV1(pool);
    if (input.functionName === "allowance" && input.address?.toLowerCase() === ANY_QUOTE_INFRASTRUCTURE.permit2.toLowerCase()) return [allowance.amount, allowance.expiration, 0];
    return originalRead(input);
  });
  const permit2Runtime = readFileSync(new URL("../scripts/test/any-quote-route-permit2.hex", import.meta.url), "utf8").trim() as Hex;
  vi.mocked(f.client.getCode).mockImplementation(async ({ address }) => address.toLowerCase() === ANY_QUOTE_INFRASTRUCTURE.permit2.toLowerCase() ? permit2Runtime : CODE);
  vi.mocked(f.client.call).mockImplementation(async input => { expect(input.to?.toLowerCase()).toBe(f.identity.contracts.universalRouter.address); return { data: "0x" }; });
  return { ...f, quote, allowance };
}

function walletWindowPreview(f: ReturnType<typeof sharedFixture>) {
  const validUntil = (f.state.timestamp + 45n).toString(), executionDeadline = (f.state.timestamp + 180n).toString();
  const readiness = { ...f.preview.readiness, validUntil, price: { ...f.preview.readiness.price, validUntil }, routes: {
    buy: { ...f.preview.readiness.routes.buy, validUntil }, sell: { ...f.preview.readiness.routes.sell, validUntil },
  } };
  const price = planAnyQuoteInitialPriceV1({ token: f.preview.predictedToken, quoteAsset: QUOTE, quoteDecimals: 36, quoteUsd: readiness.price.usd });
  const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v2", intent: f.intent, readinessEvidenceHash: readiness.evidenceHash, price, validUntil, executionDeadline });
  const preview: AnyQuoteLaunchPreparation = { ...f.preview, schemaVersion: "programmable.any-quote.launch-preview.v2", readiness, validUntil, executionDeadline,
    ...encodeAnyQuoteConfigurationV1({ sharedHook: f.identity.contracts.sharedHook.address, quoteAsset: QUOTE, initialTick: price.initialTick, validUntil: BigInt(executionDeadline), priceEvidenceHash }) };
  preview.evidenceHash = anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined });
  return preview;
}

describe("Any Quote launch wallet deadline", () => {
  it("keeps v1 timing and rejects an execution-window field smuggled into a historical preview", () => {
    const f = sharedFixture();
    expect(assertAnyQuoteLaunchPreparation(f.preview, f.intent, f.identity, f.state.timestamp)).toBe(f.preview);
    expect(anyQuoteLaunchExecutionDeadline(f.preview)).toBe(BigInt(f.preview.validUntil));
    const changed = { ...f.preview, executionDeadline: (f.state.timestamp + 180n).toString() } as unknown as AnyQuoteLaunchPreparation;
    changed.evidenceHash = anyQuoteEvidenceHashV1({ ...changed, evidenceHash: undefined });
    expect(() => assertAnyQuoteLaunchPreparation(changed, f.intent, f.identity, f.state.timestamp)).toThrow("LAUNCH_PREVIEW_MISMATCH");
  });
  it.each([-1n, 1n, 60n])("rejects a fully resealed execution deadline shifted from the original snapshot by %s seconds", shift => {
    const f = sharedFixture(), preview = walletWindowPreview(f);
    expect(assertAnyQuoteLaunchPreparation(preview, f.intent, f.identity, f.state.timestamp)).toBe(preview);
    if (preview.schemaVersion !== "programmable.any-quote.launch-preview.v2") throw new Error("Expected v2");
    const executionDeadline = (BigInt(preview.executionDeadline) + shift).toString();
    const price = planAnyQuoteInitialPriceV1({ token: preview.predictedToken, quoteAsset: QUOTE, quoteDecimals: 36, quoteUsd: preview.readiness.price.usd });
    const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v2", intent: preview.intent,
      readinessEvidenceHash: preview.readiness.evidenceHash, price, validUntil: preview.validUntil, executionDeadline });
    const changed: AnyQuoteLaunchPreparation = { ...preview, executionDeadline,
      ...encodeAnyQuoteConfigurationV1({ sharedHook: f.identity.contracts.sharedHook.address, quoteAsset: QUOTE, initialTick: preview.initialTick, validUntil: BigInt(executionDeadline), priceEvidenceHash }) };
    changed.evidenceHash = anyQuoteEvidenceHashV1({ ...changed, evidenceHash: undefined });
    expect(() => assertAnyQuoteLaunchPreparation(changed, f.intent, f.identity, f.state.timestamp + 20n)).toThrow("LAUNCH_PREVIEW_TIMING_INVALID");
  });
  it("keeps quote review freshness independent from the future execution deadline", () => {
    const f = sharedFixture(), preview = walletWindowPreview(f);
    expect(assertAnyQuoteLaunchPreparation(preview, f.intent, f.identity, f.state.timestamp + 44n)).toBe(preview);
    expect(() => assertAnyQuoteLaunchPreparation(preview, f.intent, f.identity, f.state.timestamp + 45n)).toThrow("LAUNCH_PREVIEW_TIMING_INVALID");
    const route = buildAnyQuoteInitialBuy({ preview, owner: ACCOUNT, recipient: ACCOUNT, amountIn: 1000n, minimumAmountOut: 1980n, now: f.state.timestamp });
    expect(decodeFunctionData({ abi: parseAbi(["function execute(bytes,bytes[],uint256) payable"]), data: route.transaction.data }).args?.[2]).toBe(f.state.timestamp + 180n);
    expect(() => buildAnyQuoteInitialBuy({ preview, owner: ACCOUNT, recipient: ACCOUNT, amountIn: 1000n, minimumAmountOut: 1980n, now: f.state.timestamp + 45n })).toThrow("LAUNCH_ROUTE_TIMING_INVALID");
    expect(() => buildAnyQuoteSwapV1({ pool: preview.pool, owner: ACCOUNT, recipient: ACCOUNT, side: "buy", amountIn: 1000n,
      minimumAmountOut: 1980n, deadline: f.state.timestamp + 180n, externalRoute: preview.readiness.routes.buy, now: f.state.timestamp })).toThrow("TRADE_BOUNDS_INVALID");
  });
  it("rejects resealed freshness beyond 45 seconds and inconsistent route checkpoints", () => {
    const f = sharedFixture(), preview = walletWindowPreview(f);
    const validUntil = (f.state.timestamp + 60n).toString();
    const extended = structuredClone(preview);
    extended.validUntil = validUntil;
    extended.readiness.validUntil = validUntil;
    extended.readiness.price.validUntil = validUntil;
    extended.readiness.routes.buy.validUntil = validUntil;
    extended.readiness.routes.sell.validUntil = validUntil;
    const price = planAnyQuoteInitialPriceV1({ token: preview.predictedToken, quoteAsset: QUOTE, quoteDecimals: 36, quoteUsd: preview.readiness.price.usd });
    Object.assign(extended, encodeAnyQuoteConfigurationV1({ sharedHook: f.identity.contracts.sharedHook.address, quoteAsset: QUOTE, initialTick: preview.initialTick,
      validUntil: anyQuoteLaunchExecutionDeadline(preview), priceEvidenceHash: anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v2", intent: preview.intent,
        readinessEvidenceHash: preview.readiness.evidenceHash, price, validUntil, executionDeadline: preview.executionDeadline }) }));
    extended.evidenceHash = anyQuoteEvidenceHashV1({ ...extended, evidenceHash: undefined });
    expect(() => assertAnyQuoteLaunchPreparation(extended, f.intent, f.identity, f.state.timestamp)).toThrow("LAUNCH_PREVIEW_TIMING_INVALID");
    for (const direction of ["buy", "sell"] as const) {
      const changed = structuredClone(preview);
      changed.readiness.routes[direction].checkpoint = { ...changed.readiness.checkpoint, hash: hash(999) };
      changed.evidenceHash = anyQuoteEvidenceHashV1({ ...changed, evidenceHash: undefined });
      expect(() => assertAnyQuoteLaunchPreparation(changed, f.intent, f.identity, f.state.timestamp)).toThrow("LAUNCH_PREVIEW_TIMING_INVALID");
    }
  });
  it("rejects a preview that expires during the awaited settlement trace", async () => {
    const f = sharedFixture(), preview = walletWindowPreview(f), settlement = settlementRpcFixture(preview.readiness.routes.buy, addr(99));
    let now = Number(f.state.timestamp) * 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    const rpcs = settlement.rpcs.map(provider => (async (method, params) => {
      const result = await provider(method, params);
      if (method === "debug_traceCall") now = Number(preview.validUntil) * 1000;
      return result;
    }) satisfies TradeRpcV1) as unknown as readonly [TradeRpcV1, TradeRpcV1];
    try {
      await expect(readAnyQuoteIdentityLaunchPreviewV1({ ...f.intent, identity: f.identity, template: f.template, description: "Expired during validation" }, {
        client: f.client, readiness: async () => preview.readiness, options: { rpcs },
      })).rejects.toMatchObject({ code: "READINESS_EXPIRED" });
    } finally { clock.mockRestore(); }
  });
});

describe("Any Quote pair-token profile integration", () => {
  it.each([false, true])("keeps fee-conversion restrictions separate from an executable trade route (native ETH fees=%s)", async nativeEthFees => {
    const f = tradeFixture(true), catalog = anyQuoteUiFixture(nativeEthFees), intermediate = addr(20);
    const first = { currency0: ANY_QUOTE_NATIVE, currency1: intermediate, fee: 3000, tickSpacing: 60, hooks: ANY_QUOTE_NATIVE };
    // A different launch may use the same shared hook. This is valid trade topology, while
    // that hook cannot recursively serve as its own immutable ETH fee-conversion route.
    const second = { currency0: intermediate, currency1: QUOTE, fee: 0, tickSpacing: 200, hooks: catalog.release.contracts.sharedHook.address };
    const buy: AnyQuoteExternalRouteV1 = { ...f.quote.externalRoute, hops: [
      { protocol: "V4", tokenIn: ANY_QUOTE_NATIVE, tokenOut: intermediate, key: first, poolId: anyQuotePoolIdV1(first), hookData: "0x" },
      { protocol: "V4", tokenIn: intermediate, tokenOut: QUOTE, key: second, poolId: anyQuotePoolIdV1(second), hookData: "0x" },
    ] };
    const sell: AnyQuoteExternalRouteV1 = { ...buy, tokenIn: QUOTE, tokenOut: ANY_QUOTE_WETH, amountIn: "3000", amountOut: "2000",
      hops: [...buy.hops].reverse().map(hop => ({ ...hop, tokenIn: hop.tokenOut, tokenOut: hop.tokenIn })) };
    const readiness = { ...f.preview.readiness, routes: { buy, sell } };
    const result = readAnyQuoteReadiness({ releaseDigest: catalog.release.releaseDigest,
      templateId: catalog.template.manifest.manifest.catalogDefinition.id, quoteAsset: QUOTE }, {
      availability: async () => catalog.availability, readiness: async () => readiness,
    });
    if (nativeEthFees) await expect(result).rejects.toMatchObject({ code: "NATIVE_FEE_ROUTE_INVALID", status: "inconclusive" });
    else {
      await expect(result).resolves.toMatchObject({ status: "compatible", quoteAsset: QUOTE });
      for (const side of ["buy", "sell"] as const) {
        const compiled = buildAnyQuoteSwapV1({ pool: f.quote.pool, owner: ACCOUNT, recipient: ACCOUNT, side,
          amountIn: 1000n, minimumAmountOut: 1980n, deadline: BigInt(f.quote.validUntil), now: f.state.timestamp, externalRoute: readiness.routes[side] });
        expect(compiled).toMatchObject({ routerVersion: "2.1.1", balanceAccounting: { mode: "unlock-deltas" },
          transaction: { to: ANY_QUOTE_INFRASTRUCTURE.universalRouter, value: side === "buy" ? "1000" : "0" } });
      }
    }
  });

  it.each([[0, 1000], [1000, 0], [100, 900]])("previews and compiles independent pair-token creator fees buy=%s sell=%s", async (buyCreatorFeeBps, sellCreatorFeeBps) => {
    const f = sharedFixture(), intent = { ...f.intent, buyCreatorFeeBps, sellCreatorFeeBps };
    const settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99));
    const preview = await readAnyQuoteLaunchPreview({ ...intent, description: "Pair-token launch" }, {
      client: f.client, availability: async () => ({ ...f.availability, release: f.release }),
      readiness: async () => f.preview.readiness, options: { rpcs: settlement.rpcs },
    });
    expect(preview).toMatchObject({ intent: { quoteAsset: QUOTE, buyCreatorFeeBps, sellCreatorFeeBps, initialBuyWei: "0" }, initialBuy: null });
    expect(preview).not.toHaveProperty("nativeFeeRoute");
    expect(assertAnyQuoteLaunchPreparation(preview, intent, f.release, f.state.timestamp)).toBe(preview);
    const compiled = await compileModuleEngineLaunch({ ...f.launchInput, ...intent, configuration: {}, anyQuotePreparation: preview },
      f.identity, f.template.manifest, 36, anyQuoteLaunchExecutionDeadline(preview));
    expect(compiled.parameters).toMatchObject({ quoteAsset: QUOTE, buyCreatorFeeBps, sellCreatorFeeBps, initialOperation: { inputAmount: 0n } });
    // The selected pair is the fee asset even when only one direction charges creator fees.
    Object.assign(f.launch, { buyCreatorFeeBps, sellCreatorFeeBps });
    const admin = await readModuleEngineAdministration({ ...f, account: ACCOUNT, token: TOKEN });
    expect(admin.fees).toMatchObject({ feeAsset: QUOTE, buyPlatformBps: 30, sellPlatformBps: 30,
      buyCreatorBps: buyCreatorFeeBps, sellCreatorBps: sellCreatorFeeBps });
  });

  it("rejects fractional-percent and out-of-range creator fees independently on either side", () => {
    const { intent } = sharedFixture();
    for (const field of ["buyCreatorFeeBps", "sellCreatorFeeBps"] as const) {
      for (const value of [-100, 50, 1001, 1100]) {
        expect(() => anyQuoteLaunchIntent({ ...intent, [field]: value })).toThrow("INVALID_CREATOR_FEE");
      }
    }
  });

  it.each([true, false])("prepares an exact public pair-token trade quote without ETH fee selectors or conversion hashes (buy=%s)", async buy => {
    const f = tradeFixture(buy), externalBuy = f.preview.readiness.routes.buy;
    const externalSell: AnyQuoteExternalRouteV1 = { ...externalBuy, tokenIn: QUOTE, tokenOut: ANY_QUOTE_WETH, amountIn: "3000", amountOut: "2000",
      hops: externalBuy.hops.map(hop => ({ ...hop, tokenIn: hop.tokenOut, tokenOut: hop.tokenIn })) };
    const readiness = { ...f.preview.readiness, routes: { buy: externalBuy, sell: externalSell } };
    const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
    const rpc: TradeRpcV1 = async (method, params) => {
      expect(params[1]).toEqual({ blockHash: f.blockHash, requireCanonical: true });
      if (method === "eth_getCode") { expect(params[0]).toBe(ANY_QUOTE_INFRASTRUCTURE.v4Quoter); return CODE; }
      if (method !== "eth_call") throw new Error("Unexpected trade quote RPC method");
      const tx = params[0] as { to: Address; data: Hex }, decoded = decodeFunctionData({ abi: quoterAbi, data: tx.data });
      expect(tx.to).toBe(ANY_QUOTE_INFRASTRUCTURE.v4Quoter);
      expect(decoded.args[0]).toMatchObject({ poolKey: { currency0: getAddress(QUOTE), currency1: getAddress(TOKEN), fee: 0, tickSpacing: 200, hooks: getAddress(addr(901)) },
        zeroForOne: buy, exactAmount: buy ? 3000n : 1000n, hookData: "0x" });
      return encodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", result: [buy ? 2000n : 3000n, 100_000n] });
    };
    const quote = await readAnyQuoteTradeQuote(f.quote, { client: f.client,
      availability: async () => ({ ...f.availability, release: f.release }), readiness: async input => {
        expect(input).toEqual({ quoteAsset: QUOTE, ...(buy ? { probeEthAmount: 1000n } : {}) }); return readiness;
      }, requote: async (route, amountIn) => {
        expect(route).toEqual(externalSell); expect(amountIn).toBe(3000n); return externalSell;
      }, options: { rpcs: [rpc, rpc] },
    });
    expect(quote).toMatchObject({ quoteAsset: QUOTE, buy, inputAmount: "1000", output: "2000", minimumOutput: "1980", checkpoint: readiness.checkpoint });
    expect(quote).not.toHaveProperty("nativeFeeRouteHash");
    const prepared = await prepareModuleEngineAnyQuoteSwap({ ...f, quote, account: ACCOUNT });
    expect(prepared).toMatchObject({ kind: "swap", quoteAsset: QUOTE,
      inputAmount: 1000n, outputAmount: 2000n, minimumOutput: 1980n,
      transaction: { to: ANY_QUOTE_INFRASTRUCTURE.universalRouter, value: buy ? "0x3e8" : "0x0" } });
    expect(prepared).not.toHaveProperty("nativeEthFees", true);
    expect(vi.mocked(f.client.readContract).mock.calls.some(([input]) => ["nativeFeeRoute", "nativeFeeRouteHash"].includes(String(input.functionName)))).toBe(false);
  });
});

function lifecycleHistory(f: ReturnType<typeof sharedFixture>) {
  const originalTimestamp = f.state.timestamp, history = { latest: 100n };
  vi.mocked(f.client.getBlock).mockImplementation(async input => {
    const number = input?.blockNumber ?? history.latest;
    return { number, hash: number === 100n ? f.blockHash : hash(Number(number)), timestamp: number === 100n ? originalTimestamp : f.state.timestamp } as never;
  });
  return history;
}
function lifecycleLog(address: Address, abi: Abi, eventName: string, args: Record<string, unknown>) {
  const event = abi.find(item => item.type === "event" && item.name === eventName); if (event?.type !== "event") throw new Error("Missing event");
  return { address, blockNumber: 101n, blockHash: hash(101), transactionHash: hash(202), transactionIndex: 0, logIndex: 0, removed: false,
    topics: encodeEventTopics({ abi, eventName, args } as never), data: encodeAbiParameters(event.inputs.filter(item => !item.indexed), event.inputs.filter(item => !item.indexed).map(item => args[item.name!])) };
}
function lifecycleReceipt(f: ReturnType<typeof sharedFixture>, preparation: AnyQuoteLifecyclePreparationV1, logs: ReturnType<typeof lifecycleLog>[]) {
  const transaction = preparation.prepared.transaction;
  vi.mocked(f.client.getTransaction).mockResolvedValue({ hash: hash(202), from: transaction.from, to: transaction.to, input: transaction.data, value: BigInt(transaction.value), chainId: 4663, blockNumber: 101n, blockHash: hash(101) } as never);
  return { status: "success", from: transaction.from, to: transaction.to, transactionHash: hash(202), blockNumber: 101n, blockHash: hash(101), logs } as unknown as TransactionReceipt;
}

describe("Any Quote source identity lifecycle preparation", () => {
  it("uses genuine identity packets while public reads and preparation remain active-gated", async () => {
    const f = tradeFixture(true), identity = f.identity;
    expect(identity).not.toHaveProperty("status"); expect(identity).not.toHaveProperty("lifecycleEvidenceDigest");
    await expect(assertAnyQuoteLifecycleIdentityV1({ ...f, identity })).resolves.toMatchObject({ release: identity });
    await expect(readModuleEngineLaunch({ ...f, release: identity as typeof f.release, token: TOKEN })).rejects.toThrow();
    await expect(prepareModuleEngineAnyQuoteSwap({ ...f, release: identity as typeof f.release, account: ACCOUNT })).rejects.toThrow();
    const prepared = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity, account: ACCOUNT });
    if ("kind" in prepared) throw new Error("Unexpected approval");
    await expect(revalidateModuleEngineTransaction(prepared.prepared as never, ACCOUNT)).rejects.toThrow("fresh, verified");
    await expect(assertAnyQuoteLifecycleIdentityV1({ ...f, identity: f.release })).rejects.toThrow();
  });
  it.each([true, false])("roundtrips and revalidates identical unsigned route bytes without requoting (buy=%s)", async buy => {
    const f = tradeFixture(buy); lifecycleHistory(f);
    const preparation = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected approval");
    const restored = JSON.parse(JSON.stringify(preparation)) as AnyQuoteLifecyclePreparationV1;
    expect(restored.prepared.blockNumber).toBe("100");
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: restored })).resolves.toEqual(preparation.prepared.transaction);
    const changed = {
      ...structuredClone(restored),
      prepared: { ...restored.prepared, transaction: { ...restored.prepared.transaction, value: "0xffff" as Hex } },
    };
    changed.evidenceHash = anyQuoteEvidenceHashV1({ ...changed, evidenceHash: undefined });
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: changed })).rejects.toThrow("original canonical preparation differs");
  });
  it("rejects expired materializations while retaining the original checkpoint", async () => {
    const f = tradeFixture(true), history = lifecycleHistory(f), preparation = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected approval");
    history.latest = 101n; f.state.timestamp = BigInt(preparation.prepared.expiresAt);
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation })).rejects.toThrow("expired");
  });
  it("prepares only the finite required Permit2 predecessor of a bound sell", async () => {
    const f = tradeFixture(false); lifecycleHistory(f); f.allowance.amount = 0n;
    vi.mocked(f.client.call).mockResolvedValue({ data: "0x" });
    const preparation = await prepareAnyQuoteLifecycleApprovalV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected missing approval");
    expect(preparation).toMatchObject({ recipe: { kind: "approve" }, prepared: { kind: "approve", amount: "1000", allowanceKind: "permit2" }, funding: { funding: { permit2Nonce: 0, erc20Allowance: f.state.allowance.toString() } } });
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: JSON.parse(JSON.stringify(preparation)) })).resolves.toEqual(preparation.prepared.transaction);
    const buy = tradeFixture(true);
    await expect(prepareAnyQuoteLifecycleApprovalV1({ ...buy, identity: buy.identity, account: ACCOUNT })).rejects.toThrow("predecessor of a sell");
  });
  it.each(["0", "100000000000000"])("prepares the exact quote-profile launch through settlement, compiler and operator checks (initial ETH wei=%s)", async initialBuyWei => {
    const f = sharedFixture(), history = lifecycleHistory(f), intent = { ...f.intent, initialBuyWei }, originalTimestamp = f.state.timestamp;
    const freshUntil = (originalTimestamp + 45n).toString();
    const readiness = { ...f.preview.readiness, validUntil: freshUntil, price: { ...f.preview.readiness.price, validUntil: freshUntil }, routes: {
      sell: { ...f.preview.readiness.routes.sell, validUntil: freshUntil },
      buy: { ...f.preview.readiness.routes.buy, validUntil: freshUntil, amountIn: initialBuyWei === "0" ? "1000" : initialBuyWei } } };
    const settlement = settlementRpcFixture(readiness.routes.buy, addr(99));
    const initialTraces: unknown[][] = [];
    // Synthetic provider responses stay below the actual preview/compiler boundary.
    const rpcs = settlement.rpcs.map(provider => (async (method, params) => {
      const tx = params[0] as { from?: Address; to?: Address; data?: Hex; value?: Hex };
      if (method !== "debug_traceCall" || tx.to?.toLowerCase() !== f.host.toLowerCase()) return provider(method, params);
      initialTraces.push([...params]);
      expect(params[1]).toEqual({ blockHash: readiness.checkpoint.hash, requireCanonical: true });
      expect(BigInt(tx.value!)).toBe(BigInt(initialBuyWei));
      return { type: "CALL", ...tx, input: tx.data, output: "0x", gasUsed: "0x100", calls: [
        { type: "CALL", from: f.identity.contracts.poolManager.address, to: f.preview.predictedToken, value: "0x0", gasUsed: "0x10",
          input: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ACCOUNT, 2000n] }), output: encodeFunctionResult({ abi: erc20Abi, functionName: "transfer", result: true }) },
      ] };
    }) satisfies TradeRpcV1) as unknown as readonly [TradeRpcV1, TradeRpcV1];
    const preview = await readAnyQuoteIdentityLaunchPreviewV1({ ...intent, identity: f.identity, template: f.template, description: "Identity launch" }, { client: f.client, readiness: async () => readiness, options: { rpcs } });
    expect(preview).toMatchObject({ schemaVersion: "programmable.any-quote.launch-preview.v2", validUntil: freshUntil, executionDeadline: (originalTimestamp + 180n).toString() });
    expect(initialTraces).toHaveLength(initialBuyWei === "0" ? 0 : 2);
    const input = { ...f.launchInput, ...intent, imageUri: "", socialLinks: {}, anyQuotePreparation: preview };
    const route = preview.initialBuy ? buildAnyQuoteInitialBuy({ preview, owner: ACCOUNT, recipient: ACCOUNT,
      amountIn: BigInt(initialBuyWei), minimumAmountOut: BigInt(preview.initialBuy.minimumOutput), now: f.state.timestamp }) : null;
    const initialOperation = route ? () => ({ operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, recipient: ACCOUNT, inputAsset: ANY_QUOTE_NATIVE,
      inputAmount: BigInt(initialBuyWei), outputAsset: preview.predictedToken, minimumOutput: 1980n, data: route.nativeBuyOperationData! }) : undefined;
    const compiled = await compileModuleEngineLaunch({ ...input, initialOperation }, f.identity, f.template.manifest, 36, anyQuoteLaunchExecutionDeadline(preview));
    const read = vi.mocked(f.client.readContract).getMockImplementation()!;
    vi.mocked(f.client.readContract).mockImplementation(async value => value.functionName === "predictTokenAddress" ? [compiled.predictedToken, compiled.graffiti] : read(value));
    const result = { ...f.launch, launchId: compiled.launchId, token: compiled.predictedToken, engine: compiled.engine, constructorHash: compiled.constructorHash, initCodeHash: compiled.initCodeHash, configurationHash: compiled.configurationHash, planHash: compiled.planHash, engineCodeHash: compiled.engineCodeHash };
    vi.mocked(f.client.call).mockResolvedValue({ data: encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", result }) });
    const getCode = vi.mocked(f.client.getCode).getMockImplementation()!;
    vi.mocked(f.client.getCode).mockImplementation(value => value.address.toLowerCase() === preview.predictedToken.toLowerCase() ? Promise.resolve("0x") : getCode(value));
    const preparation = await prepareAnyQuoteLifecycleLaunchV1({ ...f, identity: f.identity, input });
    if ("kind" in preparation) throw new Error("Unexpected funding");
    expect(BigInt(preparation.prepared.transaction.value)).toBe(BigInt(initialBuyWei));
    expect(preparation.prepared).toMatchObject({ expiresAt: freshUntil, anyQuote: { executionDeadline: (originalTimestamp + 180n).toString() } });
    const launch = decodeFunctionData({ abi: moduleEngineHostAbi, data: preparation.prepared.transaction.data });
    expect(launch.functionName).toBe("launch");
    if (launch.functionName !== "launch") throw new Error("Expected launch calldata");
    const [parameters] = decodeAbiParameters(moduleEngineLaunchParameters, `0x${preparation.prepared.transaction.data.slice(10)}`);
    expect(parameters.initialOperation).toMatchObject({ inputAmount: BigInt(initialBuyWei), nonce: 0n,
      minimumOutput: initialBuyWei === "0" ? 0n : 1980n });
    if (route) {
      expect(route).toMatchObject({ routerVersion: "2.1.1", finalMinimum: "1980", transaction: { to: ANY_QUOTE_INFRASTRUCTURE.universalRouter } });
      expect(parameters.initialOperation).toMatchObject({ operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, actor: ACCOUNT, recipient: ACCOUNT,
        inputAsset: ANY_QUOTE_NATIVE, outputAsset: getAddress(preview.predictedToken), deadline: originalTimestamp + 180n, data: route.nativeBuyOperationData });
    }
    // Exercise the actual canonical helper envelope across the existing operator boundary.
    // Compiler input deliberately omits these financial fields; the preview intent retains them.
    expect(preparation.recipe.kind).toBe("launch");
    if (preparation.recipe.kind !== "launch") throw new Error("Expected launch recipe");
    expect(preparation.recipe.input).not.toHaveProperty("initialBuyWei");
    const stableIntent = { ...intent, description: input.description, imageUri: input.imageUri, socialLinks: input.socialLinks };
    const operatorPlan = { schemaVersion: "programmable.module-engine-lifecycle-owner-plan.v1", identity: f.identity, owner: ACCOUNT,
      bundle: { manifest: f.template.manifest, review: { command: { hostManifestHash: f.template.manifestHash }, decisionDigest: f.template.reviewDigest } },
      steps: [{ kind: "any-quote-launch", intent: stableIntent, target: preview.predictedToken, to: f.identity.contracts.host.address, value: initialBuyWei, data: null }] };
    expect(anyQuoteWalletStep(operatorPlan, 0, JSON.parse(JSON.stringify(preparation)))).toMatchObject({ to: f.identity.contracts.host.address, data: preparation.prepared.transaction.data, value: initialBuyWei });
    const ceilings = { maxGas: "2000000", maxFeePerGas: "1000", maxPriorityFeePerGas: "10", maxValue: initialBuyWei };
    const observation = { state: "operation-simulated", stepIndex: 0, anyQuote: preparation, nonce: "1", gasLimit: "100000", baseFeePerGas: "1",
      minimumBalance: (BigInt(initialBuyWei) + 2_000_000_000n).toString() };
    expect(publicationWalletRequest(operatorPlan, observation, ceilings)).toMatchObject({ value: preparation.prepared.transaction.value,
      data: preparation.prepared.transaction.data, to: f.identity.contracts.host.address, nonce: "0x1" });
    if (route) expect(() => publicationWalletRequest(operatorPlan, observation, { ...ceilings, maxValue: (BigInt(initialBuyWei) - 1n).toString() })).toThrow("ETH value exceeds");
    expect(() => publicationWalletRequest(operatorPlan, observation, { ...ceilings, maxGas: "99999" })).toThrow("Gas estimate exceeds");
    for (const field of ["initialBuyWei", "slippageBps", "buyCreatorFeeBps"] as const) {
      const changed = structuredClone(preparation);
      if (changed.recipe.kind !== "launch") throw new Error("Expected launch recipe");
      Object.assign(changed.recipe.input.anyQuotePreparation.intent, { [field]: field === "initialBuyWei" ? "1" : 200 });
      expect(() => anyQuoteWalletStep(operatorPlan, 0, changed)).toThrow("price intent");
    }
    const metadata = structuredClone(preparation);
    if (metadata.recipe.kind !== "launch") throw new Error("Expected launch recipe");
    metadata.recipe.input.description = "Different metadata";
    expect(() => anyQuoteWalletStep(operatorPlan, 0, metadata)).toThrow("compiler inputs");
    const wrongValue = structuredClone(preparation);
    wrongValue.prepared = { ...wrongValue.prepared, transaction: { ...wrongValue.prepared.transaction, value: `0x${(BigInt(initialBuyWei) + 1n).toString(16)}` } };
    expect(() => anyQuoteWalletStep(operatorPlan, 0, wrongValue)).toThrow("target/value");
    for (const amount of ["-1", "01", (1n << 128n).toString()]) {
      const changedPlan = structuredClone(operatorPlan), changed = structuredClone(preparation);
      changedPlan.steps[0].intent.initialBuyWei = amount; changedPlan.steps[0].value = amount;
      if (changed.recipe.kind !== "launch") throw new Error("Expected launch recipe");
      changed.recipe.input.anyQuotePreparation.intent.initialBuyWei = amount;
      changed.prepared = { ...changed.prepared, transaction: { ...changed.prepared.transaction, value: `0x${BigInt(amount).toString(16)}` } };
      expect(() => anyQuoteWalletStep(changedPlan, 0, changed)).toThrow();
    }
    await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: JSON.parse(JSON.stringify(preparation)) })).resolves.toEqual(preparation.prepared.transaction);
    const estimate = vi.mocked(f.client.estimateGas).getMockImplementation()!;
    let liveNow = Number(originalTimestamp + 44n) * 1000;
    const freshnessClock = vi.spyOn(Date, "now").mockImplementation(() => liveNow);
    try {
      // Advance only the live clock while a real awaited estimate completes. The
      // canonical block remains unchanged, so stale-block success cannot hide expiry.
      vi.mocked(f.client.estimateGas).mockImplementation(async request => {
        const gas = await estimate(request); liveNow = Number(freshUntil) * 1000; return gas;
      });
      await expect(prepareAnyQuoteLifecycleLaunchV1({ ...f, identity: f.identity, input })).rejects.toThrow("expired");
      liveNow = Number(originalTimestamp + 44n) * 1000;
      await expect(prepareModuleEngineLaunch({ ...input, initialOperation })).rejects.toThrow("expired");
      liveNow = Number(originalTimestamp + 44n) * 1000;
      await expect(prepareModuleEngineSourceLaunchV1({ ...input, identity: f.identity, template: f.template, initialOperation })).rejects.toThrow("expired");
      // Final estimate follows original reconstruction and current simulation.
      liveNow = Number(originalTimestamp + 44n) * 1000; let estimates = 0;
      vi.mocked(f.client.estimateGas).mockImplementation(async request => {
        const gas = await estimate(request); if (++estimates === 3) liveNow = Number(freshUntil) * 1000; return gas;
      });
      await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation })).rejects.toThrow("expired");
      expect(estimates).toBe(3);
      // A fresh refresh at a later canonical block keeps the original signed bytes.
      vi.mocked(f.client.estimateGas).mockImplementation(estimate);
      liveNow = Number(originalTimestamp + 20n) * 1000; history.latest = 101n; f.state.timestamp = originalTimestamp + 20n;
      await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation })).resolves.toEqual(preparation.prepared.transaction);
      expect(preparation.prepared).toMatchObject({ anyQuote: { executionDeadline: (originalTimestamp + 180n).toString() } });
    } finally {
      freshnessClock.mockRestore(); vi.mocked(f.client.estimateGas).mockImplementation(estimate); history.latest = 100n; f.state.timestamp = originalTimestamp;
    }
    if (route) {
      const changed = structuredClone(preparation);
      changed.prepared = { ...changed.prepared, transaction: { ...changed.prepared.transaction, data: encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [{ ...parameters,
        initialOperation: { ...parameters.initialOperation, minimumOutput: 1979n } }] }) } };
      changed.evidenceHash = anyQuoteEvidenceHashV1({ ...changed, evidenceHash: undefined });
      await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation: changed })).rejects.toThrow("original canonical preparation differs");
    }
    settlement.state.recipientAdjustment = -1n;
    await expect(readAnyQuoteIdentityLaunchPreviewV1({ ...intent, identity: f.identity, template: f.template, description: "Identity launch" }, { client: f.client, readiness: async () => readiness, options: { rpcs } })).rejects.toMatchObject({ status: "incompatible" });
    // Provider/header/log responses are modeled here; the actual compiler, lifecycle,
    // operator and receipt verifiers run unchanged across a delayed wallet handoff.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Number(originalTimestamp + 90n) * 1000);
    try {
      history.latest = 101n; f.state.timestamp = originalTimestamp + 90n;
      await expect(revalidateAnyQuoteLifecyclePreparationV1({ ...f, identity: f.identity, preparation })).rejects.toThrow("expired");
      Object.assign(f.launch, result);
      f.feeState.configurationHash = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,address,bytes32,address,address[],uint16[]"),
        [f.release.economicsPolicyId, 4663n, f.release.contracts.ledger.address, f.identity.contracts.poolManager.address, f.identity.contracts.sharedHook.address,
          f.host, result.launchId, QUOTE, [ACCOUNT], [10_000]]));
      Object.assign(f.registration, lifecycleLog(f.release.contracts.ledger.address, registrationAbi, "QuoteLaunchRegistered", {
        launchId: result.launchId, asset: QUOTE, configurationHash: f.feeState.configurationHash, creatorWallets: [ACCOUNT], creatorSharesBps: [10_000],
      }));
      const actualRead = vi.mocked(f.client.readContract).getMockImplementation()!;
      vi.mocked(f.client.readContract).mockImplementation(async value => {
        if (value.functionName === "graffiti") return compiled.graffiti;
        if (value.functionName === "contextHash") return keccak256(encodeAbiParameters(parseAbiParameters(ENGINE_CONTEXT), [compiled.context]));
        if (value.functionName === "nonces") return value.blockNumber === 100n ? 0n : 1n;
        return actualRead(value);
      });
      vi.mocked(f.client.getCode).mockImplementation(value => value.address.toLowerCase() === preview.predictedToken.toLowerCase() && value.blockNumber === 100n ? Promise.resolve("0x") : getCode(value));
      const logs = [lifecycleLog(f.host, moduleEngineHostAbi, "EngineLaunchBound", { ...result, runtimeCodeHash: result.engineCodeHash, economicsPolicyId: f.release.economicsPolicyId }),
        lifecycleLog(f.host, moduleEngineHostAbi, "EngineLaunchParametersBound", { launchId: result.launchId, encodedParameters: encodeAbiParameters(moduleEngineLaunchParameters, [parameters]) }),
        ...(route ? [lifecycleLog(f.host, moduleEngineHostAbi, "EngineOperationExecuted", { ...parameters.initialOperation, launchId: result.launchId, outputAmount: 2000n, resultHash: keccak256(parameters.initialOperation.data) })] : [])];
      const receipt = lifecycleReceipt(f, preparation, logs);
      await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt })).resolves.toMatchObject({ kind: "launch", finalized: false, ...(route ? { outputAmount: "2000" } : {}) });
      expect(preparation.prepared.transaction.data).toBe(encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [parameters] }));
    } finally { clock.mockRestore(); }
  });
  it("binds a canonical swap receipt to the signed router bytes and final token transfer", async () => {
    const f = tradeFixture(true); lifecycleHistory(f);
    const preparation = await prepareAnyQuoteLifecycleSwapV1({ ...f, identity: f.identity, account: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected approval");
    const logs = [lifecycleLog(f.identity.contracts.sharedHook.address, moduleEngineAnyQuoteHookAbi, "QuotePoolSwap", { poolId: f.quote.pool.poolId, launchId: f.launch.launchId, swapSender: f.identity.contracts.universalRouter.address, buy: true, exactInput: true, grossQuote: 1000n, platformQuote: 3n, creatorQuote: 0n, coreAmount0: 1000n, coreAmount1: -2000n }),
      lifecycleLog(TOKEN, erc20Abi, "Transfer", { from: f.identity.contracts.poolManager.address, to: ACCOUNT, value: 2000n })];
    const receipt = lifecycleReceipt(f, preparation, logs);
    await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt })).resolves.toMatchObject({ kind: "swap", outputAmount: "2000", finalized: false });
    await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt: { ...receipt, logs: receipt.logs.slice(0, 1) } })).rejects.toThrow("below the signed minimum");
  });
  it.each(["valid", "irrelevant-zero-transfer", "irrelevant-positive-transfer", "missing-transfer", "duplicate-transfer", "wrong-source", "wrong-recipient", "wrong-amount", "zero-payment", "unchanged-total"])("binds claim receipts to actual PoolManager transfer and ledger total: %s", async mutation => {
    const f = sharedFixture(); lifecycleHistory(f);
    const preparation = await prepareAnyQuoteLifecycleClaimV1({ ...f, identity: f.identity, account: ACCOUNT, token: TOKEN, recipient: ACCOUNT });
    if ("kind" in preparation) throw new Error("Unexpected funding");
    const read = vi.mocked(f.client.readContract).getMockImplementation()!;
    vi.mocked(f.client.readContract).mockImplementation(async value => value.functionName === "claimedBy" && value.blockNumber === 101n ? mutation === "unchanged-total" ? 4n : 13n : read(value));
    const transfer = lifecycleLog(QUOTE, erc20Abi, "Transfer", { from: mutation === "wrong-source" ? f.identity.contracts.ledger.address : f.identity.contracts.poolManager.address,
      to: mutation === "wrong-recipient" ? addr(777) : ACCOUNT, value: mutation === "wrong-amount" ? 8n : mutation === "zero-payment" ? 0n : 9n });
    const irrelevant = mutation === "irrelevant-zero-transfer" || mutation === "irrelevant-positive-transfer"
      ? [lifecycleLog(QUOTE, erc20Abi, "Transfer", { from: addr(777), to: addr(778), value: mutation === "irrelevant-zero-transfer" ? 0n : 1n })] : [];
    const logs = [lifecycleLog(f.identity.contracts.ledger.address, moduleEngineAnyQuoteLedgerAbi, "QuoteFeesClaimed", { asset: QUOTE, beneficiary: ACCOUNT, recipient: ACCOUNT, amount: 9n }), ...(mutation === "missing-transfer" ? [] : [transfer]), ...(mutation === "duplicate-transfer" ? [transfer] : []), ...irrelevant];
    const receipt = lifecycleReceipt(f, preparation, logs), result = verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation: JSON.parse(JSON.stringify(preparation)), receipt });
    if (mutation === "valid" || mutation === "irrelevant-zero-transfer") {
      await expect(result).resolves.toMatchObject({ kind: "claim", outputAmount: "9", blockNumber: "101" });
      await expect(verifyModuleEngineClaimReceipt({ ...f, launch: f.launch, account: ACCOUNT, recipient: ACCOUNT, minimumAmount: 9n, claimedBefore: 4n, receipt })).resolves.toMatchObject({ outputAmount: 9n });
      const clock = vi.spyOn(Date, "now").mockReturnValue(Number(BigInt(preparation.prepared.expiresAt) + 3_600n) * 1000);
      try { await expect(verifyAnyQuoteLifecycleReceiptV1({ ...f, identity: f.identity, preparation, receipt })).resolves.toMatchObject({ outputAmount: "9" }); }
      finally { clock.mockRestore(); }
    } else await expect(result).rejects.toThrow();
  });
});

describe("Any Quote financial integration", () => {
  it("preserves public availability for genuine sell approvals and rejects other funding authorities", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      for (const allowanceKind of ["erc20", "permit2"] as const) {
        const f = tradeFixture(false); f.state.allowance = allowanceKind === "erc20" ? 0n : 1000n; f.allowance.amount = 0n;
        vi.mocked(f.client.call).mockResolvedValue({ data: "0x" });
        const required = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
        expect(required).toMatchObject({ kind: "approval-required", allowanceKind, spender: ANY_QUOTE_INFRASTRUCTURE.permit2 });
        if (required.kind !== "approval-required") throw new Error("Expected the sell's funding approval");
        const prepared = await prepareModuleEngineApproval({ ...required, client: f.client, release: f.release, account: ACCOUNT });
        expect(prepared).toMatchObject({ kind: "approve", allowanceKind, amount: 1000n, spender: ANY_QUOTE_INFRASTRUCTURE.permit2 });
        if (allowanceKind === "erc20") expect(prepared).not.toHaveProperty("permit2Spender");
        else expect(prepared.permit2Spender).toBe(f.identity.contracts.universalRouter.address);

        fetcher.mockImplementation(async () => Response.json(f.availability));
        const current = await fetchModuleEngineAvailability(prepared.releaseDigest);
        expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, current)).not.toThrow();
        await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).resolves.toBe(prepared.transaction);
        for (const spender of [f.release.contracts.host.address, addr(999)]) {
          expect(() => assertModuleEngineOperationAvailability({ ...prepared, spender }, f.availability, current)).toThrow("funding contract");
        }
        expect(() => assertModuleEngineOperationAvailability({ ...prepared, permit2Spender: addr(999) }, f.availability, current)).toThrow("funding contract");
        if (allowanceKind === "permit2") {
          expect(() => assertModuleEngineOperationAvailability({ ...prepared, permit2Spender: undefined }, f.availability, current)).toThrow("funding contract");
        }
        expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, { ...current, templates: [] })).toThrow("funding contract");
        const replacement = structuredClone(current);
        if (!replacement.release || !("universalRouter" in replacement.release.contracts)) throw new Error("Expected the shared release");
        replacement.release.contracts.universalRouter = { ...replacement.release.contracts.universalRouter, address: addr(999) };
        replacement.release.releaseDigest = computeModuleEngineReleaseDigest(replacement.release);
        replacement.templates = [];
        expect(() => assertModuleEngineOperationAvailability(prepared, f.availability, replacement)).toThrow("template version changed");
      }

      const legacy = fixture(); vi.mocked(legacy.client.call).mockResolvedValue({ data: "0x" });
      const prepared = await prepareModuleEngineApproval({ client: legacy.client, release: legacy.release, account: ACCOUNT, token: QUOTE, amount: 1000n });
      expect(prepared.spender).toBe(legacy.release.contracts.host.address);
      expect(prepared).not.toHaveProperty("allowanceKind");
      fetcher.mockImplementation(async () => Response.json(legacy.availability));
      const current = await fetchModuleEngineAvailability(prepared.releaseDigest);
      expect(() => assertModuleEngineOperationAvailability(prepared, legacy.availability, current)).not.toThrow();
      await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).resolves.toBe(prepared.transaction);
      expect(() => assertModuleEngineOperationAvailability({ ...prepared, spender: ANY_QUOTE_INFRASTRUCTURE.permit2 }, legacy.availability, current)).toThrow("funding contract");
      expect(() => assertModuleEngineOperationAvailability({ ...prepared, allowanceKind: "permit2", permit2Spender: ANY_QUOTE_INFRASTRUCTURE.universalRouter }, legacy.availability, current)).toThrow("funding contract");
    } finally { fetcher.mockRestore(); }
  });
  it("binds the real ledger commitment separately from Host config and retains claims after creator rotation", async () => {
    const f = sharedFixture();
    expect(f.feeState.configurationHash).not.toBe(f.launch.configurationHash);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).resolves.toEqual(f.launch);
    f.feeState.creatorWallets = [addr(111)];
    const admin = await readModuleEngineAdministration({ ...f, account: ACCOUNT, token: TOKEN });
    expect(admin.fees.creatorWallets).toEqual([addr(111)]);
    await expect(prepareModuleEngineClaim({ ...f, account: ACCOUNT, token: TOKEN, recipient: ACCOUNT })).resolves.toMatchObject({ kind: "claim", minimumAmount: 9n });
  });
  it("finds the immutable quote registration within the provider log range after a long release history", async () => {
    const f = sharedFixture(), checkpoint = 1_000_100n, registeredAt = 985_000n;
    f.registration.blockNumber = registeredAt;
    f.feeState.creatorWallets = [addr(111)];
    vi.mocked(f.client.getBlock).mockImplementation(async input => ({ number: input?.blockNumber ?? checkpoint, hash: f.blockHash, timestamp: f.state.timestamp }) as never);
    const originalRead = vi.mocked(f.client.readContract).getMockImplementation()!;
    const registrationReads: bigint[] = [];
    vi.mocked(f.client.readContract).mockImplementation(async input => {
      if (input.functionName === "quoteAsset" && input.address === f.release.contracts.ledger.address) {
        const at = input.blockNumber!; registrationReads.push(at);
        return at < registeredAt ? ZERO : QUOTE;
      }
      return originalRead(input);
    });
    f.client.getLogs = vi.fn(async input => {
      const from = input.fromBlock as bigint, to = input.toBlock as bigint;
      if (to - from + 1n > 10_000n) throw new Error("eth_getLogs is limited to a 10,000 range");
      expect(input).toMatchObject({ address: f.release.contracts.ledger.address, args: { launchId: f.launch.launchId, asset: QUOTE }, strict: true });
      expect(from).toBeLessThanOrEqual(registeredAt); expect(to).toBeGreaterThanOrEqual(registeredAt);
      return [f.registration];
    }) as NonNullable<typeof f.client.getLogs>;
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).resolves.toEqual(f.launch);
    expect(f.client.getLogs).toHaveBeenCalledTimes(1);
    expect(registrationReads.some(at => at < registeredAt)).toBe(true);
    expect(registrationReads.some(at => at >= registeredAt && at < checkpoint)).toBe(true);
    expect(registrationReads.length).toBeLessThanOrEqual(8);
    f.registration.data = encodeAbiParameters(parseAbiParameters("bytes32,address[],uint16[]"), [f.feeState.configurationHash, [addr(111)], [10_000]]);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Quote launch registration configuration");
  });
  it("rejects the Host hash in ledger storage and rejects changed original recipients", async () => {
    const f = sharedFixture(), original = f.feeState.configurationHash;
    f.feeState.configurationHash = f.launch.configurationHash;
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Ledger configuration differs");
    f.feeState.configurationHash = original;
    f.registration.data = encodeAbiParameters(parseAbiParameters("bytes32,address[],uint16[]"), [original, [addr(111)], [10_000]]);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Quote launch registration configuration differs");
  });
  it("keeps Host configuration independently bound to the derived launch ID", async () => {
    const f = sharedFixture(); f.launch.configurationHash = hash(991);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Derived launch ID differs");
  });
  it.each(["missing", "duplicate", "foreign-ledger", "foreign-launch", "foreign-asset", "removed", "future-block", "forked-block"])("rejects invalid original quote registration evidence: %s", async mutation => {
    const f = sharedFixture();
    if (mutation === "missing" || mutation === "duplicate") f.client.getLogs = vi.fn(async () => mutation === "missing" ? [] : [f.registration, f.registration]) as NonNullable<typeof f.client.getLogs>;
    if (mutation === "foreign-ledger") f.registration.address = addr(991);
    if (mutation === "foreign-launch" || mutation === "foreign-asset") f.registration.topics = encodeEventTopics({ abi: registrationAbi, eventName: "QuoteLaunchRegistered", args: { launchId: mutation === "foreign-launch" ? hash(991) : f.launch.launchId, asset: mutation === "foreign-asset" ? addr(991) : QUOTE } });
    if (mutation === "removed") f.registration.removed = true;
    if (mutation === "future-block") f.registration.blockNumber = 101n;
    if (mutation === "forked-block") f.registration.blockHash = hash(991);
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow(/quote launch registration/i);
  });
  it("requires registration log access only for the Any Quote client", async () => {
    const f = sharedFixture(); delete f.client.getLogs;
    await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("registration logs are unavailable");
    const legacy = fixture();
    await expect(readModuleEngineLaunch({ ...legacy, token: TOKEN })).resolves.toEqual(legacy.launch);
  });
  it.each([true, false])("prepares and revalidates the full final ETH route with its reviewed minimum (buy=%s)", async buy => {
    const f = tradeFixture(buy), prepared = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
    expect(prepared.kind).toBe("swap"); if (prepared.kind !== "swap") throw new Error("Unexpected funding approval");
    const expected = buildAnyQuoteSwapV1({ pool: f.quote.pool, owner: ACCOUNT, recipient: ACCOUNT, side: buy ? "buy" : "sell", amountIn: 1000n, minimumAmountOut: 1980n, deadline: BigInt(f.quote.validUntil), externalRoute: f.quote.externalRoute, now: f.state.timestamp });
    expect(prepared.transaction.data).toBe(expected.transaction.data); expect(BigInt(prepared.transaction.value)).toBe(buy ? 1000n : 0n);
    expect(prepared).toMatchObject({ minimumOutput: 1980n, outputAmount: 2000n, quoteAsset: QUOTE });
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).resolves.toEqual(prepared.transaction);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("fresh, verified");
    releaseModuleEnginePreparation(prepared); // Simulate an explicit wallet rejection, which alone permits a new attempt.
    f.state.timestamp = BigInt(f.quote.validUntil);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("expired");
  });
  it("uses the UERC20 Permit2 allowance and requires only a finite router approval when needed", async () => {
    const f = tradeFixture(false); f.state.allowance = (1n << 256n) - 1n; f.allowance.amount = 999n;
    await expect(prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT })).resolves.toMatchObject({ kind: "approval-required", allowanceKind: "permit2", amount: 1000n, currentAllowance: 999n, permit2Spender: f.identity.contracts.universalRouter.address });
    expect(f.client.call).not.toHaveBeenCalled();
    f.allowance.amount = 1000n;
    const prepared = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
    if (prepared.kind !== "swap") throw new Error("Exact allowance should fund the sell");
    f.allowance.expiration = Number(f.state.timestamp);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("Sell allowance changed");
  });

  it("reuses only the verified Any Quote approval checkpoint without repeating source and launch reads", async () => {
    const f = tradeFixture(false); f.allowance.amount = 0n;
    const required = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
    if (required.kind !== "approval-required") throw new Error("Expected finite approval");
    const reads = () => vi.mocked(f.client.readContract).mock.calls.filter(([input]) => ["SOURCE_VERSION", "launchIdOf", "getLaunch"].includes(input.functionName)).length;
    const before = reads(), logs = vi.mocked(f.client.getLogs!).mock.calls.length;
    vi.mocked(f.client.call).mockResolvedValue({ data: "0x" });
    const prepared = await prepareModuleEngineAnyQuoteApproval({ ...f, account: ACCOUNT, required });
    expect(prepared).toMatchObject({ kind: "approve", allowanceKind: "permit2", amount: 1000n, blockNumber: 100n,
      spender: ANY_QUOTE_INFRASTRUCTURE.permit2, permit2Spender: f.release.contracts.universalRouter.address });
    expect(reads()).toBe(before); expect(vi.mocked(f.client.getLogs!).mock.calls).toHaveLength(logs);
    expect(f.client.call).toHaveBeenCalledWith(expect.objectContaining({ to: ANY_QUOTE_INFRASTRUCTURE.permit2, blockNumber: 100n }));
    expect(f.client.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ to: ANY_QUOTE_INFRASTRUCTURE.permit2, blockNumber: 100n }));
    await expect(prepareModuleEngineAnyQuoteApproval({ ...f, account: ACCOUNT, required })).rejects.toThrow("approval context");
    const sourceReads = reads();
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).resolves.toEqual(prepared.transaction);
    expect(reads()).toBeGreaterThan(sourceReads); // Wallet-boundary validation still reads the current release.
  });

  it.each(["copied", "account", "release", "client", "stale", "chain", "reorg"] as const)("rejects a %s Any Quote approval context", async mutation => {
    const f = tradeFixture(false); f.allowance.amount = 0n;
    const required = await prepareModuleEngineAnyQuoteSwap({ ...f, account: ACCOUNT });
    if (required.kind !== "approval-required") throw new Error("Expected finite approval");
    vi.mocked(f.client.call).mockClear();
    const input = { client: f.client, release: f.release, account: ACCOUNT, required };
    if (mutation === "copied") input.required = { ...required };
    if (mutation === "account") input.account = addr(999);
    if (mutation === "release") input.release = { ...f.release, lifecycleEvidenceDigest: hash(999) };
    if (mutation === "client") input.client = { ...f.client };
    if (mutation === "chain") vi.mocked(f.client.getChainId).mockResolvedValue(1);
    if (mutation === "reorg") vi.mocked(f.client.getBlock).mockResolvedValue({ number: 100n, hash: hash(999), timestamp: f.state.timestamp } as never);
    const clock = mutation === "stale" ? vi.spyOn(Date, "now").mockReturnValue(Number(f.state.timestamp + 121n) * 1000) : null;
    try { await expect(prepareModuleEngineAnyQuoteApproval(input)).rejects.toThrow(); }
    finally { clock?.mockRestore(); }
    expect(f.client.call).not.toHaveBeenCalled();
  });

  it("matches the final AnyQuote host token graffiti domain while preserving native token predictions", async () => {
    const f = sharedFixture(), compiled = await compileModuleEngineLaunch({ ...f.launchInput, configuration: {}, anyQuotePreparation: f.preview }, f.release, f.template.manifest, 36, BigInt(f.preview.validUntil));
    const expectedGraffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.any-quote-token.v1", ACCOUNT, f.intent.creatorSalt]));
    const expectedToken = getCreate2Address({ from: f.release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [f.intent.name, f.intent.symbol, 18, f.host, expectedGraffiti])), bytecodeHash: f.release.tokenCreationCodeHash });
    expect(compiled.graffiti).toBe(expectedGraffiti); expect(compiled.predictedToken).toBe(expectedToken.toLowerCase()); expect(f.preview.predictedToken).toBe(expectedToken.toLowerCase());
    const native = fixture(), nativePlan = await compileModuleEngineLaunch(native.launchInput, native.release, native.template.manifest, 6, native.state.timestamp + 120n);
    expect(nativePlan.graffiti).toBe(keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.token.v1", ACCOUNT, native.launchInput.creatorSalt])));
  });
  it("compiles signed price config with 36 decimals, optional zero buy and ledger context without mining the LP engine", async () => {
    const f = sharedFixture(), compiled = await compileModuleEngineLaunch({ ...f.launchInput, configuration: {}, anyQuotePreparation: f.preview }, f.release, f.template.manifest, 36, BigInt(f.preview.validUntil));
    expect(compiled.engine).toBe(predictModuleEngineAddress(f.host, ACCOUNT, f.launchInput.engineSalt, compiled.launchId, compiled.initCodeHash));
    expect(compiled.context.feeCollector).toBe(f.release.contracts.ledger.address);
    expect(compiled.initialOperation.inputAmount).toBe(0n);
    expect(compiled.parameters.configuration.length).toBe(514);
    expect(decodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,address,address,int24,uint64,bytes32"), compiled.parameters.configuration)[5]).toBe(f.preview.initialTick);
    expect(assertAnyQuoteLaunchPreparation(f.preview, f.intent, f.release, f.state.timestamp)).toBe(f.preview);
  });
  it.each(["account", "quoteAsset", "buyCreatorFeeBps", "creatorSalt", "engineSalt", "initialBuyWei"])("rejects a preview reused after %s changes", key => {
    const f = sharedFixture(), value = key === "buyCreatorFeeBps" ? 100 : key === "initialBuyWei" ? "1" : key.includes("Salt") ? hash(666) : addr(666);
    expect(() => assertAnyQuoteLaunchPreparation(f.preview, { ...f.intent, [key]: value }, f.release, f.state.timestamp)).toThrow("MISMATCH");
  });
  it("rejects expired or substituted quote configuration and old profile bypasses", () => {
    const f = sharedFixture();
    expect(() => assertAnyQuoteConfiguration({ configuration: f.preview.configuration, release: f.release, quoteAsset: QUOTE, now: BigInt(f.preview.validUntil), validUntil: BigInt(f.preview.validUntil) })).toThrow();
    expect(() => assertAnyQuoteConfiguration({ configuration: f.preview.configuration, release: fixture().release, quoteAsset: QUOTE, now: f.state.timestamp, validUntil: BigInt(f.preview.validUntil) })).toThrow();
    expect(() => assertAnyQuoteConfiguration({ configuration: f.preview.configuration, release: f.release, quoteAsset: addr(12), now: f.state.timestamp, validUntil: BigInt(f.preview.validUntil) })).toThrow();
  });
  it("floors only the final output for slippage and rejects dust", () => {
    expect(anyQuoteMinimumOutput(1001n, 100)).toBe(990n);
    expect(() => anyQuoteMinimumOutput(1n, 100)).toThrow("OUTPUT_TOO_SMALL");
    expect(() => anyQuoteMinimumOutput(100n, 1001)).toThrow("INVALID_SLIPPAGE");
  });
  it("prepares the same financial launch intent through the API without initial quote holdings", async () => {
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99)), preview = await readAnyQuoteLaunchPreview({ ...f.intent, description: "Quote launch" }, {
      client: f.client, availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => f.preview.readiness,
      options: { rpcs: settlement.rpcs },
    });
    expect(preview.initialBuy).toBeNull(); expect(preview.intent.initialBuyWei).toBe("0");
    expect(preview).toMatchObject({ schemaVersion: "programmable.any-quote.launch-preview.v2", executionDeadline: (f.state.timestamp + 180n).toString(), validUntil: (f.state.timestamp + 45n).toString(), initialTick: f.preview.initialTick });
    expect(assertAnyQuoteLaunchPreparation(preview, f.intent, f.release, f.state.timestamp)).toBe(preview);
    expect(f.client.call).not.toHaveBeenCalled();
    expect(settlement.calls.some(call => call.method === "debug_traceCall")).toBe(true);
  });
  it.each([true, false])("pins initial-buy traces to the canonical hash and closes unsupported providers (supported=%s)", async supported => {
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99));
    const initialTraces: unknown[][] = [];
    const rpcs = settlement.rpcs.map(provider => (async (method, params) => {
      const tx = params[0] as { from?: Address; to?: Address; data?: Hex; value?: Hex };
      if (method !== "debug_traceCall" || tx.to?.toLowerCase() !== f.host.toLowerCase()) return provider(method, params);
      initialTraces.push([...params]);
      expect(params[1]).toEqual({ blockHash: f.preview.readiness.checkpoint.hash, requireCanonical: true });
      if (!supported) throw new Error("Hash reference unsupported");
      return { type: "CALL", ...tx, input: tx.data, output: "0x", gasUsed: "0x100", calls: [
        { type: "CALL", from: f.identity.contracts.poolManager.address, to: f.preview.predictedToken, value: "0x0", gasUsed: "0x10",
          input: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ACCOUNT, 2000n] }), output: encodeFunctionResult({ abi: erc20Abi, functionName: "transfer", result: true }) },
      ] };
    }) satisfies TradeRpcV1) as unknown as readonly [TradeRpcV1, TradeRpcV1];
    const result = readAnyQuoteIdentityLaunchPreviewV1({ ...f.intent, identity: f.identity, template: f.template, initialBuyWei: "1000", description: "Canonical initial buy" }, {
      client: f.client, readiness: async () => f.preview.readiness, options: { rpcs },
    });
    if (supported) await expect(result).resolves.toMatchObject({ initialBuy: { output: "2000", minimumOutput: "1980" } });
    else await expect(result).rejects.toMatchObject({ code: "TRADE_ANALYSIS_PENDING", status: 503 });
    expect(initialTraces).toHaveLength(2);
  });
  it.each(["taxed", "restricted", "unfunded"])("closes zero-buy launch preview when quote settlement is %s", async kind => {
    const f = sharedFixture(), settlement = settlementRpcFixture(f.preview.readiness.routes.buy, addr(99));
    if (kind === "taxed") settlement.state.recipientAdjustment = -1n;
    if (kind === "restricted") settlement.state.failed = true;
    if (kind === "unfunded") settlement.state.balance = 0n;
    await expect(readAnyQuoteLaunchPreview({ ...f.intent, description: "Zero buy settlement gate" }, {
      client: f.client, availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => f.preview.readiness, options: { rpcs: settlement.rpcs },
    })).rejects.toMatchObject({ status: kind === "taxed" ? "incompatible" : "inconclusive" });
    expect(f.intent.initialBuyWei).toBe("0"); expect(f.client.call).not.toHaveBeenCalled();
  });
  it.each(["incompatible", "inconclusive"] as const)("keeps %s readiness distinct in the public API", async status => {
    const f = sharedFixture(), result = { status, chainId: 4663 as const, quoteAsset: QUOTE, code: status === "incompatible" ? "UNSUPPORTED_TOKEN_DECIMALS" : "PROVIDER_UNAVAILABLE", retryable: status === "inconclusive" };
    expect(await readAnyQuoteReadiness({ releaseDigest: f.release.releaseDigest, templateId: f.intent.templateId, quoteAsset: QUOTE }, {
      availability: async () => ({ ...f.availability, release: f.release }), readiness: async () => result,
    })).toEqual(result);
  });
  it("never exposes provider details as token incompatibility", async () => {
    const response = await anyQuoteJsonRequest(new Request("https://programmable.market/api/module-mode/any-quote/launch-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), async () => { throw new Error("private-provider-detail"); });
    expect(response.status).toBe(503);
    const body = await response.json(); expect(body).toMatchObject({ status: "inconclusive", retryable: true, quoteAsset: null });
    expect(JSON.stringify(body)).not.toContain("private-provider-detail");
  });
  it("reads and claims the quote ledger without native fee selectors", async () => {
    const f = sharedFixture();
    const admin = await readModuleEngineAdministration({ ...f, account: ACCOUNT, token: TOKEN });
    expect(admin.fees).toMatchObject({ feeAsset: QUOTE, claimable: 9n, buyPlatformBps: 30, sellPlatformBps: 30 });
    const prepared = await prepareModuleEngineClaim({ ...f, account: ACCOUNT, token: TOKEN, recipient: ACCOUNT });
    expect(prepared.feeAsset).toBe(QUOTE);
    expect(decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: prepared.transaction.data })).toMatchObject({ functionName: "claimQuoteTo", args: [getAddress(QUOTE), ACCOUNT] });
    f.state.claimable = 8n;
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("Fee balance changed");
  });
  it("rotates only future platform credits with exact current beneficiary authority and preserves provenance", async () => {
    const f = sharedFixture(), snapshot = await readModuleEngineFeeControls({ ...f, account: addr(99), token: TOKEN });
    expect(snapshot.authors).toEqual([]); expect(snapshot.quoteFees).toBe(true);
    await expect(prepareModuleEngineFeeChange({ ...f, account: ACCOUNT, token: TOKEN, intent: { kind: "rotate-platform", recipient: addr(111) } })).rejects.toThrow("authority");
    const prepared = await prepareModuleEngineFeeChange({ ...f, account: addr(99), token: TOKEN, intent: { kind: "rotate-platform", recipient: addr(111) } });
    expect(decodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, data: prepared.transaction.data })).toMatchObject({ functionName: "changePlatformWallet", args: [getAddress(addr(111))] });
    f.setPlatformWallet(addr(112));
    await expect(revalidateModuleEngineTransaction(prepared, addr(99))).rejects.toThrow("changed");
    expect(f.state.claimable).toBe(9n);
  });
  it("requires the initial ETH buy output and consumed nonce when confirming an AnyQuote launch", async () => {
    const f = sharedFixture(), compiled = await compileModuleEngineLaunch({ ...f.launchInput, configuration: {}, anyQuotePreparation: f.preview }, f.release, f.template.manifest, 36, BigInt(f.preview.validUntil));
    const operation = { operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, actor: ACCOUNT, recipient: ACCOUNT, inputAsset: ANY_QUOTE_NATIVE, inputAmount: 1000n, outputAsset: TOKEN, minimumOutput: 990n, deadline: BigInt(f.preview.validUntil), nonce: 0n, data: "0x1234" as Hex };
    const parameters = { ...compiled.parameters, initialOperation: operation };
    f.launch.planHash = keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, f.host, ACCOUNT, parameters]));
    const log = (eventName: string, args: Record<string, unknown>) => {
      const event = moduleEngineHostAbi.find(item => item.type === "event" && item.name === eventName); if (event?.type !== "event") throw new Error("Missing event fixture");
      return { address: f.host, transactionHash: hash(200), blockNumber: 100n, blockHash: f.blockHash, removed: false,
        topics: encodeEventTopics({ abi: moduleEngineHostAbi, eventName, args } as never), data: encodeAbiParameters(event.inputs.filter(item => !item.indexed), event.inputs.filter(item => !item.indexed).map(item => args[item.name!])) };
    };
    const logs = [log("EngineLaunchBound", { ...f.launch, runtimeCodeHash: f.launch.engineCodeHash, economicsPolicyId: f.release.economicsPolicyId }),
      log("EngineLaunchParametersBound", { launchId: f.launch.launchId, encodedParameters: encodeAbiParameters(moduleEngineLaunchParameters, [parameters]) }),
      log("EngineOperationExecuted", { ...operation, launchId: f.launch.launchId, outputAmount: 1000n, resultHash: keccak256(operation.data) })];
    const receipt = { status: "success", transactionHash: hash(200), blockNumber: 100n, blockHash: f.blockHash, logs } as unknown as TransactionReceipt;
    f.state.nonce = 1n;
    await expect(verifyModuleEngineLaunchReceipt({ ...f, expected: f.launch, receipt })).resolves.toMatchObject({ kind: "launch", outputAmount: 1000n, finalized: false });
    f.state.nonce = 0n;
    await expect(verifyModuleEngineLaunchReceipt({ ...f, expected: f.launch, receipt })).rejects.toThrow("nonce was not consumed");
    f.state.nonce = 1n;
    await expect(verifyModuleEngineLaunchReceipt({ ...f, expected: f.launch, receipt: { ...receipt, logs: receipt.logs.slice(0, 2) } })).rejects.toThrow("exactly one");
  });
});
