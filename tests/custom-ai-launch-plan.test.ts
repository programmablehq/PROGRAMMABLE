import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { encodeFunctionData, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bindCustomAILaunch, CUSTOM_AI_BUNDLE_HASH, predictCustomAIToken, customAIOrderMatchesTransaction, customAIPlanHash, customAIPriceTypedData,
  customAIPriceBounds, planCustomAIPrice, reconcileCustomAILaunch, type LaunchParameters, type LaunchOrder, type LaunchPrice } from "../lib/custom-ai/launch-plan";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const factory = "0x2000000000000000000000000000000000000002" as Address;
const token = "0x1000000000000000000000000000000000000001" as Address;
const quote = "0x3000000000000000000000000000000000000003" as Address;
const hash = `0x${"22".repeat(32)}` as Hex;
const now = 1800000000n;
const empty = { instance: zeroAddress, runtimeHash: zeroHash, configurationHash: zeroHash };
const parameters = (): LaunchParameters => ({ metadata: { name: "Example", symbol: "EX", description: "", imageURI: "ipfs://example", website: "", socialData: "0x" },
  quote, quoteDecimals: 18, initialTick: -111060, launchSalt: hash, hookSalt: hash,
  feeModule: { instance: factory, runtimeHash: hash, configurationHash: hash },
  rewards: { creatorRecipient: account.address, creatorShareBps: 10000, module: empty },
  initialBuyQuote: 30n * 10n ** 18n, minimumBuyTokens: 1n, maximumFeeBps: 1500, deadline: now + 120n });
async function signedInput(changes: Partial<LaunchParameters> = {}, priceChanges: Partial<LaunchPrice> = {}) {
  const params = { ...parameters(), ...changes };
  const price = { quoteUsdE18: 10n ** 18n, ethUsdE18: 3000n * 10n ** 18n, observedAt: now, validUntil: now + 120n, ...priceChanges };
  const predictedToken = predictCustomAIToken(factory, account.address, params);
  params.initialTick = planCustomAIPrice(predictedToken, params.quote, params.quoteDecimals, price.quoteUsdE18).initialTick;
  const planHash = customAIPlanHash(1, factory, account.address, params);
  return { chainId: 1 as const, factory, account: account.address, parameters: params, price, predictedToken,
    signature: await account.signTypedData(customAIPriceTypedData(1, factory, planHash, price)), priceSigner: account.address,
    sourceHash: "a".repeat(64), artifactHash: "b".repeat(64), coreBundleHash: CUSTOM_AI_BUNDLE_HASH };
}
const observation = (order: LaunchOrder) => ({ chainId: order.chainId, factory, account: account.address, launchSalt: order.parameters.launchSalt,
  finalizedPlanHash: zeroHash, finalizedToken: zeroAddress, dispatch: "not-sent" as const });

