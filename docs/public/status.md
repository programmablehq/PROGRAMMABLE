---
description: Check whether an operation is available and follow its progress
---

# Service status

Service availability, launch progress and index freshness are different checks. A running API may still be unable to authorize a particular launch.

| Operation | Where to check |
| --- | --- |
| Launch a Module Mode coin | The builder and [Foundation discovery](https://programmable.market/api/module-foundation) |
| Prepare a Custom Launch | [Product discovery](https://programmable.market/.well-known/programmable.json) and its chain-specific capabilities |
| Follow an existing request | The status URL returned with that request |
| Check indexed launches | The checkpoint and data-quality fields in the selected source feed |

## Custom Launch availability

For Robinhood V4, `publicWrites`, `publicAuthorization` and `releaseReady` must be true for the version and chain entry. Use the client release advertised there. MultiRole publishes its own capabilities and request requirements.

The [Custom Launch quickstart](developers/custom-launch-quickstart.md) covers the workflow. The [API reference](developers/custom-launch.md) explains states and error responses.

General Custom Launch Plans have a separate operation status at `/v4/chains/4663/custom-launch-capabilities`. Check `availability.operations.create.state`; preflight and reads may be active while creation reports `disabled`. `PLAN_OPERATION_DISABLED` requires a platform release change, not a different API key.

## Delays and missing data

Follow a request's returned next action. A prepared package is not yet an authorized wallet transaction. Source verification follows finality and is checked separately from indexing.

Keep verified launch records when price or chart data is missing. Show missing or stale values as such. External terminals determine their own indexing schedule and trading support.
