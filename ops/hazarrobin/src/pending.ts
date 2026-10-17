import type { Address, Hex, PublicClient } from 'viem';

export interface PendingClaim {
  chainId: 1 | 4663;
  hash?: Hex;
  account: Address;
  to: Address;
  data: Hex;
  nonce: number;
  created: number;
  batchId?: string;
  atomic?: boolean;
}

const LEGACY_STORAGE_SLOT = 'hazarrobin.pending-claim.v2';
const STORAGE_SLOT = 'hazarrobin.pending-claims.v3';
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const need = (ok: unknown, message: string) => { if (!ok) throw Error(message); };

export function pendingClaims(): PendingClaim[] {
  try {
    const entries: PendingClaim[] = JSON.parse(localStorage.getItem(STORAGE_SLOT) ?? '[]');
    const legacy: PendingClaim | null = JSON.parse(localStorage.getItem(LEGACY_STORAGE_SLOT) ?? 'null');
    need(Array.isArray(entries), 'Ungültiger gespeicherter Claim.');
    if (legacy && !entries.some(e => e.chainId === legacy.chainId)) entries.push(legacy);
    for (const e of entries) {
      need([1, 4663].includes(e.chainId) && /^0x[\da-f]{40}$/i.test(e.account) &&
        /^0x[\da-f]{40}$/i.test(e.to) && /^0x(?:[\da-f]{2})*$/i.test(e.data) &&
        Number.isSafeInteger(e.nonce) && e.nonce >= 0 && (!e.hash || /^0x[\da-f]{64}$/i.test(e.hash)),
      'Ungültiger gespeicherter Claim.');
    }
    return entries;
  } catch { throw Error('Gespeicherter Claim muss geprüft werden.'); }
}

export function pending(chainId?: 1 | 4663): PendingClaim | null {
  return pendingClaims().find(e => chainId === undefined || e.chainId === chainId) ?? null;
}

export function remember(value: PendingClaim | null, chainId?: 1 | 4663) {
  const id = value?.chainId ?? chainId;
  need(id !== undefined, 'Die Chain des Claims fehlt.');
  const entries = pendingClaims().filter(e => e.chainId !== id);
  if (value) entries.push(value);
  localStorage.setItem(STORAGE_SLOT, JSON.stringify(entries));
  localStorage.removeItem(LEGACY_STORAGE_SLOT);
}

export function walletRequestNotSent(error: unknown, codes = [4001, 4100, -32602]) {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; current && i < 12; i++) {
    if (codes.includes(Number(current.code))) return true;
    current = current.cause as typeof current;
  }
  return false;
}

type Reader = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getTransactionCount' | 'getTransaction' | 'getTransactionReceipt'>;

/** Find a mined replacement even after the browser has been closed for days. */
export async function findMinedClaim(entry: PendingClaim, clients: Reader[]): Promise<Hex | null> {
  const heads = await Promise.all(clients.map(c => c.getBlockNumber({ cacheTime: 0 })));
  let left = 0n, right = heads.reduce((a, b) => a < b ? a : b);
  const client = clients[0]!;
  if (await client.getTransactionCount({ address: entry.account, blockNumber: right }) <= entry.nonce) return null;
  while (left < right) {
    const middle = (left + right) / 2n;
    if (await client.getTransactionCount({ address: entry.account, blockNumber: middle }) > entry.nonce) right = middle;
    else left = middle + 1n;
  }
  const block = await client.getBlock({ blockNumber: left, includeTransactions: true });
  const transaction = block.transactions.find(tx => typeof tx !== 'string' && same(tx.from, entry.account) && tx.nonce === entry.nonce);
  need(transaction && typeof transaction !== 'string', 'Die bestätigte Wallet-Transaktion ist noch nicht verfügbar.');
  return (transaction as { hash: Hex }).hash;
}

export async function verifyPendingClaim(entry: PendingClaim, hash: Hex, clients: Reader[]) {
  need((await Promise.all(clients.map(c => c.getChainId()))).every(id => id === entry.chainId), 'Die Bestätigung gehört zu einer anderen Chain.');
  const [transactions, receipts] = await Promise.all([
    Promise.all(clients.map(c => c.getTransaction({ hash }))),
    Promise.all(clients.map(c => c.getTransactionReceipt({ hash }))),
  ]);
  const tx = transactions[0]!, receipt = receipts[0]!;
  need(transactions.every(t => same(t.hash, hash) && same(t.from, entry.account) && t.nonce === tx.nonce &&
    same(t.to, tx.to) && same(t.input, tx.input) && t.value === tx.value),
  'Die Wallet-Transaktion stimmt nicht mit dem gespeicherten Auftrag überein.');
  need(receipts.every(r => same(r.transactionHash, hash) && same(r.blockHash, receipt.blockHash) &&
    r.blockNumber === receipt.blockNumber && r.status === receipt.status),
  'Die Bestätigung ist noch nicht auf beiden Verbindungen verfügbar.');
  const blocks = await Promise.all(clients.map(c => c.getBlock({ blockNumber: receipt.blockNumber })));
  need(blocks.every(b => same(b.hash, receipt.blockHash)), 'Die Bestätigung ist noch nicht kanonisch.');
  const exact = same(tx.to, entry.to) && same(tx.input, entry.data) && tx.value === 0n;
  // Older V4 builds recorded the nonce before the wallet selected its final
  // transaction. An exact stored hash still proves the intended zero-value call.
  need(tx.nonce === entry.nonce || (exact && same(entry.hash, hash)),
    'Die Wallet-Transaktion stimmt nicht mit dem gespeicherten Auftrag überein.');
  return { hash, blockNumber: receipt.blockNumber,
    outcome: !exact ? 'replaced' as const : receipt.status === 'success' ? 'confirmed' as const : 'reverted' as const };
}
