# Foundation catalog and management UI bridge

`lib/module-foundation/presentation.ts` connects the admitted Foundation catalog to the existing UI primitives and produces source-bound module-action intents. It executes no contributor JavaScript, selects no products by name and sends no wallet transaction.

## Launch picker

```typescript
const modules = presentFoundationCatalogV1({
  catalog, // bound by trusted review/release readers
  chainId,
  hostAdapterId,
  context, // verified account, asset and component reference data
});

const composition = composeFoundationUiSelectionsV1({
  catalog, chainId, hostAdapterId, context,
  selections: draft.modules,
  creatorFeeBps: draft.creatorFeeBps,
});
```

`presentFoundationCatalogV1` returns `FoundationModuleDescriptor[]` for the existing picker. It maps `id` to the exact source `packageId`, `version` to source semantic version and `digest` to the admitted Foundation manifest hash. It includes actual availability, explicit source capabilities and mutually exclusive module identities/resources.

`composeFoundationUiSelectionsV1` resolves all three identity fields against the trusted catalog before reconstructing source configuration. It then calls `composeFoundationModulesV1` for the actual ABI selections, ordering, capabilities, gas limits and budget constraints. A changed or unavailable source selection returns `ok:false`, diagnostics and no executable modules. UI `available` flags cannot authorize a transaction.

### Generic fields

- Nested records flatten to stable JSON-pointer keys such as `/settings/ceiling`.
- Integers, booleans, strings, bytes and addresses use the existing primitive controls.
- Account and component handles can display resolved address defaults; explicit input becomes an address-bearing source value.
- Asset fields accept ERC20 contract addresses on chain 4663. Resolve their metadata through the generic [asset adapter](ASSETS.md) before decoding or composition. Existing verified source aliases remain accepted; displayed defaults use actual addresses. The source compiler retains chain and decimals in its bindings.
- Bounded compound values use a text control containing inert JSON. The existing source compiler still validates schema, size, ranges and ABI compatibility. A richer list editor can consume the same schema later without package-specific code.
- Fixed source bindings are omitted from editable fields and restored from the exact schema. Extra form keys, including attempted hidden overrides, are rejected.
- Source defaults remain editable only where the schema permits it. Required values and source constraints are checked again during composition.

`presentFoundationFieldsV1(schema, defaults?, context?)` and `decodeFoundationFieldsV1(schema, values, defaults?, context?)` are also available for action forms. Pointer keys are generated internally from validated schema names. The adapter never interprets form strings as executable code or external resource URLs.

### Creator-fee share

The existing UI selection shape has no separate share field. Modules with both the own-quote-budget resource and action phase receive the reserved field:

```typescript
FOUNDATION_CREATOR_SHARE_FIELD_V1 === "$creatorSharePercent"
```

It displays **Share of creator fees (%)**. The input range is 0 through 100 with at most two decimal places. Exact string arithmetic maps `25.50` to `2550` creator-share bps. The reserved field is removed before source-schema encoding. A module without the relevant resource cannot request a share, and the core composer caps all selected shares together at 10,000 bps. The separate fixed 30-bps platform fee is outside this allocation.

## Existing pool action context

Before exposing module actions, the trusted chain reader must verify the canonical launch factory and pool identity, current source release, module count, immutable composition hash, `moduleAt(index)`, the module's `context()` and its actual runtime code. Read all observations at the same explicit block. The reader supplies these data separately from user action input:

```typescript
const instance = bindFoundationActionContextV1({
  catalog, chainId, hostAdapterId, context,
  selections: originalLaunchSelections,
  readback,
});
```

The `FoundationActionReadbackV1` type specifies the required data. `sourceVerificationDigest` refers to the caller's completed canonical factory/pool check; a digest copied from request JSON is not proof. The library itself makes no RPC requests and cannot authenticate a user-supplied readback.

The binder recomposes the original launch choices and matches the result to the host's `compositionHash`. It checks module index/count, actual/pinned/catalog runtime hashes, configuration hash, canonical descriptor hash, release identity and the complete host/token/quote/creator/ledger/pool context. This prevents replacing a package version, module index, runtime or launch configuration while retaining a plausible UI label.

The bound context is deeply frozen and local to the process. Serialization loses its preparation authority. Readbacks older than 120 seconds, or more than 30 seconds ahead of the local clock, are rejected. The optional `now` argument exists for deterministic tests and trusted clock integration; it must never come from user request data.

## Action display and intent preparation

```typescript
const actions = presentFoundationActionsV1({
  catalog, instance, account, context, roleGrants,
});

const intent = prepareFoundationActionIntentV1({
  catalog, instance, account, context, roleGrants,
  selection: {
    id: action.moduleId,
    version: action.version,
    digest: action.digest,
    actionId: action.actionId,
    configuration: formValues,
  },
});
```

Presented actions include `id` (`packageId:actionId`), `moduleId` (the source package ID), `version`, `digest`, `actionId`, `label`, `description`, `role`, primitive `fields`, `available` and any `unavailableReason`/`unavailableCode`. The generic UI can retain the complete descriptor while using `id` as its stable key.

The source's `creator` role requires the current onchain creator wallet. An explicitly declared `public` action is open to any nonzero caller at the presentation layer. The reviewed module remains responsible for enforcing its actual authorization and state constraints. Other role names need an application-owned `FoundationActionRoleGrantV1` containing the role, account, exact bound context key and verified role-evidence digest. Grants must come from a trusted resolver, never user form data. A grant for another pool, block or caller does not apply.

Without a valid source-bound custom-role grant, presentation and intent preparation report `FOUNDATION_ACTION_ROLE_INTEGRATION_REQUIRED`. This means the application has not established that role's current state. It does not assert that the connected wallet lacks the role. A wrong creator wallet remains a separate `FOUNDATION_ACTION_ROLE_REQUIRED` result.

`prepareFoundationActionIntentV1` validates source identity and action membership again, applies the role constraint, decodes only the reviewed fields and uses `encodeFoundationActionV1` for the action payload. The only transaction target is the bound hook. The final frozen intent contains:

- `transaction: { from: account, to: boundHook, data, value: 0n }`.
- Calldata for the actual **`executeModuleAction(uint256 index, bytes data)`** entrypoint of `FoundationHookV1`.
- Package/manifest identity, action/role, module instance/index, chain, readback block and expiry.
- An account- and calldata-bound `contextKey`, the `readbackContextKey` and `simulationRequired:true`.

The root wallet controller must simulate these exact bytes, display the observed effects and relevant recipient/amount information, revalidate account/chain/expiry, and request the personal signature only for that reviewed transaction. An intent is not a simulation result or a successful action. Module actions may use their own credited quote budget according to the reviewed source; this adapter grants no token allowance, payable value or direct arbitrary transaction target.

Platform/creator fee payouts are separate ledger operations. The contracts expose permissionless claim triggers whose recipients remain fixed by the ledger. They should use the root's source-verified claim reader and wallet path, preserving fee credit, actual payment and pending settlement as separate states.

## Validation boundary

The focused presentation suite verifies nested/fixed field projection, exact percent-to-bps conversion, stale identity rejection, bounded inert JSON and asset context, actual hook calldata, creator/custom/public role treatment, current source/code/configuration/composition binding and stale/serialized context rejection. Rendered UI, real RPC readbacks, simulations and wallet signatures remain root integration checks.
