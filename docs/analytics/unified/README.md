# Ecosystem analytics

[Dashboard](https://dune.com/programmablehq/analytics)

The public policy allocates 80% of eligible collected fee revenue to manual V4 buybacks and burns, with 20% for treasury and operations. The allocation is not evidence of a purchase. Queries count completed transactions independently.

## Queries

| Query | Source | Meaning |
| --- | --- | --- |
| [Ecosystem volume](https://dune.com/queries/8940969) | `ecosystem-volume.sql` | Executed swaps across Ethereum and Robinhood for the main V4 token and recognized launch generations. |
| [Collected platform fees](https://dune.com/queries/8940998) | `collected-fees.sql` | Finalized claims to the three project wallets from recognized fee contracts, plus the main V4 liquidity position's fees. |
| [V4 buybacks](https://dune.com/queries/8677080) | Dune version history | Actual V4 purchases by the three wallets, including ETH, WETH and token-funded purchases. |
| [V4 burns](https://dune.com/queries/8626416) | Dune version history | Finalized transfers to the burn address, with project and other-holder totals separated. |

The three project wallets are:

- `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`: current platform fees.
- `0x39544A7023081B56D7405c1af0bFaf72da7e24F6`: own V4 liquidity fees and project burns.
- `0x4957f49620AFf3Adbbe8195a4f633E49cc93376c`: earlier Ethereum fee contracts.

## Interpretation

- Volume counts one pool swap once. It excludes claims, transfers and liquidity deposits. Raw Uniswap v4 swap logs take precedence over matching curated DEX rows.
- The source manifest defines which launches belong to Programmable. Hiding a real token in Explore does not remove its history. Documented technical release launches are excluded.
- Recognized factory and router generations discover subsequent launches automatically. New contract generations require an update to `sources.json`.
- Custom plans use their stamped markets. The XILO opening block is backfilled from its successful pool initialization transaction, which is included in its finalized plan evidence. Other multi-step plans use their stamp block until an earlier opening transaction is verified.
- Missing historical prices remain unavailable. The priced subtotal must not be presented as a complete total when `ecosystem_unpriced_swaps` or `total_unpriced_claims` is positive.
- Collected fees exclude ordinary incoming transfers, unclaimed accruals and liquidity principal. Nonstandard fee interfaces require a verified adapter before they contribute to the collected-fee total.
- V4 received directly as own liquidity fees is excluded from cash buyback revenue and purchased V4. It can still contribute to actual burns.
- Burns to `0x000000000000000000000000000000000000dEaD` do not reduce the token contract's `totalSupply`.
- Existing historical Robinhood fee cards measure earned accruals. They must not be added to collected fees, because collection withdraws previously accrued amounts.

Regenerate volume SQL with `node docs/analytics/unified/build.mjs`. Use `--check` to verify the generated file without changing it. A committed query is not proof that its Dune execution or dashboard publication succeeded; record those results separately.
