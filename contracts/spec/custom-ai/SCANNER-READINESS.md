# Custom AI: security checks and external scanner readiness

This is a source review and local execution record for the **new Custom AI core**, not a verdict for existing Programmable tokens. The core has not been deployed or submitted to a scanner. External ratings remain **unknown**. The exact candidate and test results are bound in `local-verification.json`.

## Changes made for genuine compatibility

The hook previously required a 32-byte fee ceiling on every swap. An ordinary v4 route sending empty hook data would revert. It now accepts either:

- Empty bytes: apply the same immutable 1,500 bps total ceiling, including the platform fee and Core protocol fee. The router still enforces minimum output or maximum input.
- Exactly one ABI word: additionally enforce the trader's chosen ceiling, from 50 through 1,500 bps. Invalid lengths, padding/ranges and exceeded ceilings fail atomically.

No address, scanner, quoter, creator or router receives a special tax exemption. The Programmable router still sends its explicit ceiling. `PLATFORM_FEE_BPS()` and `MAX_TOTAL_FEE_BPS()` expose the enforced constants; they do not claim a third-party rating or quote a dynamic rate.

The focused lifecycle tests exercise the original v4-periphery `V4Router` through its upstream `MockV4Router` payment entrypoint and the original `V4Quoter`. They cover a fresh buyer, untaxed transfer and transferFrom to another fresh wallet, sale of its entire balance, 6/18-decimal quotes, maximum fees with Core protocol fees, all four swap modes, and failed/stale/over-cap/gas-exhausting modules. Quotes leave no settlement behind and match executed swaps for these fixtures. Slippage and explicitly lower fee ceilings still reject invalid trades.

These tests do not assert that any app's route finder already indexes the pool. They do not exercise a deployed Universal Router or its Permit2 path. A module depending on caller identity or other changing state can also make a quoter estimate differ from a later execution; the signed trade limits remain necessary.

## Core properties and evidence

| Check | Source and local evidence | What must be checked for a real launch |
| --- | --- | --- |
| Additional mint / supply change | Token mints one billion in its constructor; no later mint or burn entrypoint | Match deployed bytecode, totalSupply and constructor inputs |
| Owner / hidden controller / proxy | No Ownable, upgrade, delegatecall or generic execution path in this core | Inspect the entire deployed dependency graph, including generated modules and quote token |
| Blacklist / pause / wallet cap / cooldown | No such controls after atomic pool binding; fresh-wallet transfer and complete sale tested | Verify canonical factory launch and `poolBound=true`; test actual routes |
| Sellability | Real local Core swaps through both Programmable and upstream v4 routes | Buy, transfer and full sell on the exact deployed pool with independently checked receipts |
| Taxes | Transfers untaxed; platform 50 bps; all pool trading fees capped at 1,500 bps; dynamic extra bounded | Report current buy/sell rates **and maximum**, including hook fees and Core protocol fees |
| Module failure | Bounded STATICCALL and checked return data; invalid proposals remove the extra fee | Exact module and mutable dependencies must pass automatic compatibility checks |
| Liquidity custody | Vault can add one positive position once; no removal, approval, transfer, collect, upgrade or sweep | Read the actual Core position and verify this vault's runtime and factory binding |
| Fee/reward custody | Fixed destinations, measured ERC6909 backing, separate budgets and direct claims | Match recipients and actual claimed amounts; no self-reported solvency |
| Source availability | `export-verification.py` rebuilds a self-contained Standard JSON input and compares all eleven core contracts | Publish and obtain explorer verification for every deployed instance and dependency |
| Holder concentration | No hidden initial allocation; creator purchases are ordinary trades | Actual holder distribution remains a market fact, not a safety invariant |

The factory's price signer authenticates launch inputs; it has no post-launch pause, withdrawal or upgrade power. Directly deploying a lookalike token outside the canonical factory is not an official launch. An unavailable price service can prevent a new launch, but existing transfers, swaps and claims do not need its approval.

## What external services can and cannot currently confirm

