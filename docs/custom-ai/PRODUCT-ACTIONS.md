# Product action inputs

`prepareProductActionInput` resolves one saved product action to its component address and actual compiled ABI. It encodes only that exact function, including overloaded signatures, and rejects changed mutability, unknown fields or a function outside the bound interface. Its result is `inputs-encoded` with `authorized: false`.

Integer arguments stay decimal strings through the input boundary and are encoded as bigint. JavaScript numbers, floating point notation and values outside the ABI width are rejected. Named tuple values are reordered by the ABI rather than object key order. Arrays, nested values, dynamic data and total calldata have fixed bounds. Native value is explicit in wei and is allowed only for payable functions.

This input preparation code cannot approve a token or sign or send a transaction. Write actions still need current linked-wallet authority, current contract observations and the user-reviewed call before execution.

The intended UI needs transaction recipes, not an unexplained ABI form. In particular, an ERC20 deposit may require a correctly scoped allowance; a native deposit needs an explicit amount; a claim must preserve the contract's recipient and eligibility rules. Asset units must come from actual bound metadata. These are not inferred from an argument named `amount`. Required work includes typed read-only results, contract-specific parameter presentation, gas/state preview and wallet confirmation.

The getter reader combines those exact inputs with a recent, matching product runtime observation. It reads code and the function result through both existing providers at that snapshot block, rejects disagreement and preserves integer results as decimal strings. Its RPC adapter allows only the exact caller, target, calldata and block.

The owner can request `GET /api/custom-ai/product-value?id=<preparationId>&action=<savedActionId>` with the current session and cache scope. The request chooses a saved action only. It cannot supply addresses, selectors, arguments, providers or a block. The server supports read functions with no inputs or one address explicitly named for a wallet/account/holder; that argument and the call sender are the original launch wallet. An address named `token` is not treated as a wallet. Other inputs and all write functions remain unavailable in this flow.

The collapsed **Contract values** panel lists only these supported getters after the owner checks deployed contracts. It makes no automatic requests or polling. Reads are coalesced and cached for ten seconds, failures back off for three seconds, and the route allows thirty requests per minute per account. Each uncached getter uses at most four calls per provider in addition to its shared runtime observation. Outputs include their block and read time. Numeric values remain in the contract's units; token symbols and decimals are not guessed.

Getter results refer to the recorded finalized block, which can lag the latest chain state. They are not a spendable-balance guarantee for a later transaction; a wallet action needs its own current-state preview.
