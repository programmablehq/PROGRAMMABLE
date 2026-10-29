import { describe, expect, it, vi } from "vitest";
import { readHyperEvmWalletFees } from "../lib/hyperevm-wallet-gas";

const account = "0x1111111111111111111111111111111111111111" as const;

describe("HyperEVM wallet block-mode gas pricing", () => {
  it.each([true, false])("uses the price of the wallet's actual block mode: %s", async bigBlocks => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x3e7";
      if (method === "eth_usingBigBlocks") return bigBlocks;
      if (method === "eth_bigBlockGasPrice") return "0x64";
      if (method === "eth_gasPrice") return "0xa";
      throw Error("Unexpected RPC");
    });
    expect(await readHyperEvmWalletFees({ account, request })).toEqual({
      maxFeePerGas: bigBlocks ? "0xc8" : "0x14", maxPriorityFeePerGas: "0x0",
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).not.toHaveBeenCalledWith({ method: bigBlocks ? "eth_gasPrice" : "eth_bigBlockGasPrice" });
  });

  it("rejects another chain before pricing or block-mode reads", async () => {
    const request = vi.fn(async () => "0x1");
    await expect(readHyperEvmWalletFees({ account, request })).rejects.toThrow("Switch your wallet");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([null, "true", 1])("never guesses an unavailable block mode: %s", async mode => {
    const request = vi.fn().mockResolvedValueOnce("0x3e7").mockResolvedValueOnce(mode);
    await expect(readHyperEvmWalletFees({ account, request })).rejects.toThrow("block mode");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["0x0", "0x01", "100", "-1", null, `0x${"f".repeat(33)}`])("rejects malformed or overflowing prices: %s", async price => {
    const request = vi.fn().mockResolvedValueOnce("0x3e7").mockResolvedValueOnce(true).mockResolvedValueOnce(price);
    await expect(readHyperEvmWalletFees({ account, request })).rejects.toThrow("gas pricing");
  });
});
