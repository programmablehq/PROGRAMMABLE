import { parseUnits } from "viem";

export class FoundationLaunchBalanceError extends Error {}

/** An early UX check only. The simulated transaction still checks its exact gas budget. */
export function foundationLaunchBalanceError(balance: bigint | undefined, initialBuy: string, chainName: string): string | undefined {
  if (balance === undefined) return;
  if (balance === 0n) return `Not enough ETH on ${chainName}. Add ETH to this wallet for the launch and network fees.`;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(initialBuy)) return;
  if (balance <= parseUnits(initialBuy, 18)) return `Not enough ETH on ${chainName}. Reduce the first buy or add ETH to cover it and network fees.`;
}

/** One instance per account and chain; never share a balance across wallet contexts. */
export class FoundationLaunchBalance {
  private snapshot?: { value: bigint; time: number };
  private pending?: Promise<bigint | undefined>;
  private lastAttemptAt = -Infinity;
  private listeners = new Set<() => void>();

  getSnapshot = (): bigint | undefined => this.snapshot?.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  constructor(private readonly readBalance: () => Promise<bigint>) {}

  read(refresh = false): Promise<bigint | undefined> {
    if (this.pending) return this.pending;
    if (!refresh && this.snapshot && Date.now() - this.snapshot.time < 15_000) return Promise.resolve(this.snapshot.value);
    if (!refresh && !this.snapshot && Date.now() - this.lastAttemptAt < 15_000) return Promise.resolve(undefined);
    this.lastAttemptAt = Date.now();
    const request = new Promise<bigint | undefined>(resolve => {
      // A slow provider must not add another long wait to the normal launch checks.
      const timer = setTimeout(() => resolve(undefined), 3_000);
      void Promise.resolve().then(this.readBalance).then(value => {
        clearTimeout(timer);
        resolve(typeof value === "bigint" && value >= 0n ? value : undefined);
      }, () => { clearTimeout(timer); resolve(undefined); });
    }).then(value => {
      this.snapshot = value === undefined ? undefined : { value, time: Date.now() };
      this.listeners.forEach(listener => listener());
      return value;
    }).finally(() => { if (this.pending === request) this.pending = undefined; });
    this.pending = request;
    return request;
  }
}
