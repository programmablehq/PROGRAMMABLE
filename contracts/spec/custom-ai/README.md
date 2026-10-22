# Custom AI core V1

The local contract core implements the complete launch, swap, fee-claim and funded reward lifecycle. This candidate does not activate a product, deploy to a network or certify arbitrary generated modules or quote tokens.

Branch: `codex/custom-ai-core-20261022`, based on `a34d41a8e34ca569faf7e9bd01053769f730f9c1`. Owned paths: `contracts/src/custom-ai/`, `contracts/test/custom-ai/`, `contracts/spec/custom-ai/` and the `custom-ai` Foundry profile. Product decisions: `/Users/hazar/PROGRAMMABLE/docs/CUSTOM-AI-FOUNDATION-PLAN.md`.

## Components

| Contract | Fixed responsibility |
| --- | --- |
| `CustomAIFactoryV1` | Bind the exact preview and price, create one atomic launch, read back identical retries |
| `CustomAITokenV1` | One billion tokens, 18 decimals, free transfers, immutable URC-5 canonical pool |
| `CustomAIHookV1` | One fee evaluation per swap, full-fill accounting, platform fee and total-fee cap |
| `CustomAISwapRouterV1` | Caller-funded swaps with deadline, fee ceiling and minimum output / maximum input |
| `CustomAILiquidityVaultV1` | One positive Core liquidity mint; permanently owns the position without withdrawal rights |
| `CustomAIFeeLedgerV1` | Separate platform and additional claims, backed by actual v4 ERC6909 balances |
| `CustomAIRewardVaultV1` | Immutable creator split, funded reward allocation and direct beneficiary claims |
| `CustomAIDataFeedV1` | Optional authenticated, bounded, expiring data with replay protection |
| `CustomAIThresholdFeeModuleV1` | Reference rule using that data to choose two immutable extra-fee levels |
| Hook/liquidity deployers | Separate immutable creation code to remain within EVM contract size limits |

No contract has a core upgrade, administrator withdrawal, arbitrary execution, token mint/burn, blacklist or recipient-change function. Generated modules receive no allowance, pool balance, storage access or stateful callback from the host.

## Atomic launch and exact binding

1. Prepare metadata, quote address/decimals, initial tick, creator-bound launch salt, hook CREATE2 salt, fee module runtime/configuration hashes, creator/reward rules, required initial buy, fee ceiling, minimum tokens and deadline.
2. `predictTokenAddress` identifies the token. Use the hook deployer's `initCodeHash` and `predict` to find a salt whose low 14 address bits equal `8396`. Constructor arguments include the factory, so a third party cannot predeploy the same hook with a different initializer.
3. The automated price service signs `LaunchPrice(planHash, quoteUsdE18, ethUsdE18, observedAt, validUntil)` in the factory's EIP-712 domain. `hashPlan` binds the entire ABI-encoded launch struct, creator, chain, factory and core version. Both prices are signed together. Maximum price age is 120 seconds; future observations and extended expiry are rejected. The service must use trustworthy price and compatibility evidence. There is no manual review or submission entrypoint.
4. The creator calls `launch`. Token, hook, ledger, reward vault, pool and locked LP are created together. All supply goes to LP principal and inert rounding inventory. A creator allocation is never minted separately. The creator buy is an ordinary fee-paying swap worth at least 0.01 ETH, including swap fees and excluding gas. The factory computes the minimum from the signed ETH/USD and quote/USD prices, rounding up to a whole quote unit. No launch without this buy is possible. There is no policy purchase-size maximum; later swaps do not have this launch minimum.
5. Failure rolls back deployment, funding, swap and bookkeeping. An identical creator/salt/plan retry returns the existing result, even after price expiry, without another buy. Reusing the salt for a different plan fails.

The factory retains no funding allowance after an initial buy. Preexisting quote balances cannot fund another creator. A standalone token deployed outside this factory is not an official launch merely because it uses the same ABI.

## Start value and permanent liquidity

The curve uses the existing Foundation V3 one-sided range: token0 uses `[initialTick, maxUsableTick]`; token1 uses `[minUsableTick, initialTick]`, spacing 60. LP fee is zero. Principal is rounded up using Core math and bounded by the fixed billion supply. The remainder goes to `0x000000000000000000000000000000000000dEaD`; total supply stays unchanged. Creating initial LP requires no quote deposit.

