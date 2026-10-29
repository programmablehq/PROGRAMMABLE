import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const readLaunch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/hyperevm-explore", () => ({ readHyperEvmLaunchEvidence: readLaunch }));
import { estimateHyperEvmGas, prepareHyperEvmSwap } from "@/lib/server/swap/evm-custom";

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
