# Foundation generic asset fields

Source schemas declare `asset` fields. Their UI uses ordinary ERC20 address inputs, and the application resolves those addresses through `lib/module-foundation/assets.ts`. The same schema path serves launch configuration and management actions. Package IDs and product names do not control asset resolution.

The adapter uses the existing `readFoundationQuote` reader for standard ERC20 metadata and deployed code. It checks chain 4663, a checkpoint no older than 120 seconds, the requested block hash and a second block-hash read after metadata resolution. All ERC20 reads use that checkpoint. An RPC error or unsupported ERC20 metadata fails resolution. It inherits the reader's current metadata limits, including decimals through 36 and nonzero supply. These reads establish metadata and runtime observations; transfer behavior still requires the exact source action or launch simulation.

## Compact immutable identity

```ts
type FoundationAssetPinV1 = readonly [
  address: Address,
  decimals: number,
  runtimeCodeHash: Hex,
];
```

Chain 4663 is fixed by this adapter version. Tuples retain first-occurrence order and canonical lowercase addresses and hashes. Each additional asset appears once. `parseFoundationAssetPinsV1` validates shape, decimals, identity and limits. `mergeFoundationAssetPinsV1` deduplicates identical tuples, rejects conflicting metadata and applies the combined limit. `hashFoundationAssetPinsV1` binds the full ordered table and chain to the `programmable.module-foundation.assets.v1` domain.

These helpers do not create provenance. The launch owner must commit the actual tuples in immutable metadata, recover them from the verified original launch, and compare them with fresh chain reads. The intended social-data location is `foundation.assets` beside the ordered `foundation.packages` identities. The existing 1,200-byte metadata limit still applies and must fail explicitly if exceeded. A browser cache or a digest supplied by the browser cannot replace that commitment.

Names and symbols are current display metadata, outside the immutable tuple. A rename can update the display without changing the address, decimals or code commitment. A runtime or decimals change rejects refresh. Proxy runtime hashing is not proof that its implementation or transfer behavior is immutable; current exact transaction simulation remains required.

## Read and refresh API

```ts
const resolved = await resolveFoundationAssetsV1({
  client,
  addresses,       // Ordered addresses extracted from admitted source fields.
  context,         // App-verified BASE context: normally the coin and quote.
  checkpoint,      // Reuse the current source/pool checkpoint when available.
});

const fresh = await refreshFoundationAssetsV1({
  client,
  pins: originalImmutablePins,
  context,
  checkpoint,
});
```

Both return frozen `{ checkpoint, assets, pins, pinsDigest, context }`. `assets` includes the current names and symbols. `context` retains trusted account/component/source aliases and adds new asset references as `erc20:<lowercase-address>`. Equivalent aliases do not duplicate pins; conflicting metadata fails. `refreshFoundationAssetsV1` reads every pinned address again, even when an earlier context already contains it.

The base context is application authority, normally derived from the verified pool token and quote at the same checkpoint. Forms cannot supply it. Passing a previously expanded context to a fresh discovery call would classify those assets as existing base assets; use refresh for committed pins and pass the real base context when finding new assets. The final context and the original source schema must both reach decode/composition.

## Source-field collection and preparation

```ts
const addresses = foundationAssetAddressesForFieldsV1({
  schema: admittedSource.configuration,
  configuration: moduleFields, // Remove the reserved creator-share UI field first.
  defaults: admittedRuntime.defaults,
  context,
  deferredAssetKeys: ["token"], // Optional collection-only reference before prediction.
});

const resolvedForm = await resolveFoundationAssetFieldsV1({
  client,
  schema: admittedSource.configuration,
  configuration: moduleFields,
  defaults: admittedRuntime.defaults,
  context: completePredictedContext,
  checkpoint,
});
```

The collector follows the actual source schema through records, bounded lists, active variants, defaults and fixed values. It extracts asset positions only; ordinary address/account/component fields do not become token requests. JSON remains inert. Deferred references are permitted only during collection, only when their actual alias has not been materialized. Literal addresses are always checked. The final resolver refuses deferred-reference options and requires the real predicted address and complete verified context. An editable asset with a declared source default may be left empty to use that default; this lets an existing source reference such as `token` survive collection until its real address is predicted.

`resolveFoundationAssetFieldsV1` also returns `value`, validated by the actual source configuration compiler. Literal chain/decimals in JSON and fixed source subtrees must match the verified metadata. The final field decoder accepts either an actual resolved address or a trusted existing alias, and rejects an unresolved address. ABI encoding still contains the address only, so immutable pin binding is required separately.

Use `action.inputs` with the same helpers for management actions. The launch controller and backend must independently reconstruct asset metadata and exact source selection IDs, versions, manifest digests and creator shares before composition. Keep `composeFoundationUiSelectionsV1` as the final selection and capability validator. Recovery passes the refreshed complete asset context to `decodeFoundationLaunchSelectionsV1`, which re-encodes the original configuration exactly.

## V1 action balance boundary

The adapter permits two additional ERC20 assets alongside the coin and quote. The owner must merge launch and action pin tables before preparation and add every additional asset to the real action simulator's nonnegative caller-balance checks. This uses the existing four-asset simulation bound. More assets produce `FOUNDATION_ASSET_ADAPTER_LIMIT` and require a versioned adapter with broader balance protection.

Resolution adds no approvals, transfer permissions, native value or transaction targets. A management intent still targets the exact bound hook with zero value. Refresh immutable pins and repeat the original source/runtime/action validation and actual balance simulation immediately before wallet submission.

## Local validation

The asset tests use the real shared ERC20 reader with deterministic RPC responses. They cover empty and arbitrary asset sets, exact compact pin recovery, changes in runtime/decimals, common checkpoints, reorganization, metadata reader limits, alias consistency, literal and hidden fixed metadata, deferred prediction references, inert source fields and the combined adapter limit. Presentation/action-runtime tests also restore an additional asset through canonical launch calldata and source composition. These checks do not establish deployed or funded lifecycle evidence.
