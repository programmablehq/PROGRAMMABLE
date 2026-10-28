export type PriceObservation = { blockNumber: string; blockHash: string; timestamp: number; sqrtPriceX96: string };
export function appendPriceObservation(previous: readonly PriceObservation[], value: PriceObservation): PriceObservation[] {
  if (!/^\d+$/.test(value.blockNumber) || !/^0x[0-9a-f]{64}$/i.test(value.blockHash) || !/^\d+$/.test(value.sqrtPriceX96)
    || BigInt(value.sqrtPriceX96) <= 0n || BigInt(value.sqrtPriceX96) >= 1n << 160n || !Number.isSafeInteger(value.timestamp)) throw Error("Invalid price observation");
  const existing = previous.find(p => p.blockNumber === value.blockNumber);
  if (existing) {
    if (existing.blockHash !== value.blockHash || existing.sqrtPriceX96 !== value.sqrtPriceX96 || existing.timestamp !== value.timestamp) throw Error("Price history requires reorganization recovery");
    return [...previous];
  }
  if (previous.length && (BigInt(value.blockNumber) <= BigInt(previous.at(-1)!.blockNumber) || value.timestamp < previous.at(-1)!.timestamp)) throw Error("Price history cannot move backwards");
  return [...previous, value].slice(-128);
}
export function checkedExecutionPrice(history: readonly PriceObservation[], policy: { minimumObservations: number; minimumHistorySeconds: number; maxAgeSeconds: number; deviationBps: number }, now: number) {
  const values = history.filter(p => p.timestamp <= now && now - p.timestamp <= policy.maxAgeSeconds);
  if (policy.minimumObservations < 3 || policy.minimumHistorySeconds < 60 || policy.deviationBps < 1 || policy.deviationBps > 1000
    || values.length < policy.minimumObservations || values.at(-1)!.timestamp - values[0].timestamp < policy.minimumHistorySeconds) throw Error("Insufficient current price history");
  const prices = values.map(v => BigInt(v.sqrtPriceX96)).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  const median = prices[Math.floor(prices.length/2)], reference = median * median;
  if (prices.some(p => { const current = p*p; return (current > reference ? current-reference : reference-current) * 10000n > reference * BigInt(policy.deviationBps); })) throw Error("Price history contains an outlier");
  return { sqrtPriceX96: median.toString(), observations: values.length, historySeconds: values.at(-1)!.timestamp - values[0].timestamp,
    observedAt: values.at(-1)!.timestamp, blockNumber: values.at(-1)!.blockNumber, blockHash: values.at(-1)!.blockHash };
}
