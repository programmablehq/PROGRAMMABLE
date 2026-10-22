import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { bindCustomAILaunch, CUSTOM_AI_BUNDLE_HASH, customAIPlanHash, customAIPriceTypedData,
  planCustomAIPrice, predictCustomAIToken, type LaunchParameters } from "../lib/custom-ai/launch-plan";
import { readLaunchJournal, sendCustomAILaunch, type LaunchStorage } from "../lib/custom-ai/wallet";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
const factory = "0x2000000000000000000000000000000000000002" as Address;
const quote = "0x3000000000000000000000000000000000000003" as Address;
const hash = `0x${"22".repeat(32)}` as Hex;
const now = 1800000000n;
async function fixture() {
  const p: LaunchParameters = { metadata: { name: "Example", symbol: "EX", description: "", imageURI: "ipfs://example", website: "", socialData: "0x" },
    quote, quoteDecimals: 18, initialTick: 0, launchSalt: hash, hookSalt: hash,
    feeModule: { instance: factory, runtimeHash: hash, configurationHash: hash },
    rewards: { creatorRecipient: owner.address, creatorShareBps: 10000, module: { instance: zeroAddress, runtimeHash: zeroHash, configurationHash: zeroHash } },
    initialBuyQuote: 30n * 10n ** 18n, minimumBuyTokens: 1n, maximumFeeBps: 1500, deadline: now + 120n };
  const predictedToken = predictCustomAIToken(factory, owner.address, p);
  p.initialTick = planCustomAIPrice(predictedToken, quote, 18, 10n ** 18n).initialTick;
  const price = { quoteUsdE18: 10n ** 18n, ethUsdE18: 3000n * 10n ** 18n, observedAt: now, validUntil: now + 120n };
  const order = await bindCustomAILaunch({ chainId: 1, factory, account: owner.address, parameters: p, predictedToken, price,
    sourceHash: "a".repeat(64), artifactHash: "b".repeat(64), coreBundleHash: CUSTOM_AI_BUNDLE_HASH, priceSigner: owner.address,
    signature: await owner.signTypedData(customAIPriceTypedData(1, factory, customAIPlanHash(1, factory, owner.address, p), price)) }, now);
  const data = new Map<string, string>();
  const storage: LaunchStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
  const send = vi.fn(async () => hash);
  const provider = { request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x1"
    : method === "eth_accounts" ? [owner.address] : send()) };
  const canonical = vi.fn(async () => ({ state: "not-sent" as const, canSend: true }));
  return { order, storage, provider, canonical, send, data, lock: async <T>(_key: string, fn: () => Promise<T>) => fn(), now: () => Number(now) * 1000 };
}

describe("Custom AI wallet dispatch", () => {
  it("saves the exact intent before opening the wallet and never dispatches twice", async () => {
    const f = await fixture();
    f.send.mockImplementation(async () => {
      expect(readLaunchJournal(f.storage, 1, owner.address)?.state).toBe("dispatching");
      return hash;
    });
    expect((await sendCustomAILaunch(f)).state).toBe("submitted");
    await expect(sendCustomAILaunch(f)).rejects.toThrow("network check");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("retains ambiguous requests across a reload", async () => {
    const f = await fixture(); f.send.mockRejectedValueOnce(Error("disconnect"));
    await expect(sendCustomAILaunch(f)).rejects.toThrow("unclear");
    expect(readLaunchJournal(f.storage, 1, owner.address)?.state).toBe("dispatching");
    await expect(sendCustomAILaunch(f)).rejects.toThrow("network check");
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it("allows an explicit retry after wallet rejection, only with a fresh canonical check", async () => {
    const f = await fixture(); f.send.mockRejectedValueOnce({ code: 4001 });
    await expect(sendCustomAILaunch(f)).rejects.toThrow("cancelled");
    expect(readLaunchJournal(f.storage, 1, owner.address)?.state).toBe("rejected");
    await sendCustomAILaunch(f);
    expect(f.canonical).toHaveBeenCalledTimes(2);
  });
  it("stops before dispatch on storage, account, network, lock or price errors", async () => {
    for (const mode of ["storage", "account", "network", "lock", "price"]) {
      const f = await fixture();
      if (mode === "storage") f.storage.setItem = () => { throw Error("full"); };
      if (mode === "account") f.provider.request.mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x1" : [factory]);
      if (mode === "network") f.provider.request.mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x1237" : [owner.address]);
      if (mode === "lock") f.lock = async () => { throw Error("locked"); };
      if (mode === "price") f.now = () => Number(now + 130n) * 1000;
      await expect(sendCustomAILaunch(f)).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled();
    }
  });
  it("uses canonical completion without opening the wallet, including after expiry", async () => {
    const f = await fixture(); f.now = () => Number(now + 500n) * 1000;
    const result = await sendCustomAILaunch({ ...f, canonical: async () => ({ state: "confirmed", canSend: false }) });
    expect(result.state).toBe("confirmed"); expect(f.provider.request).not.toHaveBeenCalled();
  });
  it("does not discard malformed persisted state", async () => {
    const f = await fixture(); await sendCustomAILaunch(f);
    for (const k of f.data.keys()) f.data.set(k, "broken");
    await expect(sendCustomAILaunch(f)).rejects.toThrow("recovery"); expect(f.send).toHaveBeenCalledTimes(1);
  });
});
