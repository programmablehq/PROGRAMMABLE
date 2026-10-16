# Mandatory launch protection v1 source package

Status: release candidate. This directory is not a live launch release.

The exact compiler input is `standard-json.json`. Compile it with Solidity
`0.8.26+commit.8a97fa7a`, via IR, optimizer 200, Cancun EVM, and no CBOR metadata.
The source includes all dependencies. Generated artifacts include constructor ABI,
creation bytecode, runtime template, named immutable offsets and the input digest.
Run `node packages/launch/scripts/build-launch-protection-v1.mjs` at repository root
to check reproducibility. `historical-runtime-recipes.json` retains fee recognition
for already deployed contracts; it is not selected for new launches. Only use `--write` when intentionally updating the package.

The deployment graph contains these roots:

1. `ProtectedNativeInitializerV1(manager, graphFactory, nativeUsdFeed, feedCodeHash)`.
   Use the intended graph factory as caller authority. The manager and Chainlink
   feed must match the supported chain; feed code must match its observed hash.
2. `ProtectedLaunchTokenV1(name, symbol, supply, initializer, manager)`. Supply is in
   base units, decimals are 18, and there is no later mint. The entire inventory
   initially belongs to the initializer.
3. `ProtectedNative30HookV1(manager, config, developer, router, routerCodeHash, exemptions)`.
   Mine the hook address for flags `0x20cc` within mask `0x3fff`. Use native currency0,
   the protected token as currency1, fee zero, spacing 60, the independently calculated
   opening sqrt price, the initializer above, the creator fee recipient, and creator
   buy/sell rates. `config.module` and `config.maxModuleLpFeePips` must both be zero.
   The hook creates the normal fee vault as child 1, protection module as child 2,
   and opening-tax vault as child 3. Exemptions are a fixed array of six addresses;
   zero entries mean unused slots. Developer is already exempt from the extra tax.

After deployment, the graph factory calls
`initializer.initialize(hook, token, startTick, developer, minimumTokensOut)` with a
nonzero native initial buy. This must be part of the same atomic authorized graph.
The initializer seeds and permanently locks liquidity, checks the USD 15,000 floor
against the fixed feed, starts protection and executes the initial buy. An initial
buy above 2% of supply reverts the complete transaction.

For 300 seconds both recipient inflow and authenticated buyer purchases have a
cumulative 2% budget. Outgoing transfers, sells and burns do not restore either
budget. Buys use the fixed canonical Universal Router during this window. The dev
and up to six extra tax-exempt wallets retain both limits. For the first 30 seconds,
total buy fees start at 99% and decline to the normal fee. The additional amount is
claimable only by the fixed platform treasury; sales have normal fees throughout.

This version supports native-quoted Ethereum and Robinhood pools. Custom quote
assets and old Classic/Module Mode factories require separately verified protected
replacements. An API declaration, this package, or a runtime fee proof alone does
not grant launch approval. Exact reviewed source, authenticated execution evidence
and the ordinary admission/signing rules still apply.
