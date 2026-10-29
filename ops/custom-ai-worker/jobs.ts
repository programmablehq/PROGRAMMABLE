import { keccak256, parseTransaction, type Hex } from "viem";
import type { Operation, OperationJournal } from "../../lib/custom-ai/operation-journal.server";
export type WorkerAdapter = {
  health?: () => Promise<Partial<import("./health").WorkerHealth>>;
  signer: string; allowedTargets: ReadonlySet<string>; chainId: 1 | 4663; dailyLimitWei: bigint; transactionLimitWei: bigint;
  prepare: (operation: Operation) => Promise<{ rawTransaction: Hex } | { skip: true }>;
  receipt: (hash: Hex) => Promise<{ state: "pending" | "confirmed" | "reverted"; blockHash?: Hex }>;
  broadcast: (raw: Hex) => Promise<Hex>;
  readOnly: (operation: Operation) => Promise<void>;
};
export async function runDueJobs(journal: OperationJournal, adapters: WorkerAdapter[], limit = 8) {
  const result = { checked: 0, confirmed: 0, skipped: 0, deferred: 0 };
  for (const candidate of await journal.due(limit)) {
    const adapter = adapters.find(a => a.chainId === candidate.chainId && a.allowedTargets.has(candidate.target.toLowerCase()));
    if (!adapter) continue;
    let op = await journal.claim(candidate.id); if (!op) continue;
    result.checked++;
    try {
      if (op.kind === "index" || op.kind === "price") { await adapter.readOnly(op); await journal.complete(op, "confirmed"); result.confirmed++; continue; }
      if (!await journal.acquireSigner(op, adapter.signer)) { await journal.defer(op); continue; }
      if (op.transactionHash) {
        const receipt = await adapter.receipt(op.transactionHash as Hex);
        if (receipt.state === "confirmed" && receipt.blockHash) { await journal.complete(op, "confirmed", receipt.blockHash); await journal.releaseSigner(op, adapter.signer); result.confirmed++; continue; }
        if (receipt.state === "reverted") { await journal.complete(op, "failed", receipt.blockHash); await journal.releaseSigner(op, adapter.signer); continue; }
        if (op.state === "broadcast") { await journal.defer(op);result.deferred++;continue; }
        // Re-broadcasting is always the exact saved bytes and nonce. Never re-sign an unknown outcome.
      } else {
        const prepared = await adapter.prepare(op);
        if ("skip" in prepared) {
          await journal.complete(op,"skipped");await journal.releaseSigner(op,adapter.signer);result.skipped++;continue;
        }
        const { rawTransaction } = prepared;
        const tx = parseTransaction(rawTransaction);
        if (tx.chainId !== adapter.chainId || tx.to?.toLowerCase() !== op.target.toLowerCase() || (tx.value ?? 0n) !== 0n || !tx.gas || (!tx.maxFeePerGas && !tx.gasPrice)) throw Error("Worker transaction is outside its bound operation");
        const cost = tx.gas * (tx.maxFeePerGas ?? tx.gasPrice!);
        if (cost > adapter.transactionLimitWei) throw Error("Worker transaction limit reached");
        op = await journal.signed(op, rawTransaction, keccak256(rawTransaction), cost, adapter.dailyLimitWei);
      }
      const sent = await adapter.broadcast(op.rawTransaction as Hex);
      if (sent.toLowerCase() !== op.transactionHash?.toLowerCase()) throw Error("Broadcast returned a different transaction");
      await journal.complete(op, "broadcast");
    } catch { if (!op.rawTransaction) await journal.releaseSigner(op, adapter.signer); await journal.defer(op); result.deferred++; }
  }
  return result;
}
