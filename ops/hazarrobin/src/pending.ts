import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, type Address, type Hex, type PublicClient } from 'viem';

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
  let current = error as { code?: unknown; name?: string; cause?: unknown } | undefined;
  for (let i = 0; current && i < 12; i++) {
    if (codes.includes(Number(current.code)) || current.name === 'InsufficientFundsError') return true;
    current = current.cause as typeof current;
  }
  return false;
}

type Reader = Pick<PublicClient, 'getChainId' | 'getBlockNumber' | 'getBlock' | 'getTransactionCount' | 'getTransaction' | 'getTransactionReceipt' | 'getCode'>;
const WALLET_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';
const WALLET_MANAGER_HASH = {
  1: '0x762a7ccac3fba1fce7751870298c097c0d050451d9b4a1f0935e65dc4078d1d3',
  4663: '0xe45747f90ecec2ba96ae9f4a15c36289653efdfef7690bcfb90a1945bb0fe207',
};
export const walletExecutionAbi = parseAbi(['function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)']);
const delegationType = parseAbiParameters('(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]');
const ROOT_AUTHORITY = `0x${'ff'.repeat(32)}`;
const ANY_DELEGATE = '0x0000000000000000000000000000000000000a11';

/** Inspect only a mined wallet envelope. This never creates a delegation. */
export function matchesWalletExecution(entry: PendingClaim, tx: { from: string; to: string | null; input: Hex; value: bigint }) {
  if (tx.value !== 0n) return null;
  if (same(tx.from, entry.account) && same(tx.to, entry.to) && same(tx.input, entry.data)) return 'direct';
  if (!same(tx.to, WALLET_MANAGER)) return null;
  try {
    const decoded = decodeFunctionData({ abi: walletExecutionAbi, data: tx.input });
    const [contexts, modes, executions] = decoded.args;
    if (contexts.length !== 1 || modes.length !== 1 || executions.length !== 1 || BigInt(modes[0]!) !== 0n ||
      !same(encodeFunctionData({ abi: walletExecutionAbi, functionName: 'redeemDelegations', args: decoded.args }), tx.input)) return null;
    const packed = executions[0]!;
    if (packed.length < 106 || !same(packed.slice(0, 42), entry.to) ||
      BigInt(`0x${packed.slice(42, 106)}`) !== 0n || !same(`0x${packed.slice(106)}`, entry.data)) return null;
    // The manager executes as the root delegator, not necessarily the outer
    // transaction's gas payer. Its pinned runtime validates the signatures and
    // authority chain; bind that root to the wallet that prepared this claim.
    const [delegations] = decodeAbiParameters(delegationType, contexts[0]!);
    if (!same(encodeAbiParameters(delegationType, [delegations]), contexts[0])) return null;
    if (!delegations.length) {
      if (!same(tx.from, entry.account)) return null;
    } else {
      const root = delegations[delegations.length - 1]!, leaf = delegations[0]!;
      if (!same(root.delegator, entry.account) || !same(root.authority, ROOT_AUTHORITY) ||
        !(same(leaf.delegate, tx.from) || same(leaf.delegate, ANY_DELEGATE))) return null;
    }
    return 'metamask';
  } catch { return null; }
}

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
  need(transactions.every(t => same(t.hash, hash) && same(t.from, tx.from) && t.nonce === tx.nonce &&
    same(t.to, tx.to) && same(t.input, tx.input) && t.value === tx.value),
  'Die Verbindungen melden unterschiedliche Transaktionsdaten. Bitte den Status erneut prüfen.');
  need(receipts.every(r => same(r.transactionHash, hash) && same(r.blockHash, receipt.blockHash) &&
    r.blockNumber === receipt.blockNumber && r.status === receipt.status),
  'Die Bestätigung ist noch nicht auf beiden Verbindungen verfügbar.');
  const blocks = await Promise.all(clients.map(c => c.getBlock({ blockNumber: receipt.blockNumber })));
  need(blocks.every(b => same(b.hash, receipt.blockHash)), 'Die Bestätigung ist noch nicht kanonisch.');
  const execution = matchesWalletExecution(entry, tx);
  if (execution === 'metamask') {
    const codes = await Promise.all(clients.map(c => c.getCode({ address: WALLET_MANAGER, blockNumber: receipt.blockNumber })));
    need(codes.every(code => code && same(keccak256(code), WALLET_MANAGER_HASH[entry.chainId])),
      'Der Wallet-Ausführungsvertrag stimmt nicht mit der geprüften Version überein.');
  }
  const exact = execution !== null;
  const ownTransaction = same(tx.from, entry.account);
  const storedHash = same(entry.hash, hash);
  // A relayer's nonce belongs to the relayer. Only the exact hash returned by
  // the wallet can bind a relayed execution to this pending request.
  need(ownTransaction || (execution === 'metamask' && storedHash),
    'Die Wallet-Transaktion stimmt nicht mit dem gespeicherten Auftrag überein.');
  // Older V4 builds recorded the nonce before the wallet selected its final
  // transaction. An exact stored hash still proves the intended zero-value call.
  need((ownTransaction && tx.nonce === entry.nonce) || (exact && storedHash),
    'Die Wallet-Transaktion stimmt nicht mit dem gespeicherten Auftrag überein.');
  return { hash, blockNumber: receipt.blockNumber,
    outcome: !exact ? 'replaced' as const : receipt.status === 'success' ? 'confirmed' as const : 'reverted' as const };
}
