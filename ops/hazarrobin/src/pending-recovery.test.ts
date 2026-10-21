import { beforeEach, expect, it, vi } from 'vitest';
import { concat, encodeAbiParameters, encodeFunctionData, parseAbiParameters, toHex } from 'viem';
import { checkPending, pending, remember } from './ecosystem';
import { walletExecutionAbi, type PendingClaim } from './pending';

const mocks = vi.hoisted(() => ({ clients: [] as Record<string, unknown>[], next: 0 }));
vi.mock('viem', async importOriginal => {
  const actual = await importOriginal<typeof import('viem')>();
  return { ...actual, createPublicClient: () => mocks.clients[mocks.next++ % 2],
    keccak256: (value: `0x${string}`) => value === '0x6000'
      ? '0xe45747f90ecec2ba96ae9f4a15c36289653efdfef7690bcfb90a1945bb0fe207'
      : actual.keccak256(value) };
});
const account = toHex(1, { size: 20 }), to = toHex(2, { size: 20 }), relayer = toHex(3, { size: 20 });
const hash = toHex(11, { size: 32 }), replacement = toHex(12, { size: 32 }), blockHash = toHex(20, { size: 32 });
const entry: PendingClaim = { chainId: 4663, account, to, data: '0x12345678', nonce: 7, created: 1, hash };
const receipt = (transactionHash = hash, status = 'success') => ({ transactionHash, blockHash, blockNumber: 20n, status });
const direct = { hash, from: account, to, input: entry.data, value: 0n, nonce: 7 };
const missing = (name: string) => Object.assign(Error('Not available'), { name });
function relayed(batch = false) {
  const types = parseAbiParameters('(address delegate,address delegator,bytes32 authority,(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]');
  const execution = batch ? encodeAbiParameters(parseAbiParameters('(address target,uint256 value,bytes callData)[]'), [[{target:to,value:0n,callData:entry.data}]])
    : concat([to, toHex(0, { size: 32 }), entry.data]);
  const context = encodeAbiParameters(types, [[{ delegate: relayer, delegator: account,
    authority: toHex(2n ** 256n - 1n, { size: 32 }), caveats: batch ? [{enforcer:'0x1e141e455d08721Dd5BCDA1BaA6Ea5633Afd5017',terms:execution,args:'0x'}] : [], salt: 0n, signature: '0x01' }]]);
  return { ...direct, from: relayer, nonce: 83, to: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
    input: encodeFunctionData({ abi: walletExecutionAbi, functionName: 'redeemDelegations',
      args: [[context], [batch ? `0x01${'00'.repeat(31)}` : toHex(0, { size: 32 })], [execution]] }) };
}
beforeEach(() => {
  const data = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } });
  mocks.next = 0;
  mocks.clients = [0, 1].map(() => ({
    getChainId: async () => 4663, getBlockNumber: async () => 100n,
    getBlock: async () => ({ hash: blockHash, transactions: [direct] }),
    getTransaction: async () => direct, getTransactionReceipt: async () => receipt(),
    getCode: async () => '0x6000',
    getTransactionCount: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => blockNumber >= 20n ? 8 : 7),
  }));
});

it('recovers a mined relayed claim and preserves the other chain journal', async () => {
  remember(entry); remember({ ...entry, chainId: 1 });
  mocks.clients.forEach(client => { client.getTransaction = async () => relayed(); });
  const result = await checkPending(() => {}, 4663);
  expect(result).toMatchObject({ outcome: 'confirmed', hash });
  expect(pending(4663)).toBeNull();
  expect(pending(1)?.hash).toBe(hash);
});

it('clears a verified strict MetaMask batch without submitting another claim', async () => {
  remember(entry); remember({ ...entry, chainId: 1 });
  mocks.clients.forEach(client => { client.getTransaction = async () => relayed(true); });
  expect(await checkPending(() => {}, 4663)).toMatchObject({ outcome:'confirmed', hash });
  expect(pending(4663)).toBeNull();
  expect(pending(1)?.hash).toBe(hash);
});

it('never converts an unverified candidate into a wallet-returned hash on retry', async () => {
  remember(entry);
  mocks.clients.forEach(client => {
    client.getTransactionReceipt = async ({ hash: asked }: { hash: string }) => {
      if (asked === hash) throw missing('TransactionReceiptNotFoundError');
      return receipt(replacement);
    };
    client.getTransaction = async ({ hash: asked }: { hash: string }) => {
      if (asked === hash) throw missing('TransactionNotFoundError');
      return { ...direct, hash: replacement, nonce: 8 };
    };
    client.waitForTransactionReceipt = async () => receipt(replacement);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(checkPending(() => {}, 4663)).rejects.toThrow('Wallet-Transaktion');
    expect(pending(4663)).toEqual(entry);
  }
});

it('does not use the user nonce to resolve a still-pending relayer transaction', async () => {
  remember(entry);
  mocks.clients.forEach(client => {
    client.getTransactionReceipt = async () => { throw missing('TransactionReceiptNotFoundError'); };
    client.getTransaction = async () => relayed();
    client.waitForTransactionReceipt = async () => { throw Error('Still pending'); };
  });
  await expect(checkPending(() => {}, 4663)).rejects.toThrow('Still pending');
  expect(mocks.clients[0]!.getTransactionCount).not.toHaveBeenCalled();
  expect(pending(4663)).toEqual(entry);
});

it('still recovers a direct transaction whose wallet hash was never recorded', async () => {
  remember({ ...entry, hash: undefined });
  expect(await checkPending(() => {}, 4663)).toMatchObject({ outcome: 'confirmed', hash });
  expect(pending(4663)).toBeNull();
});

it('clears a proven reverted relayed transaction without calling it a payout', async () => {
  remember(entry);
  mocks.clients.forEach(client => {
    client.getTransaction = async () => relayed();
    client.getTransactionReceipt = async () => receipt(hash, 'reverted');
  });
  expect(await checkPending(() => {}, 4663)).toMatchObject({ outcome: 'reverted' });
  expect(pending(4663)).toBeNull();
});

it('retains the pending journal when providers disagree', async () => {
  remember(entry);
  mocks.clients[1]!.getTransaction = async () => ({ ...direct, nonce: 8 });
  await expect(checkPending(() => {}, 4663)).rejects.toThrow('unterschiedliche Transaktionsdaten');
  expect(pending(4663)).toEqual(entry);
});
