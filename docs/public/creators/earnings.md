# Creator earnings

A creator fee is part of a coin's trading rules. It accrues to the recipients recorded for that coin and stays in the fee contract until claimed. The launching wallet is not necessarily the recipient.

## Module Mode

Choose the creator rate before launch. If selected modules receive a share of that fee, your earnings are the remainder. Fees accrue in the asset paired with the coin; an ETH-funded launch can use WETH for fee accounting.

The platform fee is separate. [Fees and revenue](../economics.md#module-mode) shows the rates and an example. A creator rate of 0% produces no creator earnings from those trades.

## Claiming fees

Connect the wallet recorded as the recipient and use the claim controls supported by the coin's fee contract. Custom projects define their own claim interface. An API key cannot claim funds.

A claim withdraws fees already earned. Analytics may include those balances before you claim them; withdrawing them does not add revenue a second time. Confirm the asset and recipient before signing.

Earlier coins keep their original fee and recipient rules. The [fee reference](../reference/fee-versions.md) covers those versions.
