---
description: What a Custom Launch stamp records
---

# Launch stamps

A launch stamp records that a Programmable Router executed a Custom Launch. It binds the token, hook, pool and supporting contracts to that launch.

## Which launches use stamps?

Robinhood Custom launches with separate token and hook contracts use Router V1. A shared token and hook contract uses MultiRole V2 and Router V2. Ethereum Router launches follow their published deployment manifest.

Module Mode uses its own factory events and records. It does not need a Custom Launch stamp. Foundation and earlier Native or Engine releases must be verified with their respective interfaces.

## Verify the record

Use the source's manifest to find the Router address, code hash, ABI, start block and finality rules. Match the successful transaction, emitted events and contract lookups at the same canonical block.

The API request ID and the onchain launch ID are different identifiers. A shared token and hook address is valid under MultiRole's role rules.

A stamp proves the recorded origin and contract relationships. It does not prove an audit, present liquidity, sellability or external terminal support. A direct factory call outside the Router does not acquire a stamp later.

[Verify a launch](developers/verify.md) explains the checks and source-specific references.
