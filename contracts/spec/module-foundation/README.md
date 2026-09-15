# Module Foundation V1 contract boundary

This source implements the first Module Mode memecoin foundation. It contains no product module. Technical modules live exclusively under `test/module-foundation`.

## Token and metadata

Each launch deploys a new OpenZeppelin ERC20 with exactly 1,000,000,000 tokens at 18 decimals. The sole mint occurs in its constructor. `burn(amount)` burns only the caller's inventory. There is no external mint, burnFrom, owner, transfer tax, pause, rebase or upgrade function.

The token stores name, symbol, description, image URI, website and social JSON bytes. It exposes the existing `metadata()` tuple `(description, website, image, extraData)` and an immutable `metadataHash = keccak256(abi.encode(FoundationTypesV1.Metadata))`. Name/symbol/description/URL/social byte limits match the repository metadata policy. The application separately validates display characters, URL semantics and upload persistence. A URI or content hash by itself does not prove remote content availability.

## Pool and liquidity

- Official PoolKey: sorted ERC20 currencies, LP fee 0, tick spacing 60, one immutable FoundationHookV1 address. Mandatory platform fees are hook accounting, independently of LP fees or Uniswap protocol fees.
- All initial token supply is offered in one token-only range from the start tick toward the applicable usable tick extreme. This is real single-sided Uniswap concentrated liquidity, with no virtual reserves or promise of pre-existing quote funds. Starting valuation is a price convention, not funded liquidity.
- PositionManager mints its canonical NFT to a dedicated permanent vault. The vault can perform only zero-liquidity decreases to collect accrued LP fees to its fixed beneficiary. It has no principal, transfer, approval, signature, arbitrary-call or upgrade path. Mint rounding inventory is held permanently in the same vault.
- `additionalQuoteAmount > 0` creates a second, quote-only band adjacent to the first at the starting tick. Its separate PositionManager NFT belongs directly to the creator. The creator may transfer, add to, or remove that position through the official PositionManager. Every pool swap still pays the mandatory hook fee.
- Both positions contribute to gross liquidity at their shared start tick. Their sum must satisfy the pinned Core limit. Later external positions remain permissionless subject to ordinary Uniswap liquidity limits.
- Initial buy is optional and atomic with token deployment, hook binding, initialization and both NFT mints. It is an actual Universal Router 2.1.1 exact-input swap, with actual input/output balance checks and empty hookData.

## Mandatory fee accounting

Platform recipient is fixed forever at `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`. Platform fee is 30 bps on gross quote. Creator fee is separately 0 or 100–1,000 bps, in 100 bps increments, on the same gross quote. No module can consume, remove or redirect platform fees. This promise applies to these canonical launch pools; freely transferable tokens can also exist in unrelated external pools.

For gross raw quote `g`, fee rate `r` and stored remainder `c`, fee is `floor((g*r+c)/10000)` and next remainder is `(g*r+c)%10000`. Platform and creator have independent remainders for each trading direction. This preserves fees under split trades. Individual dust trades can produce a zero whole-unit fee; fractional units remain in the persistent carry. A trade with nonpositive net amount reverts.

| Operation | Specified asset | Fee computation | Core amount / final settlement |
| --- | --- | --- | --- |
| Buy exact input | Gross quote input | Gross fee calculation in beforeSwap | Core receives gross minus hook fees; trader gets actual token output |
| Buy exact output | Token output | Invert quote net in afterSwap | Trader pays smallest exact gross quote covering Core quote cost and fees |
| Sell exact input | Token input | Gross fee calculation in afterSwap | Trader gets Core gross quote output minus hook fees |
| Sell exact output | Net quote output | Invert quote net in beforeSwap | Core supplies gross quote; trader receives exactly requested net quote |

The inverse checks a mathematically bounded interval of four integer candidates in ascending order. Two independent floors make `net(gross)` non-monotone at joint rounding boundaries, so binary search is invalid. Full-fill checks bind actual Core deltas to the entire specified amount in all four directions. A price limit or exhaustion that would produce a partial fill reverts the full transaction, including carry and credits.

Core mints fee claims to this launch's dedicated ledger during the swap. The returned hook delta pays the corresponding Core account/currency debt. The router then completes settlement. Ledger backing is checked against its own actual ERC6909 balance; no global sum or other pool's claim is used as backing.

Platform, creator and each module have separate cumulative received/credited/claimed counters. Creator fee shares assigned to modules cannot exceed 10000 bps of the creator component. Each share uses a floor of cumulative creator receipts, leaving bounded unallocated creator rounding dust in the ledger. Platform credits are never share inputs. Public platform/creator claim calls always pay the fixed beneficiary; they do not invoke modules. A module failure therefore cannot block an independently called beneficiary claim. Exact quote balance checks surround actual payout. Quotes with tax, rebasing or otherwise nonstandard accounting are unsupported and must fail application admission; ordinary direct UR routing cannot prove arbitrary token transfer semantics.