describe("Custom AI wallet order", () => {
  it("requires the signed ETH-equivalent minimum even with an otherwise valid signature", async () => {
    const minimum = 30n * 10n ** 18n;
    for (const amount of [0n, minimum - 1n]) {
      await expect(bindCustomAILaunch(await signedInput({ initialBuyQuote: amount }), now)).rejects.toThrow();
    }
    for (const amount of [minimum, minimum + 1n, 100000n * 10n ** 18n]) {
      expect((await bindCustomAILaunch(await signedInput({ initialBuyQuote: amount }), now)).parameters.initialBuyQuote).toBe(amount);
    }
    const input = await signedInput(); input.price.ethUsdE18 -= 1n;
    await expect(bindCustomAILaunch(input, now)).rejects.toThrow("signature");
  });
  it("rounds a six-decimal quote up before binding a wallet request", async () => {
    const price = { quoteUsdE18: 3n * 10n ** 18n, ethUsdE18: 2500n * 10n ** 18n };
    await expect(bindCustomAILaunch(await signedInput({ quoteDecimals: 6, initialBuyQuote: 8333333n }, price), now)).rejects.toThrow("8.333334");
    await expect(bindCustomAILaunch(await signedInput({ quoteDecimals: 6, initialBuyQuote: 8333334n }, price), now)).resolves.toHaveProperty("version", 1);
  });
  it("encodes the actual compiled factory ABI and isolates the stored parameters", async () => {
    const input = await signedInput();
    const order = await bindCustomAILaunch(input, now);
    const actual = JSON.parse(readFileSync(new URL("../contracts/out/custom-ai/CustomAIFactoryV1.sol/CustomAIFactoryV1.json", import.meta.url), "utf8"));
    expect(order.transaction.data).toBe(encodeFunctionData({ abi: actual.abi, functionName: "launch", args: [input.parameters, input.price, input.signature] }));
    input.parameters.metadata.name = "Changed";
    expect(order.parameters.metadata.name).toBe("Example");
    expect(reconcileCustomAILaunch(order, observation(order), now)).toEqual({ state: "not-sent", canSend: true });
  });
  it("rejects a valid signature after changing the account, chain, factory, amount or metadata", async () => {
    for (const change of [{ account: factory }, { chainId: 4663 as const }, { factory: quote },
      { parameters: { ...parameters(), initialBuyQuote: 1n, minimumBuyTokens: 1n } },
      { parameters: { ...parameters(), metadata: { ...parameters().metadata, name: "Another" } } }]) {
      await expect(bindCustomAILaunch({ ...await signedInput(), ...change }, now)).rejects.toThrow();
    }
  });
  it("rejects stale prices, unsupported chains, invalid limits and a mismatched predicted token", async () => {
    await expect(bindCustomAILaunch(await signedInput(), now + 121n)).rejects.toThrow("Refresh");
    await expect(bindCustomAILaunch({ ...await signedInput(), chainId: 8453 as 1 }, now)).rejects.toThrow();
    await expect(bindCustomAILaunch({ ...await signedInput(), predictedToken: factory }, now)).rejects.toThrow("predicted coin");
    await expect(bindCustomAILaunch({ ...await signedInput(), predictedToken: "0x4000000000000000000000000000000000000004" }, now)).rejects.toThrow("predicted coin");
    await expect(bindCustomAILaunch({ ...await signedInput(), parameters: { ...parameters(), initialBuyQuote: 0n } }, now)).rejects.toThrow("limits");
  });
  it("reconciles ambiguous sends and canonical completion without a second transaction", async () => {
    const order = await bindCustomAILaunch(await signedInput(), now);
    expect(reconcileCustomAILaunch(order, { ...observation(order), dispatch: "uncertain" }, now)).toEqual({ state: "pending", canSend: false });
    expect(reconcileCustomAILaunch(order, { ...observation(order), dispatch: "submitted", receipt: "reverted" }, now)).toEqual({ state: "failed", canSend: false });
    expect(reconcileCustomAILaunch(order, observation(order), now + 121n)).toEqual({ state: "expired", canSend: false });
    expect(reconcileCustomAILaunch(order, { ...observation(order), finalizedToken: order.predictedToken, finalizedPlanHash: order.planHash }, now + 1000n)).toEqual({ state: "confirmed", canSend: false });
    expect(reconcileCustomAILaunch(order, { ...observation(order), finalizedToken: order.predictedToken, finalizedPlanHash: hash }, now)).toEqual({ state: "conflict", canSend: false });
    expect(reconcileCustomAILaunch(order, { ...observation(order), chainId: 4663 }, now).canSend).toBe(false);
    const tampered = { ...order, parameters: { ...order.parameters, maximumFeeBps: 1499 } };
    expect(reconcileCustomAILaunch(tampered, observation(order), now).state).toBe("conflict");
  });
  it("matches transaction values exactly while accepting address and calldata casing", async () => {
    const order = await bindCustomAILaunch(await signedInput(), now);
    const tx = { from: account.address, to: factory, input: order.transaction.data, value: 0n, chainId: 1 };
    expect(customAIOrderMatchesTransaction(order, tx)).toBe(true);
    for (const change of [{ from: factory }, { to: null }, { chainId: 4663 }, { value: 1n }, { input: "0x" as Hex }]) {
      expect(customAIOrderMatchesTransaction(order, { ...tx, ...change })).toBe(false);
    }
  });
});

describe("Custom AI conservative starting price", () => {
  it("matches the core's known $1 quote ticks in both orderings", () => {
    for (const [decimals, magnitude] of [[18, 111060], [6, 387360]]) {
      expect(planCustomAIPrice(token, quote, decimals, 10n ** 18n).initialTick).toBe(-magnitude);
      expect(planCustomAIPrice(quote, token, decimals, 10n ** 18n).initialTick).toBe(magnitude);
    }
  });
  it("chooses the first qualifying tick with no downward rounding at diverse prices", () => {
    for (const decimals of [6, 8, 18, 24, 36]) for (const usd of [10n ** 12n, 10n ** 18n, 2750123456789000000000n]) for (const token0 of [true, false]) {
      const p = planCustomAIPrice(token0 ? token : quote, token0 ? quote : token, decimals, usd);
      expect(p.lower).toBeGreaterThanOrEqual(15000n * 10n ** 18n);
      expect(p.upper).toBeLessThanOrEqual(150915n * 10n ** 17n);
      expect(customAIPriceBounds(token0, p.initialTick + (token0 ? -60 : 60), decimals, usd).lower).toBeLessThan(15000n * 10n ** 18n);
    }
  });
});
