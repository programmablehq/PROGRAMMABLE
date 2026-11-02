/** Planning arithmetic only. This module cannot collect, send or authorize funds. */
export const FEE_FLOW_VERSION = "1.0.0";
export type FeeAllocation = { id: string; shareBps: number };
const denominator = 10_000n;
const maximumAmount = (1n << 256n) - 1n;

function checkedAllocations(value: readonly FeeAllocation[]): FeeAllocation[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) throw new TypeError("Specify one to twelve fee allocations.");
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || Object.keys(item).sort().join() !== "id,shareBps" || typeof item.id !== "string"
      || !/^[a-z][a-z0-9-]{0,47}$/.test(item.id) || ids.has(item.id)
      || !Number.isSafeInteger(item.shareBps) || item.shareBps < 0 || item.shareBps > 10_000) {
      throw new TypeError("Use distinct allocation names and exact shares between zero and 100 percent.");
    }
    ids.add(item.id); return { id: item.id, shareBps: item.shareBps };
  });
}

export function allocateCollectedFees(amount: bigint, value: readonly FeeAllocation[]) {
  const allocations = checkedAllocations(value);
  if (typeof amount !== "bigint" || amount < 0n || amount > maximumAmount) throw new RangeError("Use a nonnegative uint256 fee amount.");
  const totalBps = allocations.reduce((sum, item) => sum + item.shareBps, 0);
  if (totalBps > 10_000) throw new RangeError("The fee allocations exceed 100 percent.");
  const amounts = allocations.map(item => ({ ...item, amount: amount * BigInt(item.shareBps) / denominator }));
  const assigned = amounts.reduce((sum, item) => sum + item.amount, 0n);
  const unallocated = amount * BigInt(10_000 - totalBps) / denominator;
  return { amounts, unallocated, roundingRemainder: amount - assigned - unallocated };
}

export function planFeeFlow(value: readonly FeeAllocation[]) {
  const allocations = checkedAllocations(value);
  const assignedBps = allocations.reduce((sum, item) => sum + item.shareBps, 0);
  const remainingBps = Math.max(0, 10_000 - assignedBps), excessBps = Math.max(0, assignedBps - 10_000);
  const example = excessBps ? undefined : allocateCollectedFees(1_000_000n, allocations);
  return {
    version: FEE_FLOW_VERSION,
    basis: "Collected distributable project fees after mandatory platform and protocol amounts. Shares are not swap-tax rates.",
    status: excessBps ? "overallocated" as const : remainingBps ? "remainder-undecided" as const : "shares-balanced" as const,
    allocations, assignedBps, remainingBps, excessBps,
    ...(example ? { example: { collected: "1000000", amounts: example.amounts.map(item => ({ id: item.id, amount: item.amount.toString() })),
      unallocated: example.unallocated.toString(), roundingRemainder: example.roundingRemainder.toString() } } : {}),
    unresolved: excessBps ? ["Reduce the chosen shares; never silently normalize them."]
      : remainingBps ? ["Agree where the remaining share goes; never silently assign it to a recipient."] : [],
    boundary: "Arithmetic plan only. Balanced shares do not establish a working liquidity action, holder list, burn, integration, funded executor or launch readiness.",
  };
}
