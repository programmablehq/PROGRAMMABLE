import { describe, expect, it } from "vitest";
import { readTradeCheckpointV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";

const hash = `0x${"11".repeat(32)}`;
const otherHash = `0x${"22".repeat(32)}`;
function provider(tip: string, options: { mismatch?: boolean; wrongHeight?: boolean; unavailable?: boolean } = {}): TradeRpcV1 {
  return async (method, params) => {
    if (method !== "eth_getBlockByNumber" || options.unavailable) throw new Error("RPC unavailable");
    if (params[0] === "latest") return { number: tip, hash: tip === "0x64" ? hash : otherHash, timestamp: "0x100" };
    // The newest block is still missing on some nodes behind the same provider.
    if (params[0] !== "0x54") throw new Error("Block not found");
    return { number: options.wrongHeight ? "0x53" : "0x54", hash: options.mismatch ? otherHash : hash, timestamp: "0xfe" };
  };
}

describe("Robinhood swap checkpoints", () => {
  it("uses the recent common block when the latest provider tips differ", async () => {
    await expect(readTradeCheckpointV1([provider("0x64"), provider("0x66")])).resolves.toEqual({ number: "84", hash, timestamp: "254" });
  });
  it("still rejects different hashes at the selected block", async () => {
    await expect(readTradeCheckpointV1([provider("0x64"), provider("0x66", { mismatch: true })])).rejects.toMatchObject({ code: "TRADE_PROVIDER_DISAGREEMENT" });
  });
  it("rejects a provider response for a different block height", async () => {
    await expect(readTradeCheckpointV1([provider("0x64", { wrongHeight: true }), provider("0x66", { wrongHeight: true })])).rejects.toMatchObject({ code: "TRADE_CHECKPOINT_CHANGED" });
  });
  it("does not fall back to one provider when the other is unavailable", async () => {
    await expect(readTradeCheckpointV1([provider("0x64"), provider("0x66", { unavailable: true })])).rejects.toThrow();
  });
});
