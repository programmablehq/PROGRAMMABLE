# Product action inputs

`prepareProductActionInput` resolves one saved product action to its component address and actual compiled ABI. It encodes only that exact function, including overloaded signatures, and rejects changed mutability, unknown fields or a function outside the bound interface. Its result is `inputs-encoded` with `authorized: false`.

Integer arguments stay decimal strings through the input boundary and are encoded as bigint. JavaScript numbers, floating point notation and values outside the ABI width are rejected. Named tuple values are reordered by the ABI rather than object key order. Arrays, nested values, dynamic data and total calldata have fixed bounds. Native value is explicit in wei and is allowed only for payable functions.

This is preparation code. It has no public route, does not query providers, cannot approve a token and cannot sign or send a transaction. The next layer must match current linked-wallet authority, current contract observations and the user-reviewed call before execution.

The intended UI needs transaction recipes, not an unexplained ABI form. In particular, an ERC20 deposit may require a correctly scoped allowance; a native deposit needs an explicit amount; a claim must preserve the contract's recipient and eligibility rules. Asset units must come from actual bound metadata. These are not inferred from an argument named `amount`. Required work includes typed read-only results, contract-specific parameter presentation, gas/state preview and wallet confirmation.