**Custody decision:** the range and amounts match normal Module Mode, while an immutable contract owns the Core position directly. Its only liquidity entrypoint can execute once and only adds liquidity. There is no removable position NFT, approval, negative-liquidity path, collection path or graduation. Donations to the position remain locked. This also avoids a Permit2 dependency for launch liquidity.

The $15,000 target uses the signed quote/USD price and actual token ordering. Spacing 60 imposes a price grid. Select the first grid point conservatively at or above $15,000, with an upper bound of **$15,091.50 (+0.61%)** before the initial buy. Rational bounds include quote-unit rounding and Q128 conversion error. The preceding point must be below target. Quotes whose units cannot represent this band fail rather than silently broadening it. FDV is not deposited USD liquidity or a guaranteed price floor.

## Fees, settlement and limits

The immutable platform recipient is `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Its fee is 50 bps of gross quote per buy/sell, included in the 1,500 bps total cap. Without Core protocol fees, extra fees may range from 0 to 1,450 bps. Wallet transfers have no fee. Amounts must fit Core's signed delta representation; this is a technical bound, not a purchase policy.

Total own fees and platform fees round down per trade. The additional bucket gets the difference. There is no cross-trade rounding debt or minimum dust charge. Exact-output gross-up chooses the smallest gross producing the requested net. Buy fees come from gross quote input; sell fees come from gross quote output.

If Core activates a directional protocol fee, the hook reserves its rounded-up bps inside the 15% ceiling and caps the module's extra rate accordingly. It snapshots and measures actual protocol accrual, including integer rounding. Buy validation adds both quote deductions. Sell validation uses the combined fraction `p/input + (1 - p/input) * ownFee/grossQuote`, with full-precision comparison. Neither the global ceiling nor the trader's lower chosen ceiling can be exceeded. Tiny trades whose rounding exceeds the ceiling fail atomically. Core protocol fees belong to Core and are not credited to Programmable.

The router binds the payer to its caller, honors deadline/fee/slippage limits and checks both ends of every transfer. Its unlock callback requires the real manager, an active reentrancy guard and the exact pending context. Partial fills are rejected atomically. The hook does not trust an end-user address supplied through hook data; `router` identifies the manager's caller.

Standard v4 routes may provide empty hook data: the hook then applies its full 1,500 bps cap while the router enforces slippage. Exactly 32 bytes may encode a stricter ceiling; other lengths and invalid limits revert. The Programmable router always sends an explicit ceiling. Neither path bypasses fees or grants scanner-specific permissions. The hook exposes `PLATFORM_FEE_BPS()` and `MAX_TOTAL_FEE_BPS()` for discovery.

## Module and data boundaries

Fee modules receive a bounded `STATICCALL`: 100,000 gas and exactly 128 output bytes. Malformed/large returns, changed runtime/configuration, expiry, over-cap responses, reverts and exhausted module gas fall back to zero extra fee. Caller gas starvation is a core error, so it cannot deliberately skip evaluation. The fee is saved across both Core callbacks and never reevaluated after the price changes.

The optional data feed fixes its signer, feed ID, value range and max age (at most one day). Updates bind value, sequence and timestamps through chain/contract-specific EIP-712. Sequence increases, observations cannot move backwards, and old or future observations cannot become fresh merely by signing them. Anyone can relay a valid update. Missing/stale data removes the reference module's extra fee.

Runtime hashes do not freeze a proxy implementation or prove arbitrary module logic correct. The automatic module check must inspect mutable dependencies and configuration before the wallet signs. A dishonest data source can lie within its range; authentication is not proof of the underlying event.

## Backed claims and rewards

Platform/additional claims are backed by the ledger's actual Core ERC6909 balances. Anyone may trigger payment; destinations cannot change. The additional destination is the launch's reward vault, never the module itself. Each bucket is independent, so one reverting recipient cannot block the other or swaps.

`sync` divides new vault receipts cumulatively between the fixed creator share and unallocated rewards. Repeated tiny syncs cannot redirect rounding to rewards. Earned creator balances and allocated rewards cannot be reused as module budget. A fixed reward module may propose one beneficiary/amount per action ID through a 100,000-gas static call and exactly 160 output bytes. The vault enforces expiry, runtime/configuration binding, available funds and at-most-once allocation. Invalid proposals leave funds unallocated. There are no holder-wide payout loops.

`claimCreator` pays the immutable creator recipient. `claimReward(account)` pays that account's credited balance, even if someone else calls it. Earned claims need no module, website or backend approval. Initial allocation still requires the module's evidence; the core does not manufacture eligibility. Unused rewards stay within the original rules without an administrator sweep.

## Quote and infrastructure assumptions

There is no quote-address whitelist. Quotes require normal, exact ERC20 semantics and representable pricing (0..36 decimals). Funding and settlement check sender and recipient deltas. Transfer taxes, short payments and in-flight balance mutation fail atomically. A mutable quote can later introduce a freeze, rebase or tax; a runtime hash alone cannot prevent it. Automatic compatibility checks must surface those powers instead of promising any address is safe.

Official factory deployments must bind verified Core/router/deployer code. Runtime hashes are checked on use; the constructor does not prove initial dependencies trustworthy. Cancun transient storage is required. Every network needs its own infrastructure, deployment and lifecycle evidence.

URC-5 is implemented as **Preferred**, with one immutable canonical pool. It does not prevent foreign pools or enforce fees everywhere. Shared v4 manager transfers do not reveal every foreign venue. No `Enforced` claim is made.

## Pinned sources

- URC-5: `Uniswap/URCs`, `02b9ab1d2176917f1098eaae300c607da71a78b1`, `URCs/urc-5.md`, Discussion, interface CC0-1.0: <https://github.com/Uniswap/URCs/blob/02b9ab1d2176917f1098eaae300c607da71a78b1/URCs/urc-5.md>.
- OpenZeppelin Contracts: `21c8312b022f495ebe3621d5daeed20552b43ff9`.
- OpenZeppelin Uniswap Hooks: `26dc8e53f812a1ca390d470342adb6cd8c3286ad`.
- Uniswap v4 Core: `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`.
- Uniswap v4 Periphery: `ad04c9f24a170accf5ea1b2836bbafd514537ca6`, production liquidity math and upstream router/quoter compatibility tests.
- forge-std: `3b20d60d14b343ee4f908cb8079495c07f5e8981`.

## Verification and remaining integration

Baseline before the minimum initial-buy change: **61 passed, 0 failed, 0 skipped**, including eight fuzz tests with 1,000 cases each. All eleven concrete contract runtimes fit EIP-170; the existing lifecycle size checks also cover the factory/hook creation code with a 1,024-byte constructor allowance.

From `contracts/`:

```sh
FOUNDRY_PROFILE=custom-ai forge test -vv
FOUNDRY_PROFILE=custom-ai forge build --sizes
forge fmt --check src/custom-ai test/custom-ai
git diff --check
```

`minimum-initial-buy-verification.json` records the current 0.01 ETH minimum revision, focused price/lifecycle checks and regenerated bytecode. `local-verification.json` and `local-test-output.txt` preserve the earlier full-core baseline; they are not evidence for the changed price ABI. `primitives-*` and `core-57-*` preserve the earlier increments and are not proof for this later version.

`SCANNER-READINESS.md` covers the external checks, provider limitations and exact LP evidence. `export-verification.py` exports a self-contained explorer input and reproduces all eleven core contracts' bytecode and ABIs with the exact compiler. Its `verification-bundle/` is local evidence only: there are no deployed addresses, verified explorer results or scanner verdicts yet. The high/medium lint output and its reviewed dispositions are retained in `security-lint.txt` and `security-lint-review.json`; the linter produced warnings, not a clean audit.

Tests use unmodified local Uniswap v4 Core, actual swaps, liquidity, ERC6909 backing and local token balance movements. No RPC, production keys or network transactions are involved. Broken modules and unusual tokens in fixtures are not production modules.

Remaining work outside this contract-core task: independent security review, automated module/quote validator, trustworthy price/data service operation, chat/preview/API and wallet UI integration, finalized Explore indexing, verified chain deployments and funded network acceptance. These are not a manual submission stage. Existing releases are unchanged; Base Module Mode is not enabled.
