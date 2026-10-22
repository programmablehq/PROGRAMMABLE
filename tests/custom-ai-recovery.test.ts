import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const registered = vi.hoisted(() => ({ factory: { address: "0x2000000000000000000000000000000000000002" } }));
vi.mock("../lib/custom-ai/deployment.server", () => ({ currentCustomAIDeployment: () => registered, verifyCustomAIDeployment: async () => undefined }));
import { encodeFunctionResult, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bindCustomAILaunch, CUSTOM_AI_BUNDLE_HASH, customAIFactoryAbi, customAIPlanHash, customAIPriceTypedData,
  planCustomAIPrice, predictCustomAIToken, type LaunchParameters } from "../lib/custom-ai/launch-plan";
import { readCustomAILaunchState } from "../lib/custom-ai/recovery.server";
import type { CustomAIChain } from "../lib/custom-ai/chain.server";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const factory = registered.factory.address as Address;
const hash = `0x${"22".repeat(32)}` as Hex, recent = `0x${"33".repeat(32)}` as Hex;
const now = 1800000000n;
async function fixture() {
  const p: LaunchParameters = { metadata: { name: "Example", symbol: "EX", description: "", imageURI: "ipfs://example", website: "", socialData: "0x" },
    quote: "0x3000000000000000000000000000000000000003", quoteDecimals: 18, initialTick: 0, launchSalt: hash, hookSalt: hash,
    feeModule: { instance: factory, runtimeHash: hash, configurationHash: hash },
    rewards: { creatorRecipient: account.address, creatorShareBps: 10000, module: { instance: zeroAddress, runtimeHash: zeroHash, configurationHash: zeroHash } },
    initialBuyQuote: 30n * 10n ** 18n, minimumBuyTokens: 1n, maximumFeeBps: 1500, deadline: now + 120n };
  const predictedToken = predictCustomAIToken(factory, account.address, p);
  p.initialTick = planCustomAIPrice(predictedToken, p.quote, 18, 10n ** 18n).initialTick;
  const price = { quoteUsdE18: 10n ** 18n, ethUsdE18: 3000n * 10n ** 18n, observedAt: now, validUntil: now + 120n };
  const order = await bindCustomAILaunch({ chainId: 1, factory, account: account.address, parameters: p, predictedToken, price,
    sourceHash: "a".repeat(64), artifactHash: "b".repeat(64), coreBundleHash: CUSTOM_AI_BUNDLE_HASH, priceSigner: account.address,
    signature: await account.signTypedData(customAIPriceTypedData(1, factory, customAIPlanHash(1, factory, account.address, p), price)) }, now);
  const empty = { planHash: zeroHash as Hex, poolId: zeroHash, token: zeroAddress as Address, hook: zeroAddress, ledger: zeroAddress,
    rewardVault: zeroAddress, liquidityVault: zeroAddress, liquidity: 0n, tokenPrincipal: 0n, tokenRounding: 0n, initialBuyTokens: 0n };
  const state = { latest: empty, finalized: empty, mismatch: false };
  const rpc = async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getBlockByNumber") return { number: "0x5a", hash, timestamp: "0x6b49d200" };
    if (method === "eth_call") {
      const final = (params[1] as { blockHash: string }).blockHash === hash;
      return encodeFunctionResult({ abi: customAIFactoryAbi, functionName: "launchOf", result: final ? state.finalized : state.latest });
    }
    if (method === "eth_getTransactionByHash") return { hash, from: account.address, to: factory,
      input: state.mismatch ? "0x00" : order.transaction.data, value: "0x0", chainId: "0x1" };
    if (method === "eth_getTransactionReceipt") return null;
    throw Error("Unexpected network method");
  };
  const chain = { block: { number: "100", hash: recent }, rpcs: [rpc, rpc], finish: async () => undefined,
    agreed: async (method: string, params: readonly unknown[], parse: (v: unknown) => unknown) => parse(await rpc(method, params)) } as unknown as CustomAIChain;
  const completed = { ...empty, planHash: order.planHash, token: order.predictedToken };
  return { order, chain, state, completed };
}
beforeEach(() => vi.setSystemTime(Number(now) * 1000));
afterEach(() => vi.useRealTimers());

describe("Custom AI canonical recovery", () => {
  it("keeps a mined launch pending until the independent finalized state contains it", async () => {
    const f = await fixture(); f.state.latest = f.completed;
    expect(await readCustomAILaunchState(f.order, null, f.chain)).toEqual({ state: "pending", canSend: false });
    f.state.finalized = f.completed;
    expect(await readCustomAILaunchState(f.order, null, f.chain)).toEqual({ state: "confirmed", canSend: false });
  });
  it("never resends an unknown dispatch or an observed different transaction", async () => {
    const f = await fixture();
    expect(await readCustomAILaunchState(f.order, { version: 1, order: f.order, state: "dispatching", updatedAt: 0 }, f.chain)).toEqual({ state: "pending", canSend: false });
    f.state.mismatch = true;
    expect(await readCustomAILaunchState(f.order, { version: 1, order: f.order, state: "submitted", transactionHash: hash, updatedAt: 0 }, f.chain)).toEqual({ state: "conflict", canSend: false });
  });
  it("rejects a different plan in current or finalized state", async () => {
    const f = await fixture(); f.state.latest = { ...f.completed, planHash: hash };
    expect((await readCustomAILaunchState(f.order, null, f.chain)).state).toBe("conflict");
    f.state.finalized = f.state.latest;
    expect((await readCustomAILaunchState(f.order, null, f.chain)).state).toBe("conflict");
  });
});
