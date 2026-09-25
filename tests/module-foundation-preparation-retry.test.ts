import { describe, expect, it, vi } from "vitest";
import { RpcRequestError, TimeoutError } from "viem";
import { isTemporaryFoundationPreparationError, retryFoundationReadOnlyPreparation } from "@/lib/module-foundation/preparation-retry";
import { FoundationProviderDisagreementError } from "@/lib/module-foundation/availability";

describe("Module launch read-only preparation retries", () => {
  it("keeps one click active until an exact provider disagreement clears", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new FoundationProviderDisagreementError()).mockResolvedValue("review");
    expect(await retryFoundationReadOnlyPreparation(prepare, vi.fn())).toBe("review");
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("retries an RPC timeout before any wallet step", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(new TimeoutError({ body: {}, url: "https://rpc.example" })).mockResolvedValue("review");
    const assertCurrent = vi.fn();
    expect(await retryFoundationReadOnlyPreparation(prepare, assertCurrent)).toBe("review");
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(assertCurrent).toHaveBeenCalled();
  });

  it("does not retry a contract revert or a changed draft", async () => {
    const revert = new RpcRequestError({ body: {}, error: { code: 3, message: "execution reverted" }, url: "https://rpc.example" });
    expect(isTemporaryFoundationPreparationError(revert)).toBe(false);
    const prepare = vi.fn().mockRejectedValue(revert);
    await expect(retryFoundationReadOnlyPreparation(prepare, vi.fn())).rejects.toBe(revert);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("stops after three failed read-only attempts with a concise error", async () => {
    const prepare = vi.fn().mockRejectedValue(new TimeoutError({ body: {}, url: "https://rpc.example" }));
    await expect(retryFoundationReadOnlyPreparation(prepare, vi.fn())).rejects.toThrow("temporarily unavailable");
    expect(prepare).toHaveBeenCalledTimes(3);
  });
});
