import { describe, expect, it, vi } from "vitest";
// The operator entry point runs this same helper after saving its signed journal.
import { confirmFeedUpdate } from "../scripts/custom-ai/relay-feed.mjs";

const journal = { transactionHash: "0x1234", rawTransaction: "0xabcd", validUntil: "100" } as const;
const client = () => ({ getTransactionReceipt: vi.fn().mockRejectedValue(Error("pending")),
  sendRawTransaction: vi.fn().mockResolvedValue(journal.transactionHash),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: 10n }) });

describe("persisted feed transaction recovery", () => {
  it("rebroadcasts only the saved transaction and waits for two confirmations", async () => {
    const rpc = client();
    await expect(confirmFeedUpdate(rpc, journal, 90)).resolves.toMatchObject({ status: "success" });
    expect(rpc.sendRawTransaction).toHaveBeenCalledExactlyOnceWith({ serializedTransaction: journal.rawTransaction });
    expect(rpc.waitForTransactionReceipt).toHaveBeenCalledExactlyOnceWith({ hash: journal.transactionHash, confirmations: 2, timeout: 60000 });
  });
  it("still waits for finality when recovery already sees a receipt", async () => {
    const rpc = client(); rpc.getTransactionReceipt.mockResolvedValue({ status: "success" });
    await confirmFeedUpdate(rpc, journal, 200);
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
    expect(rpc.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({ confirmations: 2 }));
  });
  it("keeps an ambiguous broadcast recoverable without constructing a replacement", async () => {
    const rpc = client(); rpc.sendRawTransaction.mockRejectedValue(Error("connection lost"));
    await expect(confirmFeedUpdate(rpc, journal, 90)).rejects.toThrow("Resume this exact journal");
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.waitForTransactionReceipt).not.toHaveBeenCalled();
  });
  it("does not broadcast an expired unknown transaction", async () => {
    const rpc = client();
    await expect(confirmFeedUpdate(rpc, journal, 101)).rejects.toThrow("inspect this nonce");
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});
