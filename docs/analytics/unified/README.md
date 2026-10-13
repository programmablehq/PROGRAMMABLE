# Ecosystem analytics

[Dashboard](https://dune.com/programmablehq/analytics)

[Website analytics](https://programmable.market/analytics) displays volume, collected revenue, buybacks and project burns. Its server reads the latest completed query results with the private `DUNE_API_KEY` and an hourly cache. Page visits never execute SQL. A checked-in snapshot preserves the last verified values and their original timestamps if a source is unavailable. Query execution schedules are managed separately in Dune within the owner's existing credit budget.

The website's [project burn source](https://dune.com/queries/8941418) covers transfers from the three project wallets for the current Robinhood token and historical Ethereum token. The token generations are never summed together. Buyback query 8677080 additionally publishes `buyback_events_v1`, a timestamped transaction list for the website's history. The page always shows all-time figures across both chains, with V4 totals referring to the current token.

The public policy allocates 100% of collected 0.3% platform fees from launches on either chain to manual Programmable (V4) buybacks. The allocation is not evidence of a purchase. Queries count completed transactions independently.

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

The current V4 burn percentage uses the original 1,000,000,000-token supply of `0xc60ba256b44334a0cd2c7242e98b88f031abb006`. The amount remains derived from verified burn events, not a manually entered dashboard value. The onchain supply and burn-address balance were reconciled with the stored Dune results on 14 October 2026.

Buybacks count executed purchases delivered to the tracked wallet group. Burns count V4 that the group sends to burn addresses, including tokens received as fees or from other sources. These are separate events and their totals need not match. Transfers between the three wallets do not create a new purchase. A direct-to-burn purchase must retain verified transaction-level attribution rather than being treated as a wallet transfer.

## Interpretation

- Volume counts one pool swap once. It excludes claims, transfers and liquidity deposits. Raw Uniswap v4 swap logs take precedence over matching curated DEX rows.
- The source manifest defines which launches belong to Programmable. Hiding a real token in Explore does not remove its history. Documented technical release launches are excluded.
- Recognized factory and router generations discover subsequent launches automatically. New contract generations require an update to `sources.json`.
- Custom plans use their stamped markets. The XILO opening block is backfilled from its successful pool initialization transaction, which is included in its finalized plan evidence. Other multi-step plans use their stamp block until an earlier opening transaction is verified.
- Finality is applied once to the combined facts after onchain discovery. Each fact retains the block proving its source, so an unfinalized source cannot admit older activity. An unavailable finality response fails the query instead of silently omitting Robinhood.
- Missing historical prices remain unavailable. USD figures are priced subtotals; the page discloses that activity without price data is excluded.
- Collected fees exclude ordinary incoming transfers, unclaimed accruals and liquidity principal. Nonstandard fee interfaces require a verified adapter before they contribute to the collected-fee total.
- V4 received directly as own liquidity fees is excluded from cash buyback revenue and purchased V4. It can still contribute to actual burns.
- Burns to `0x000000000000000000000000000000000000dEaD` do not reduce the token contract's `totalSupply`.
- Existing historical Robinhood fee cards measure earned accruals. They must not be added to collected fees, because collection withdraws previously accrued amounts.

Regenerate volume SQL with `node docs/analytics/unified/build.mjs`. Use `--check` to verify the generated file without changing it. A committed query is not proof that its Dune execution or dashboard publication succeeded; record those results separately.
