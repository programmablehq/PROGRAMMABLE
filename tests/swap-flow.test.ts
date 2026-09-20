import { describe, expect, it, vi } from "vitest";
import { runSwapFlow } from "../components/swap-flow";
import type { SwapReceipt, SwapReview } from "../lib/swap/types";

const review: SwapReview = {
  chainId: 4663, kind: "approval", owner: "0x1111111111111111111111111111111111111111",
  token: "0x2222222222222222222222222222222222222222", side: "sell", amountIn: 100n,
  amountOut: 100n, minimumOutput: 97n, expiresAt: 9999999999n, gasEstimate: 100n,
};
const receipt: SwapReceipt = { status: "success", chainId: 4663, hash: `0x${"1".repeat(64)}`, blockNumber: 123n };
const submission = () => Promise.resolve({ wait: async () => receipt });

describe("single-action swap continuation", () => {
  it("waits for required approval then prepares and sends the same trade", async () => {
    const events: string[] = [];
    const result = await runSwapFlow({ review, assertCurrent() {},
      prepare: async () => { events.push("prepare"); return { ...review, kind: "swap" }; },
      submit: async value => {
        events.push(value.kind);
        return { wait: async () => { events.push("receipt"); return receipt; } };
      },
    });
    expect(events).toEqual(["approval", "receipt", "prepare", "swap", "receipt"]);
    expect(result.kind).toBe("swap");
  });
  it("stops after a reverted approval or an uncertain wallet result", async () => {
    const prepare = vi.fn();
    const reverted = await runSwapFlow({ review, assertCurrent() {}, prepare,
      submit: async () => ({ wait: async () => ({ ...receipt, status: "reverted" }) }),
    });
    expect(reverted.receipt.status).toBe("reverted");
    await expect(runSwapFlow({ review, assertCurrent() {}, prepare,
      submit: async () => { throw new Error("Wallet outcome uncertain"); },
    })).rejects.toThrow("uncertain");
    expect(prepare).not.toHaveBeenCalled();
  });
  it("does not continue after the wallet or mounted page changes", async () => {
    let active = true;
    const prepare = vi.fn();
    await expect(runSwapFlow({ review, prepare,
      assertCurrent() { if (!active) throw new Error("Wallet changed"); },
      submit: async () => ({ wait: async () => { active = false; return receipt; } }),
    })).rejects.toThrow("Wallet changed");
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    { token: "0x3333333333333333333333333333333333333333" as const },
    { owner: "0x3333333333333333333333333333333333333333" as const },
    { chainId: 1 as const }, { side: "buy" as const }, { amountIn: 101n }, { minimumOutput: 96n },
  ])("rejects altered continuation case %#", async change => {
    const submit = vi.fn(submission);
    await expect(runSwapFlow({ review, assertCurrent() {}, submit,
      prepare: async () => ({ ...review, kind: "swap", ...change }),
    })).rejects.toThrow(/changed/);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated approvals without resending forever", async () => {
    const submit = vi.fn(submission);
    await expect(runSwapFlow({ review, assertCurrent() {}, submit, prepare: async () => review })).rejects.toThrow("allowance");
    expect(submit).toHaveBeenCalledTimes(3);
  });
});
