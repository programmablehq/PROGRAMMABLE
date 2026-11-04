# Product-to-contract bindings

New independent declarations can bind product components and interface actions to concrete fixture contracts and canonical function signatures. The public-interface stage returns the bindings in its existing call. There is no additional model stage or contract execution.

Token, hook and vault components require a source contract. An adapter can have a contract binding when it executes onchain; an offchain reader stays unbound. A component may share a contract with another component. Each bound action targets that same component contract, has the expected read/write mutability, and has a successful declared example linked to its saved requirements. Compilation must contain the exact function before an implementation view is generated.

The implementation view binds the product plan, source project, compiler artifacts and independent declaration. Its evidence distinguishes a compiled interface from passing declared scenarios. It has no deployment address and always records `deployed: false`. A later runtime binding must use independently confirmed deployment identity before it can enable wallet actions. External services and UI-only actions are not silently converted into contracts.

Legacy completed declarations retain their original hash and remain resumable. Their absence of new interface metadata does not revoke existing validation. New declarations with a product plan must provide complete component and action links before source generation.