- **GMGN:** its documentation describes source verification, trading restrictions, ownership, liquidity custody and taxes; it names GoPlus as one honeypot data source. Results can lag and are not guarantees. We must retain the actual response/UI evidence, not infer a GMGN pass from local tests. [GMGN checks](https://docs.gmgn.ai/index/ca-security-checks)
- **GoPlus:** its response schema includes v4 pools, but recognized quotes and known locking/burn addresses affect classification. Missing data means unknown. Our direct Core position custodian may need explicit recognition; an unrecognized lock is not proof that its liquidity is withdrawable. [Response fields](https://docs.gopluslabs.io/reference/response-details), [recognized quotes](https://docs.gopluslabs.io/reference/supported-main-token)
- **DEX Screener:** listing and market indexing follow pool activity on supported integrations. Visibility is separate from an audit or safety verdict. Record the exact chain, token and pool returned after launch; do not infer universal custom-hook support from the general listing description. [Listing](https://docs.dexscreener.com/token-listing), [data source](https://docs.dexscreener.com/)
- **Honeypot.is:** the current documentation lists v2/v3-style DEX support on Ethereum, BSC and Base, not this v4 hook path. An unsupported/failed simulation is inconclusive. Source verification also checks called contracts, and a partial check is not a full pass. [Supported exchanges](https://docs.honeypot.is/chains), [contract verification](https://docs.honeypot.is/contract)
- **Fomo:** no authoritative, specific contract-rating criteria were located in its public material reviewed here. Do not invent its provider or promise its label. Actual pool discovery, trading support and displayed warnings must be checked in the app after deployment.

A permitted dynamic 15% trading fee can legitimately attract a high-fee warning. Unlimited creator buying can produce concentration warnings. A user-selected quote can have administrator, blacklist, upgrade or liquidity risks outside this core. Those facts must stay visible; they cannot be removed by calling the core “safe”.

## Permanent LP evidence for indexers

This design holds a **direct v4 Core position**. It does not create a transferable LP token/NFT and does not burn a fictitious NFT. Only unused launch rounding tokens go to the dead address.

For each launch, persist and compare:

1. The canonical factory `Launched` event and `launchOf(creator, launchSalt)` result, bound to chain ID, finalized block, transaction and exact build.
2. The token's `factory`, `quote`, `CORE_VERSION`, `poolBound` and `canonicalPools`; the hook's `poolManager`, `initializer`, `poolId`, `poolKey`, module binding, fee bounds, ledger and reward vault.
3. The vault's `factory`, `token`, `poolManager`, `poolId`, `initialized` and `position` values. Read Core's position for **owner = vault, ticks = position.lower/upper, salt = bytes32(0)** and compare its positive liquidity with the launch record.
4. Verified vault runtime showing its one-shot authenticated positive-liquidity callback and absence of any route for negative liquidity, delegation, approval or ownership transfer.

Core's shared token balance is not this pool's reserve or the creator's personal balance. Never compute lock percentages from the PoolManager's aggregate holdings. If a service does not understand this position, retain “lock not recognized” and provide the verifiable position proof for integration.

## Reproducible verification package

After building the final sources:

```sh
FOUNDRY_PROFILE=custom-ai forge build
python3 spec/custom-ai/export-verification.py --solc /absolute/path/to/solc-0.8.26
```

The exporter uses the artifacts' exact compiler settings and source names, reads Solidity sources only, compiles from an otherwise empty directory, and rejects changed bytecode or ABI. `verification-bundle/standard-input.json` is the self-contained compiler input. `manifest.json` records source hashes, constructor schemas, all external selectors and state-changing functions, immutable offsets and matching bytecode hashes.

Explorer submission uses `codeformat=solidity-standard-json-input`, the manifest's compiler version, the fully qualified contract name and the **actual** deployment constructor arguments. Preserve viaIR, optimizer runs, Cancun and `bytecodeHash=none` / `appendCBOR=false`; do not change metadata settings just to obtain a badge. Rebuilding templates does not verify the deployed immutable addresses. [Solidity Standard JSON](https://docs.soliditylang.org/en/v0.8.26/using-the-compiler.html#compiler-input-and-output-json-description), [Etherscan verification](https://docs.etherscan.io/api-reference/endpoint/verifysourcecode)

Generated fee/reward modules and data feeds, the quote token, actual Core and routing contracts need their own source/bytecode and risk records. This core package cannot certify them. Explorer verification and scanner readback are automated post-deployment work; they do not introduce a manual approval queue for each launch. Independent review of this fixed core and the automatic module/quote validator are still required before releasing this new product.
