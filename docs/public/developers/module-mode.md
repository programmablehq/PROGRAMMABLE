---
description: Module interfaces, package requirements and submission access
---

# Build a module

A module is a reusable program that creators can select when launching a coin. Its package defines the source, configuration, required capabilities, funding and management actions.

**Module API-key issuance and source submissions are paused.** Custom Hook API keys do not grant module submission access. You can develop locally and use this reference for existing interfaces. Check the contribution capabilities before attempting to upload.

## Choose the host

Foundation, Native and Engine are separate host interfaces. Code written for one does not establish compatibility with another.

Foundation uses `IFoundationModuleV1` for module descriptors, swap callbacks and actions. Start with the interface and release advertised by [Foundation discovery](https://programmable.market/api/module-foundation).

Earlier Native programs use `programmable.native-solidity@1`. Engine programs use `programmable.module-engine-solidity@1`, with `constructor(Context,bytes)`, `contextHash()`, `initialize(bytes)` and `execute(Operation)`. The host binds the creation code, constructor inputs and runtime for each instance.

Describe the capabilities your module actually needs. There is no business-category allowlist. A missing host interface, adapter or review environment must be implemented and reviewed before the module can become available to creators.

## Package requirements

| Part | Include |
| --- | --- |
| Identity | Name, version, stable family identifier, author and reward wallets |
| Source | Source files, hashes, pinned dependencies and reproducible build settings |
| Configuration | Field types, units, defaults, limits and exact encoding |
| Compatibility | Host capabilities, dependencies, conflicts and resource limits |
| Funding | Assets, amounts, custody, spending rules and refunds |
| Management | Read methods, transaction inputs and the wallet roles allowed to use them |
| Evidence | Build artifacts and the tests and review evidence required by the host |

Configuration can expose an editable input or fix a value. A fixed value must be enforced by the SDK, API and constructor where required; hiding a field in the website is insufficient. Conflicting fixed values return `OPEN_CONFIG_FIXED_OVERRIDE`.

The website renders supported configuration and management controls. It does not execute arbitrary frontend code from a submission or infer the meaning of opaque action data. Document that data and declare any new control or runtime capability the module needs.

## Check submission access

Read public `GET /v1/modules/capabilities` and keyed `GET /v1/modules/context` at `https://api.programmable.market`. Uploads require both `moduleContributions.submissions` and `authorization.canSubmit` to be true. New key issuance is controlled separately by `moduleContributions.apiKeyIssuance`.

Contribution keys need `modules:submit` for uploads and `modules:read` for context and private progress. Keep credentials in `PROGRAMMABLE_API_KEY`. A Custom Launch key does not gain these scopes automatically, and an API key never signs a wallet transaction.

Use the author and default reward wallet returned by authenticated context. Read its `review.profiles` and `review.limits` before selecting an implementation. Review readiness is separate from upload permission: the legacy root `approved` and `available` fields do not describe account approval.

The [module API reference](https://programmable.market/developers/module-mode-api-v1.md) contains the package schema, verified CLI installation and exact commands. It also covers the older environment-variable alias and version-specific host limits.

## Review and publication

When submissions are enabled, prepare and test the package locally. Submit the exact request with a stable idempotency key and save the returned submission ID. Retry unchanged bytes with the same key after a timeout. Changed source needs a new revision.

The original intake receipt remains a record of the upload. Its `draft_received`, `unreviewed`, `approved: false` and `available: false` fields are not the current review result. Read the separate review resource for `review.state` and `review.nextAction`.

`awaiting_plan` means the platform must select a build plan or add missing review coverage. Review acceptance is followed by registry admission, deployed-code verification and catalog activation. Only the active catalog determines what creators can select.

An accepted build can be downloaded with the author's `modules:read` key through the HTTP review export. That export does not authorize publication. Launch and management transactions still require their assigned wallet authority.

## Existing coins and rewards

Coins retain the module revisions and configuration selected at launch. Later catalog updates do not replace them. Management actions may change only the state permitted by the deployed contracts.

Foundation allocates module rewards from the creator fee using each instance's recorded `creatorShareBps`. Its 30 bps platform fee is separate. Native and Engine releases use their own author-fee rules. [Fees and revenue](../economics.md#module-mode) covers those versions.

Index by the launch source and interface version. Module names and categories do not define a coin's identity. A new module using an existing source version does not require a new indexing model.

## Recover transactions and claims

Keep the chain, account, token address, release and transaction hash. After a timeout, check the submitted transaction and canonical receipt before sending another one.

For Foundation, resolve the original factory, read `launchOf(token)` and verify the ledger. `claimCreator()` pays the bound creator in the quote token. Module budgets use the module's authorized actions.

For earlier Native and Engine coins, use their verified management clients with the original release and your RPC. Read `claimable(account)` from the original ledger. Its `claimTo(recipient)` must be called by the entitled wallet with zero native value, apart from network gas. Engine clients expose `prepareModuleEngineClaim`; Native clients use the `claim-fees` intent.

Creator credits, module budgets and escrow refunds have separate withdrawal rules. A newer release or website outage does not move those rights to another ledger.
