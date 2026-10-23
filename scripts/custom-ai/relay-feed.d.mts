type Hex = `0x${string}`;
type RelayJournal = { transactionHash: Hex; rawTransaction: Hex; validUntil: string };
export function confirmFeedUpdate<T>(client: {
  getTransactionReceipt(input: { hash: Hex }): Promise<unknown>;
  sendRawTransaction(input: { serializedTransaction: Hex }): Promise<unknown>;
  waitForTransactionReceipt(input: { hash: Hex; confirmations: number; timeout: number }): Promise<T>;
}, journal: RelayJournal, now?: number): Promise<T>;
