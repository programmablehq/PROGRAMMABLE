import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const readLaunch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/hyperevm-explore", () => ({ readHyperEvmLaunchEvidence: readLaunch }));
import { estimateHyperEvmGas, prepareHyperEvmSwap, readHyperEvmSwapCheckpoint, readHyperEvmRpcAgreement } from "@/lib/server/swap/evm-custom";

describe("HyperEVM receipt coordinates", () => {
  const transactionHash = `0x${"ab".repeat(32)}`, blockHash = `0x${"cd".repeat(32)}`;
  const receipt = (transactionIndex: string, logIndex: string) => ({ transactionHash, blockHash, blockNumber: "0x64", status: "0x1", transactionIndex,
    logs: [{ transactionHash, blockHash, blockNumber: "0x64", transactionIndex, logIndex, removed: false,
      address: `0x${"11".repeat(20)}`, topics: [`0x${"22".repeat(32)}`], data: "0x1234" }] });

  it("accepts equivalent events with system-transaction offsets and retains raw coordinates", async () => {
    const first = receipt("0x6", "0x11"), second = receipt("0x5", "0x10");
    const result = await readHyperEvmRpcAgreement([async () => first, async () => second], "eth_getTransactionReceipt", [transactionHash]);
    expect(result).toBe(first);
    expect(first.logs[0].logIndex).toBe("0x11");
  });

  it.each(["data", "blockHash", "transactionIndex", "removed"] as const)("rejects changed or inconsistent %s", async field => {
    const first = receipt("0x6", "0x11"), second = receipt("0x5", "0x10");
    Object.assign(second.logs[0], { [field]: field === "data" ? "0x5678" : field === "blockHash" ? `0x${"ee".repeat(32)}` : field === "transactionIndex" ? "0xff" : true });
    await expect(readHyperEvmRpcAgreement([async () => first, async () => second], "eth_getTransactionReceipt", [transactionHash])).rejects.toThrow();
  });
});

describe("HyperEVM provider block agreement", () => {
  const hash = `0x${"ab".repeat(32)}`;
  const block = () => ({ number: "0x64", hash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, size: "0xacc" });
  const provider = (value: ReturnType<typeof block>) => vi.fn(async (method: string) => method === "eth_blockNumber" ? "0x64" : value);

  it("accepts the same block when providers report different serialized sizes", async () => {
    const first = block();
    const primary = provider(first), secondary = provider({ ...first, size: "0x77d" });
    expect(await readHyperEvmSwapCheckpoint([primary, secondary])).toEqual({ number: 100n, hash });
    expect(primary).toHaveBeenCalledTimes(2);
    expect(secondary).toHaveBeenCalledTimes(2);
  });

  it.each(["hash", "number", "timestamp"] as const)("rejects differing %s even when size differs", async field => {
    const first = block(), second = { ...first, size: "0x77d", [field]: field === "hash" ? `0x${"cd".repeat(32)}` : "0x65" };
    await expect(readHyperEvmSwapCheckpoint([provider(first), provider(second)])).rejects.toThrow("Chain data is updating");
  });

  it("rejects a shared response for a different requested block", async () => {
    await expect(readHyperEvmSwapCheckpoint([provider({ ...block(), number: "0x65" }), provider({ ...block(), number: "0x65" })])).rejects.toThrow("HyperEVM data is temporarily stale");
  });
});

describe("HyperEVM transaction gas estimation", () => {
  const transaction = {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    data: "0x1234", value: "0x0",
  } as const;

  it("uses the supported wire shape and pads the larger provider estimate", async () => {
    const primary = vi.fn(async (_method: string, params: readonly unknown[]) => {
      if (params.length !== 1) throw new Error("execution reverted");
      return "0x186a0";
    });
    const secondary = vi.fn(async () => "0x1d4c0");
    expect(await estimateHyperEvmGas([primary, secondary], transaction)).toBe(144000n);
    for (const rpc of [primary, secondary]) {
      expect(rpc).toHaveBeenCalledExactlyOnceWith("eth_estimateGas", [transaction]);
    }
  });

  it("does not turn a failed provider estimate into a guessed transaction limit", async () => {
    const primary = vi.fn(async () => { throw new Error("execution reverted"); });
    const secondary = vi.fn(async () => "0x186a0");
    await expect(estimateHyperEvmGas([primary, secondary], transaction)).rejects.toThrow("execution reverted");
  });
});

describe("HyperEVM invalid trade requests", () => {
  it.each([null, {}, { chainId: 999, amountIn: "-1" }, { chainId: 1 }])("returns a client error before provider calls", async input => {
    const rpc = vi.fn();
    await expect(prepareHyperEvmSwap(input, { rpcs: [rpc, rpc] })).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
    expect(readLaunch).not.toHaveBeenCalled();
  });
});
