# Custom AI

Custom AI has its own immutable contract core and wallet flow. It does not use the Custom Launch submission queue or change existing Module Mode rules. Supported launch networks are Ethereum (1) and Robinhood (4663).

## Fixed rules

Every coin has 1,000,000,000 units with 18 decimals, no later mint or burn, no transfer tax, blacklist, pause or upgrade authority. The initial pre-buy FDV is $15,000, allowing the core's tick rounding up to $15,091.50. One-sided token liquidity stays permanently locked; buys and sells change the reserves and price. There is no graduation or LP withdrawal.

The platform receives 0.5% on buys and sells. Total trading fees are capped at 15%. The initial buy must be at least 0.01 ETH worth of the selected pair token, including trading fees and excluding network fees. There is no maximum buy or holding limit. These rules are enforced by the core, independently of generated code.

The hook supplies its immutable `launchTimestamp` to the fee module. A rule such as “3% for one day, then 1%” starts at the coin launch, even if its fee module was deployed earlier.

## Conversation and generation

One server-side Anthropic integration uses Haiku for standalone greetings, Sonnet for substantive conversation and generation, and Opus for one final repair after two unsuccessful Sonnet attempts. Errors in authentication, transport, quota or the isolated compiler do not trigger a more expensive fallback. Public replies use short, natural English.

The chat can update the name, ticker, chain, pair and initial buy. Generated descriptions stay bound to the successfully checked source. The interface does not present a failed replacement as a successful draft.

The current generator supports self-contained immutable fee expressions and schedules. It does not generate arbitrary reward strategies or connect weather, sports or news feeds. The core includes bounded reward and signed-data primitives, but a primitive is not a connected data service. The assistant must explain a missing integration rather than substitute a different strategy or ask a user for provider keys.

Generated Solidity runs only through the pinned solc 0.8.26 compiler and the networkless EVM worker. The child receives no production environment, network access, file-write access or process-spawning permission. Its imports are supplied explicitly. Mutable storage, external calls, loops, assembly and unsupported capabilities are rejected. Each accepted module is also executed with the exact factory, hook, router and vault bundle on both chain configurations. Sampled checks are not an audit or proof of all possible program behavior.

## Accounts, drafts and wallet operations

Public API access requires the existing Privy session and a linked wallet. Conversations, generated artifacts, image receipts and wallet operations are private to that account. Images use the existing image store and a verified immutable receipt. Device caching supplements the shared Postgres state.

The runtime database role can select, insert and update only the dedicated Custom AI tables. It cannot create schemas, delete rows, bypass row security or administer the database. TLS verification remains enabled. Per-account, concurrency and global generation budgets are shared across server instances.

Launch and trade operations persist before a wallet prompt. Cross-tab and server locks prevent overlapping wallet dispatches. Uncertain sends retain their nonce reservation. Recovery searches for replacements, verifies the actual transaction against a saved candidate, and never treats cancellation as success. A changed quote is shown before another wallet prompt.

The router's `SwapSettled` event follows exact sender and recipient balance checks. Confirmed swaps bind that event and the hook fee event to one canonical receipt. Fee claims use the fixed-recipient vault/ledger event after the same core balance checks. Arbitrary external-token Transfer events are not the settlement authority.

## Pair compatibility

A user may enter an ERC20 address on the selected chain. Known WETH implementations retain their exact-runtime review. Generic tokens undergo an automatic, same-checkpoint transfer simulation using existing holder balances. It exercises transfer, approve, transferFrom, allowance reduction, approval reset and return transfers on two independent providers. It does not forge token balances, allowances, code or storage. A holder is impersonated only inside the read-only simulation; no transaction is sent.

Admission means those operations matched the expected balances at that checkpoint. It does not certify absence of admin powers or future changes. The interface displays unreviewed external-token rights. Robinhood WETH's known upgrade and bridge-burn powers are also displayed. They are not powers over the newly generated coin.

The creator-funded launch and wallet trade are simulated separately using their actual amounts. Fresh price evidence is required to enforce FDV and minimum buy. A missing price route, provider disagreement or unavailable simulation remains unresolved; the checker must not label an outage as malicious token behavior.

## Indexing and deployment

The indexer reads the bound factory from its deployment block to a common finalized checkpoint, validates exact launch calldata and all child runtimes, then atomically saves coins and its cursor. Only active deployments appear in the public catalog. A stale cursor is reported as stale. Historical transaction recovery does not depend on a new pair-compatibility check succeeding.

`lib/custom-ai/deployments.json` is the release authority. A staged deployment permits only explicitly configured canary wallets. Public activation requires matching core runtime/configuration, source verification, funded launch/buy/sell/fee evidence and the immutable acceptance-evidence hash. A local simulation or a Ready website deployment does not establish public availability.

Operational evidence and secrets stay outside the checkout. `scripts/custom-ai/prepare-core.mjs` and `probe-quotes.mjs` are read-only operators. They never sign or submit transactions.

## Local development

Use Node 24 and run `node scripts/custom-ai/install-toolchain.mjs` to install the separate pinned compiler dependencies. The local entry point accepts owner-readable credential/RPC files outside Git:

```
CUSTOM_AI_CREDENTIAL_FILE=/private/path/anthropic.env \
CUSTOM_AI_RPC_CONFIG_FILE=/private/path/rpc.json \
CUSTOM_AI_COMPILER_DIR=/absolute/path/scripts/custom-ai/toolchain \
node scripts/custom-ai/start-local.mjs
```

It binds `http://127.0.0.1:3093/launch/custom-ai`. The development bypass is limited to matching loopback Origin/Host and never enables public launches.

Production requires `CUSTOM_AI_PUBLIC_ENABLED`, `CUSTOM_AI_DATABASE_URL`, optional trusted `CUSTOM_AI_DATABASE_CA`, `CUSTOM_AI_GLOBAL_DAILY_UNITS`, `ANTHROPIC_API_KEY`, the existing Privy/image credentials, the two independent RPC bindings per chain and `CUSTOM_AI_PRICE_SIGNER_KEY`. Staged acceptance additionally uses `CUSTOM_AI_CANARY_WALLETS`. The minutely index route uses the existing `CRON_SECRET`.
