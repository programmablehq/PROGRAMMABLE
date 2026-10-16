# Claus quote kernel candidate

Three directly deployed contracts provide a new project token, an immutable Uniswap v4 hook and a funded initializer. The hook creates its immutable fee vault. This source is a candidate for the separate `programmable.claus-quote.v1` admission profile; publishing or compiling it does not activate a launch.

- Ethereum chain 1 and the canonical PoolManager only.
- Official CLAUS quote: `0x1b54e762aa34cf6e28e9c082f2848e28e45da6b8`; both currency orderings work.
- Fixed 30-bps platform fee in CLAUS on every buy and sell, credited to the fixed platform treasury. Creator fees plus platform fees cannot exceed 15% of the actual gross quote amount, including integer rounding. Dust that cannot pay the fixed fee within that ceiling reverts.
- No 99% opening surcharge. Every buyer and recipient has a cumulative 2%-of-initial-supply budget during the first 300 seconds. Selling, burning and forwarding do not refill either budget. The window cannot restart.
- Initial liquidity is seeded atomically and remains in an initializer-owned position with no withdrawal or arbitrary execution method. A real CLAUS initial purchase is required; the payer must approve the exact initializer beforehand.
- Creator rights are limited to their immutable fee recipient. The kernel has no upgrade, ownership, blacklist or administrative trading-stop method.
- An optional external policy receives only a bounded static call. Reverts, excess output, invalid rates and gas exhaustion use immutable fallback rates. The policy cannot write kernel storage or access its LP position. Its externally mutable implementation and Claus governance must be reviewed separately through the admission receipt.
- The USD feed is consulted only when launching, with a pinned runtime hash and bounded age. Review must establish a real suitable CLAUS/USD source. The local fixture is not a production price source. Upgrades or failures of the external CLAUS token itself remain external dependencies.

From `contracts/`, build with `FOUNDRY_PROFILE=claus-partner forge build` and run the focused suite with `FOUNDRY_PROFILE=claus-partner forge test`. The suite covers both currency orderings, all four exact-input/output directions, fee claims, cumulative caps, permanent liquidity custody and failed optional-policy/price-feed behavior. It creates no public-chain transaction.

After a build, `node script/claus-partner-v1/source-manifest.mjs` regenerates the source manifest from compiler metadata. It binds all 42 source files. The API candidate pins the identical manifest and checks constructor recipients in addition to its existing exact compiler/runtime verification. Formatting changes require regenerating this manifest.
