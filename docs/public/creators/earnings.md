---
description: How creator fees accrue and are claimed
---

# Creator earnings

A coin's creator fee is set at launch. Earnings accrue when people trade the coin and remain in its fee contract until claimed. A claim pays the recorded recipient; it does not count the same earnings again.

## Module Mode

Foundation lets you choose **0%, or 1% to 10% in 1% increments**, separate from Programmable's **0.30%** fee. Fees accrue in the pool's quote token. If modules receive a share of the creator fee, your earnings are the remainder after those allocations.

Existing coins use their original fee contract. Check the recorded split for the coin before calculating or claiming earnings.

## Custom launches

Robinhood Native20 adds Programmable's **0.20%** fee separately from creator and pool fees. A creator fee of 0% means no creator earnings from those trades, even when the platform earns fees.

Custom contracts define their own claim interface. The launching wallet is not necessarily the recipient, and an API key cannot claim funds.

## Existing Classic coins

Ethereum Classic includes Programmable's **0.10%** within the selected fee. At 1%, the creator receives 0.90%. ETH rewards can be split between recipients, each of whom claims its own share. Recipient changes leave already earned fees with their original recipients.

[Fees and revenue](../economics.md) contains the full breakdown. The analytics totals include earned fees that have not yet been claimed; gas and liquidity deposits are excluded.
