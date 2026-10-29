import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const readLaunch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/hyperevm-explore", () => ({ readHyperEvmLaunchEvidence: readLaunch }));
import { prepareHyperEvmSwap } from "@/lib/server/swap/evm-custom";

describe("HyperEVM invalid trade requests", () => {
  it.each([null, {}, { chainId: 999, amountIn: "-1" }, { chainId: 1 }])("returns a client error before provider calls", async input => {
    const rpc = vi.fn();
    await expect(prepareHyperEvmSwap(input, { rpcs: [rpc, rpc] })).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
    expect(readLaunch).not.toHaveBeenCalled();
  });
});
