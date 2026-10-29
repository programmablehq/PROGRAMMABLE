import "server-only";
import { createPublicClient, http, keccak256, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Operation } from "../../lib/custom-ai/operation-journal.server";
import type { WorkerAdapter } from "./jobs";

export type PreparedOperation = { to: Address; data: Hex };
export function createSignedWorkerAdapter(input: {
  chainId: 1 | 4663; rpcUrls: [string, string]; signingKey: Hex;
  targets: ReadonlyMap<string, ReadonlySet<string>>; dailyLimitWei: bigint; transactionLimitWei: bigint;
  prepare: (operation: Operation) => Promise<PreparedOperation | null>;
  readOnly: WorkerAdapter["readOnly"]; health: NonNullable<WorkerAdapter["health"]>;
}): WorkerAdapter {
  const account = privateKeyToAccount(input.signingKey);
  const clients = input.rpcUrls.map(url => createPublicClient({ transport: http(url, { retryCount: 0, timeout: 10000 }) }));
  const agree = async <T>(read: (client: typeof clients[number]) => Promise<T>) => {
    const values = await Promise.all(clients.map(read));
    const encoded = (value: T) => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
    if (encoded(values[0]) !== encoded(values[1])) throw Error("Worker providers disagree"); return values[0];
  };
  return {
    chainId: input.chainId, signer: account.address, allowedTargets: new Set(input.targets.keys()),
    dailyLimitWei: input.dailyLimitWei, transactionLimitWei: input.transactionLimitWei,
    readOnly: input.readOnly, health: input.health,
    async prepare(operation) {
      if (await agree(c => c.getChainId()) !== input.chainId) throw Error("Worker network changed");
      const prepared = await input.prepare(operation);
      if (!prepared) return { skip:true as const };
      if (prepared.to.toLowerCase() !== operation.target.toLowerCase() || !input.targets.get(prepared.to.toLowerCase())?.has(prepared.data.slice(0,10).toLowerCase())) throw Error("Worker call is outside the reviewed target policy");
      const latest = await agree(c => c.getTransactionCount({ address: account.address, blockTag: "latest" }));
      const pending = await agree(c => c.getTransactionCount({ address: account.address, blockTag: "pending" }));
      if (latest !== pending) throw Error("Worker signer has an unresolved transaction");
      const prices = await Promise.all(clients.map(c => c.getGasPrice()));
      const gasPrice = prices.reduce((a,b) => a > b ? a : b);
      const estimates = await Promise.all(clients.map(c => c.estimateGas({ account: account.address, to: prepared.to, data: prepared.data, value: 0n })));
      const gas = estimates.reduce((a,b) => a > b ? a : b) * 12n / 10n + 10000n;
      if (gas > 20000000n || gas * gasPrice > input.transactionLimitWei) throw Error("Worker transaction exceeds its approved budget");
      const rawTransaction = await account.signTransaction({ chainId: input.chainId, type: "legacy", nonce: pending, gas, gasPrice, ...prepared, value: 0n });
      return { rawTransaction };
    },
    async broadcast(raw) {
      const expected = keccak256(raw);
      const result = await Promise.allSettled(clients.map(c => c.sendRawTransaction({ serializedTransaction: raw })));
      if (!result.some(r => r.status === "fulfilled" && r.value === expected)) throw Error("Broadcast outcome is unconfirmed");
      return expected;
    },
    async receipt(hash) {
      const receipts = await Promise.all(clients.map(async c => {
        try { const r = await c.getTransactionReceipt({ hash }); return { blockNumber:r.blockNumber,blockHash:r.blockHash,status:r.status }; }
        catch (error) { if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null; throw error; }
      }));
      if (receipts.some(r => r === null)) return { state: "pending" };
      const [a,b] = receipts;
      if (a!.blockHash !== b!.blockHash || a!.status !== b!.status) throw Error("Worker receipts disagree");
      const heads = await Promise.all(clients.map(c => c.getBlock({ blockTag: "finalized" })));
      if (heads.some(head => head.number === null || head.number < a!.blockNumber)) return { state: "pending" };
      const block = await agree(async c => (await c.getBlock({ blockNumber:a!.blockNumber })).hash);
      if (block !== a!.blockHash) throw Error("Worker receipt was reorganized");
      return { state:a!.status === "success" ? "confirmed" : "reverted", blockHash:a!.blockHash };
    },
  };
}