## Module ABI and composition

`FoundationTypesV1` and `IFoundationModuleV1` are the exact versioned ABI. The host creates a fresh instance through each selected factory, binds factory and module runtime code hashes, configuration hash, ABI descriptor hash, complete pool context and order. Factories must deploy source-reviewed, non-upgradeable modules with immutable configuration. Codehash alone cannot establish the absence of a proxy or malicious state setter; that is part of source conformance and admission review.

The host supports at most 8 selected instances. Module IDs must be unique within one launch. A nonzero exclusive group can occur only once. This is a structural conflict check, not a guarantee of arbitrary semantic compatibility. Review and tests cover the interactions a package actually uses. New fundamental money models or permissions require an explicit future host ABI; existing PoolKey hook addresses do not change.

| Phase / resource | ABI bit | Contract boundary |
| --- | --- | --- |
| Before swap | 1 | Ordered CALL; rejection rolls back the entire swap; receives router identity, never asserted end-user identity |
| After swap | 2 | Ordered CALL after validated fee accounting; declared fail-open or fail-closed behavior |
| Standalone action | 4 | Explicit user-triggered CALL with authenticated direct actor and uninterpreted action bytes; module enforces its own action authorization |
| Own quote budget | 1 in resource mask | Only that active action instance can claim its own creator-fee budget, only to itself |

Before/after gas is 10,000–300,000 when enabled; absent phases have zero gas. Aggregate declared before+after gas is at most 1,200,000. Action gas is 10,000–2,000,000. Configuration and action data are each limited to 16,384 bytes. Callback calls use fixed return buffers and preserve an EIP-150 reserve, preventing returndata bombs and caller-driven selective starvation of fail-open callbacks.

Fail-open after callbacks apply only to actual reverted or out-of-gas CALLs, whose effects are reverted by the EVM. A successful callback with a malformed, extra-length or incorrect ABI acknowledgment is a fatal conformance error and rolls back the whole transaction. Runtime hash mismatch is always fatal. This prevents partial module effects being retained under a misleading failure event.

No delegatecall, generic host execution, platform-budget access or host-origin PoolManager.swap exists. Host phases are idle=0, swap=1, action=2, swap-inside-action=3. An action may withdraw its own credited quote, then use an official external router to trade the same pool, paying the normal fees and restoring phase 2 after the full swap. Before/after callbacks cannot start nested swaps or another action, and cannot claim module budgets. A failed action trade rolls back the earlier module claim as part of the same outer transaction. Modules whose actions route through their own pool must explicitly tolerate their own declared swap callbacks during the action; this is a conformance test, not inferred compatibility.

## Build, source pins and evidence

Foundation source uses Solidity 0.8.26, Cancun, optimizer 200, via IR, no CBOR metadata or bytecode hash. Use `contracts/scripts/module-foundation/verify.sh`. It confines compilation/tests to this Foundation tree and verifies dependency HEADs before running tests. Auto-detected dependency remappings are disabled because unrelated libraries provide a conflicting `test/` remapping.

- Core: `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc`.
- Universal Router 2.1.1: `999d561c3ad58fb5cab91b602911f3c75591a9c7`.
- Router's V4 periphery ABI: `3231810e39b8c4d569b9d66907fa4ef8cd2cec22`.
- PositionManager periphery: `ad04c9f24a170accf5ea1b2836bbafd514537ca6`.
- OpenZeppelin Contracts: `21c8312b022f495ebe3621d5daeed20552b43ff9`.
- OpenZeppelin Uniswap hooks: `26dc8e53f812a1ca390d470342adb6cd8c3286ad`.
- Permit2: `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219`.

The fork fixes one Robinhood block for each verification run and uses unchanged canonical Core, PositionManager, UR 2.1.1 and Permit2 runtime code. Their code hashes are asserted in test setup. Initial runtime discovery used block 63,704,585; the complete 19-test passing run used 63,713,262, with the final fixed-caller invariant regression at 63,715,501. `FOUNDATION_FORK_BLOCK` permits exact replay on an archive-capable endpoint. The public RPC can stop serving historical metadata for previously unused CREATE2 addresses; `verify.sh` captures a fresh explicit block when none is supplied. The current official deployment registry, distinct from a lagging documentation table, is `https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/4663.json`.

Fork fixtures and funding are simulated locally. Successful tests do not prove deployment, review approval, source verification, actual user trades, real fee payout or public release. Those states require separate source-bound integration/release evidence.
