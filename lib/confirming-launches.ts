/** Display-only receipt observations, never canonical launch or trading proof. */
export type ConfirmingLaunch = {
  chainId: 1;
  confirmation: "confirming";
  observationExpiresAt: number;
  category: "custom";
  mode: "custom" | "module";
  launchId: string;
  tokenAddress: string;
  hookAddress: string;
  creator: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  poolId: string;
  quoteAsset: string;
  launchedAt: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

/** Expired observations must also disappear from browser navigation snapshots. */
export function liveLaunchObservations<T extends { confirmation?: string; observationExpiresAt?: number }>(
  rows: readonly T[], now = Date.now(),
) {
  return rows.filter(row => row.confirmation !== "confirming"
    || (Number.isFinite(row.observationExpiresAt) && row.observationExpiresAt! > now));
}
