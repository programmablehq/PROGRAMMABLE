# Hazarrobin fee dashboard

One claim queue with three areas on https://hazarrobin.vercel.app:

1. Programmable V4: immutable Robinhood LP locker, position 1708785.
2. Robinhood ecosystem: Foundation releases, historical Module Mode ledgers, verified native custom fee vaults.
3. Ethereum ecosystem: Foundation graph launches, classic/stock hooks, supported custom fee profiles, native fee vaults, and pinned canonical/additional platform revenue vaults.

The app has no signing key. Users sign with their wallets. Fixed-recipient claims are grouped through the pinned Multicall3; sender-restricted legacy claims require the recipient wallet. Claims never withdraw LP principal, redirect fees, swap assets, or impose a minimum amount. Incomplete sources remain explicitly visible and are never reported as zero balances.

Ready areas can be claimed while the other chain is still scanning. The queue refreshes balances once after all wallet requests, rather than running the entire history scan between payouts. Each detected payout is simulated against two providers. Large batches split to fit the current gas and simulation limits before requesting a signature. Already-collected amounts are removed. Token contracts that reject payment are shown separately and do not block other claims. Reviewed fee-free and non-project sources are distinguished from unknown adapters.

Streaming progress keeps the same controls and open disclosures mounted. Totals are calculated once per result, asset details render on demand, and the account list loads 25 rows at a time. Wallet connection and preparation share one operation lock. An oversized batch lowers the starting size of later batches in that run; every resulting transaction still receives a fresh gas estimate and both provider simulations.

On resume, mined MetaMask delegated calls are bound to the original wallet through the delegation root, the exact wallet-returned transaction hash, and the pinned execution contract on both providers. Recovery preserves the original transaction ID until verification succeeds and reloads fees before preparing another claim.

## Local verification

`npm ci`, `npm test`, `npm run build`. Vercel serves `api/scan.mjs` and the read-only `api/rpc.mjs`. Production configures RH_PRIMARY, RH_SECONDARY, ETH_PRIMARY, ETH_SECONDARY and ETH_TERTIARY. Use independent providers with archive access; the legacy Ethereum history requires three providers. Values must never be exposed to the browser or committed.

## Source provenance

The fee readers and source recipes are adapted from ops/protocol-fee-claim and the immutable native-fee source proofs in lib/custom-launch at production 77e15371fc9125ed607d30fae7f264a07fa18dba. Pinned release history is in vendor/deployments.json. Future launches through these sources are discovered automatically, including unlisted launches. A new contract source requires a reviewed adapter/release binding. Arbitrary custom code is not assumed to share a fee interface.

## Release

This standalone Vercel project is `hazarrobin`, separate from the main product website and claimhazard. Preview from a feature branch. Merge to production, then publish from a clean integration checkout of that exact commit. Do not invoke the main website publisher for this dashboard.

Ethereum module event identity is checked against matching log sets from both providers. A fixed, read-only EXTCODEHASH probe batches current proxy runtime checks; factory bindings, balances, backing and payouts retain their existing quorum checks. Historical router discovery still requires all three configured providers and checks ranges concurrently. Robinhood retains receipt verification for every historical launch.
