/** Resume only the transaction already persisted by the caller. Never signs or replaces it. */
export async function confirmFeedUpdate(client, journal, now = Math.floor(Date.now() / 1000)) {
  const receipt = await client.getTransactionReceipt({ hash: journal.transactionHash }).catch(() => null);
  if (!receipt) {
    if (BigInt(journal.validUntil) < BigInt(now)) throw Error("Saved update expired; inspect this nonce before preparing another transaction");
    try { await client.sendRawTransaction({ serializedTransaction: journal.rawTransaction }); }
    catch { throw Error("Broadcast outcome uncertain. Resume this exact journal; do not create a replacement update."); }
  }
  // A receipt found during recovery may still have only one confirmation.
  return client.waitForTransactionReceipt({ hash: journal.transactionHash, confirmations: 2, timeout: 60_000 });
}
