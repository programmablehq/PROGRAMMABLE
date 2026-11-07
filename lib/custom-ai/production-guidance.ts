import { checkedLaunchProductionContext, type LaunchProductionContext } from "./launch-production";

/** Model instructions come from the validated policy shape, never provider
 * prose. This explains the existing policy without changing its authority. */
export function launchProductionGuidance(input?: LaunchProductionContext): string {
  if (!input) return "";
  const context = checkedLaunchProductionContext(input, input.chainId), p = context.protections;
  if (!context.protectionPolicy?.required || !p) return "";
  return `Mandatory launch policy for the selected network:
During the first ${p.protectionSeconds} seconds after launch, the ${p.buyerLimitBps / 100}% buyer cap measures cumulative authenticated buys and the ${p.recipientLimitBps / 100}% recipient cap measures cumulative token inflows, including wallet-to-wallet transfers. The recipient cap is not a cap on current holdings. Selling or transferring tokens out does not restore either cumulative allowance.
Tax-exempt wallets remain subject to those cumulative caps. Their exemption concerns only the additional opening surcharge; the mandatory platform fee remains due.
Additional tax-exempt wallets are optional. When the user has not requested any specific extra wallet, use an empty additionalTaxExemptWallets list. Keep the policy's fixed protocol and developer treatment unchanged. Do not ask the user to choose extra wallets or decide whether pool/router addresses belong in that optional list; protocol addresses are not user-added exemptions.
The opening total buy fee starts at ${p.openingFeePpm / 10_000}%. The extra opening surcharge decreases linearly to zero over ${p.openingSeconds} seconds, using the canonical module's integer rounding and exemptions. Normal platform fees and independently agreed project rules still apply throughout and afterwards. The minimum starting FDV is $${p.minimumFdvUsd}.
Include these fixed platform rules automatically. A request for normal ERC20 transfers does not by itself waive the temporary launch protections, and those temporary caps end after their stated window. Do not ask users whether this mandatory policy applies to ordinary transfers or tax-exempt wallets. If a user explicitly requests a conflicting rule, identify that exact conflict and preserve the unresolved choice rather than dropping either requirement. Do not add permanent transfer restrictions or administrator powers.`;
}
