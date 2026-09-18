import { formatEther, formatUnits, getAddress, keccak256, type Address, type PublicClient } from "viem";
import type { FoundationPreparedStep } from "./client";

/** Robinhood Chain's existing WETH, verified on both configured RPCs. Never infer this from a symbol. */
export const FOUNDATION_WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const FOUNDATION_WETH_CODE_HASH = "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353";
const DEPOSIT = "0xd0e30db0" as const;

export function foundationSupportsEth(quote: { address: Address; decimals: number; codeHash: string }): boolean {
  return getAddress(quote.address) === FOUNDATION_WETH && quote.decimals === 18 && quote.codeHash === FOUNDATION_WETH_CODE_HASH;
}

/** Use existing WETH first. A confirmed conversion therefore cannot be repeated by a fresh review. */
export async function prepareFoundationNativeFunding(input: {
  client: PublicClient; account: Address; blockNumber: bigint; amount: bigint;
  quote: { address: Address; decimals: number; symbol: string; codeHash: string; balance: bigint | null };
}): Promise<FoundationPreparedStep[]> {
  const { client, account, quote, amount, blockNumber } = input;
  if (quote.balance === null) throw new Error("Your wallet balance could not be read. Try again.");
  if (amount <= quote.balance) return [];
  if (!foundationSupportsEth(quote)) throw new Error(`Your initial buy needs ${formatUnits(amount, quote.decimals)} ${quote.symbol}. Reduce it or enter 0 to launch with only ETH for gas.`);
  const shortfall = amount - quote.balance;
  if (await client.getBalance({ address: account, blockNumber }) <= shortfall) {
    throw new Error(`Your initial buy needs ${formatEther(shortfall)} more ETH, plus network fees. Reduce it or enter 0 to launch with only gas.`);
  }
  return [{ kind: "wrap", label: "Prepare ETH for the initial buy", gasUsed: 0n, amount: shortfall,
    transaction: { from: account, to: FOUNDATION_WETH, data: DEPOSIT, value: shortfall },
    effect: `Convert exactly ${formatEther(shortfall)} ETH to WETH in your wallet for this launch. Existing WETH is used first. If you stop before launching, the converted WETH stays in your wallet.` }];
}

/** The remaining steps determine the credit: after confirmation, wrapping is no longer counted. */
export function foundationWrappedAmount(steps: readonly FoundationPreparedStep[], quote: Address): bigint {
  const wraps = steps.filter(step => step.kind === "wrap");
  if (!wraps.length) return 0n;
  const step = wraps[0];
  if (wraps.length !== 1 || steps[0] !== step || getAddress(quote) !== FOUNDATION_WETH
    || getAddress(step.transaction.to) !== FOUNDATION_WETH || step.transaction.data !== DEPOSIT
    || step.transaction.value <= 0n || step.amount !== step.transaction.value) throw new Error("The ETH conversion does not match the reviewed WETH deposit.");
  return step.transaction.value;
}

export async function assertFoundationWrapRuntime(client: PublicClient, steps: readonly FoundationPreparedStep[], blockNumber: bigint): Promise<void> {
  if (!steps.some(step => step.kind === "wrap")) return;
  foundationWrappedAmount(steps, FOUNDATION_WETH);
  const code = await client.getCode({ address: FOUNDATION_WETH, blockNumber });
  if (!code || keccak256(code) !== FOUNDATION_WETH_CODE_HASH) throw new Error("The ETH conversion contract changed. Review again.");
}

/** Reserve gas for every remaining wallet step, not just the ETH deposit. */
export async function assertFoundationNativeBalance(client: PublicClient, account: Address, steps: readonly FoundationPreparedStep[], blockNumber: bigint): Promise<void> {
  const [balance, gasPrice] = await Promise.all([client.getBalance({ address: account, blockNumber }), client.getGasPrice()]);
  const value = steps.reduce((sum, step) => sum + step.transaction.value, 0n);
  const gas = steps.reduce((sum, step) => sum + step.gasUsed * 120n / 100n + 15_000n, 0n);
  if (gasPrice <= 0n || balance < value + gas * gasPrice * 2n) throw new Error("Keep enough ETH for the initial buy and all launch network fees. Reduce the initial buy or enter 0.");
}
