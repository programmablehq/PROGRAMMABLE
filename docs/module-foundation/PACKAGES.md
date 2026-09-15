# Foundation packages and catalog admission

The Foundation host composes reviewed, immutable module instances when creating a new launch pool. Packages describe capabilities, configuration and actions through inert data. Product names and categories do not control admission or execution. A launch with no optional packages still uses the mandatory platform-fee hook.

This document describes the local package and composition implementation. A passing test, source package, accepted review, catalog record and deployed runtime are different evidence states. None of the technical test fixtures is a publicly available product module.

## Interfaces

| Export | Responsibility |
| --- | --- |
| `createFoundationModuleManifestV1(sourceDescriptor, requestDigest)` | Bind the existing source-package identity to the Foundation extension. The request digest refers to the original immutable source submission. |
| `bindFoundationModuleManifestV1(value)` | Validate a received Foundation source manifest. |
| `readFoundationPackageExtensionV1(manifest)` | Read the versioned host, descriptor, configuration mapping, defaults and action definitions. |
| `hashFoundationModuleDescriptorV1(descriptor)` | Produce the exact onchain descriptor hash. |
| `hashFoundationModuleManifestV1(manifest)` | Produce the source manifest digest used by independent review. |
| `encodeFoundationConfigurationV1(manifest, values, context)` | Resolve the generic source schema, check source constraints and encode the reviewed ABI fields. |
| `encodeFoundationActionV1(manifest, actionId, values, context)` | Encode an action declared by that source version as bytes for the host. |
| `bindFoundationCatalogV1(document, authority)` | Bind records to separately obtained accepted-review and runtime snapshots. |
| `resolveFoundationCatalogEntryV1(catalog, packageId)` | Resolve one exact source-package version, including its availability diagnostics. |
| `composeFoundationModulesV1(input)` | Check selected capabilities, budgets, ordering and conflicts, then return real `ModuleSelection[]` and the onchain composition hash. |

Configuration uses the existing `OpenConfigSchema` and ABI-field mapping implementation. Supported records, bounded arrays, integers, addresses, assets, bytes and strings remain data. Every declared configuration field must be represented in committed bytes; overlapping paths and mappings that encode only selected array elements are rejected. Schema-only variants supported by the source intake still need a corresponding executable codec before Foundation admission. Required inputs must resolve before encoding. Schema fixed bindings reject overrides. Defaults are form data; a form should resolve the reviewed defaults and explicit user values before preparation.

The optional `context` resolves already known account, asset and component handles. It grants no wallet or chain authority. A backend must supply its authenticated actor and verified chain context and simulate the resulting transaction.

## Source descriptor extension

Reuse `OpenSourcePackage` from `packages/classic-modules/src/open-packages.mjs`. The existing source transport already accepts namespaced runtime names, `requiresHost` capabilities and `extensions`. Place the following data at `sourceDescriptor.extensions["programmable.module-foundation@1"]`:

```typescript
interface FoundationPackageExtensionV1 {
  hostAdapterId: string; // programmable.module-foundation.host@1
  descriptor: FoundationModuleDescriptorV1;
  descriptorHash: Hex;
  configurationCodec: "programmable.foundation-abi@1";
  configurationAbi: readonly ModuleEngineConfigurationArgument[];
  defaults: OpenConfigValue;
  actions: readonly {
    id: string; // matches sourceDescriptor.management.actions[].id
    selector: Hex; // unique nonzero bytes4
    configurationAbi: readonly ModuleEngineConfigurationArgument[];
  }[];
}
```

Use `programmable.module-foundation.solidity@1` for the source runtime of the module and its factory. Declare separate components with their pinned source path and Solidity entrypoint. Component identifiers can be package-specific; the review plan selects the actual module and factory components. Neither identifier nor runtime name is a business classification.

The Foundation manifest contains exactly:

```typescript
{
  schemaVersion: "programmable.module-foundation.package.v1",
  packageId, familyId, requestDigest, sourceDescriptor
}
```

`packageId` and `familyId` are derived by the existing source-package validator. The source descriptor, including the extension, stays bound to its original source request. There is no embedded deployment or approval flag.

## Onchain binding and limits

`Descriptor` field order is `moduleId:bytes32`, `abiVersion:uint16`, `phases:uint8`, `resources:uint8`, `beforeGas:uint32`, `afterGas:uint32`, `actionGas:uint32`, `failOpenAfter:bool`, `exclusiveGroup:bytes32`.

`descriptorHash = keccak256(abi.encode(descriptor))`. Solidity represents the struct as a tuple; a JSON hash or packed hash is a different commitment. The test suite includes a vector independently produced with Foundry `cast abi-encode` and `cast keccak`. See the [Solidity ABI specification](https://docs.soliditylang.org/en/latest/abi-spec.html).

The current onchain module selection is:

```typescript
{
  factory, factoryCodeHash, moduleCodeHash,
  descriptorHash, configuration, creatorShareBps
}
```

The host creates a fresh module, checks its runtime code, context, configuration hash and descriptor hash, and retains that immutable composition. `composeFoundationModulesV1` preserves the explicit selection order and computes `keccak256(abi.encode(keccak256("programmable.module-foundation.v1"), selections))`, matching the host.

| Capability | Declaration and constraint |
| --- | --- |
| Base host | `programmable.module-foundation.host@1`; descriptor ABI version 1 |
| Configuration | `programmable.foundation-abi@1` |
| Before swap | Phase bit 1; `programmable.module-foundation.before-swap@1`; 10,000–300,000 gas; failure reverts the swap |
| After swap | Phase bit 2; `programmable.module-foundation.after-swap@1`; 10,000–300,000 gas; explicit `failOpenAfter` |
| Action | Phase bit 4; `programmable.module-foundation.action@1`; 10,000–2,000,000 gas; failure reverts the action |
| Own quote budget | Resource bit 1; `programmable.module-foundation.own-quote-budget@1`; requires the action phase |
| Composition | At most eight modules, unique `moduleId`, at most one claimant per nonzero `exclusiveGroup`, combined before/after gas at most 1,200,000 |
| Disabled phase | Its gas must be zero; a disabled after phase cannot set `failOpenAfter` |
| Encoded data | Configuration and action data each at most 16,384 bytes |

`failOpenAfter` applies only when the module call reverts or exhausts its allocated gas; that call's effects are rolled back. A successful call returning an invalid acknowledgment, or a runtime-code mismatch, is a conformance failure and reverts the entire swap. The flag never preserves partial effects of a failed callback.

The creator can assign up to 10,000 bps of the **creator-fee proceeds** across selected modules. A nonzero share requires the own-quote-budget capability and action phase. The remaining share belongs to the creator. Quote amounts remain raw ERC20 units. Module claims never include the separate fixed **30-bps platform fee** credited to `0xD88539d3c4C460136a733A3Fd60cf6BF269079da`; they cannot redirect that recipient. This fee is separate from Uniswap protocol fees and LP fees.

Actions use `selector || abi.encode(inputs)` inside `host.executeModuleAction(index, data)`. The host forwards the real caller as `actor`. The reviewed module enforces its declared actor authorization and state rules. UI role labels and locally encoded data do not prove permission. Before exposing an action for an existing pool, the reader must verify the pool's host, selected module index, code hash, configuration hash and descriptor against its launch binding. There is no direct arbitrary transaction target supplied by package JavaScript.

## Review and release authority

Each catalog document entry has `{ manifest, review, release }`. Either evidence reference can be `null`. Missing acceptance produces `review_pending`; missing code/deployment binding produces `release_pending`. Copied references without independent confirmation produce `authority_unverified`.

The review reference has exactly:

```typescript
{
  submissionId, requestDigest, sourceManifestHash, manifestHash,
  artifactDigest, decisionDigest, reviewer, reviewerPolicyDigest
}
```

`sourceManifestHash` uses the existing SHA-256 canonical JSON domain `programmable.modules.source-manifest.v1`. `manifestHash` uses SHA-256 of `canonicalJson({domain: "programmable.module-foundation.package.v1", value: manifest})`. These are offchain review commitments; they are distinct from the onchain descriptor hash. The reviewer must differ from the source author.

The release reference has exactly:

```typescript
{
  chainId, hostAdapterId, releaseDigest, manifestHash,
  deploymentEvidenceDigest, runtimeVerificationDigest,
  factory, factoryCodeHash, moduleCodeHash, descriptorHash
}
```

`bindFoundationCatalogV1` takes a separate trusted argument `{ admissions, releases }`. The application constructs admissions from the authenticated accepted-review export after verifying its subject and independent reviewer decision. It constructs releases from the independently admitted Foundation host release and current deployed factory/runtime readback. Matching hashes alone are not authentication. Never populate the trusted argument by copying fields from the submitted catalog or launch request.

The bound catalog is deeply frozen and process-local. A JSON serialization is suitable for display; it loses the transaction-preparation binding. The server must freshly rebind trusted snapshots before composition, and simulate the actual factory/host construction before presenting wallet calldata. This library supplies no long-lived guarantee that a historical code observation is current.

## Existing Contributor and Review API bridge

The existing public intake path can carry the new source packages without a product-specific branch:

1. The owner-controlled client validates `client.context()` and its `modules:submit` scope before mutation. The stable transport is `POST /v1/modules/submissions` with `programmable.modules.submission.v0.1`, exact source files and a stable idempotency key. Keep its receipt separate from review and deployment.
2. `validateModuleSubmissionRequest` binds the source bytes, `packageId`, `familyId` and `requestDigest`. `validateOpenPackage` already permits the Foundation extension and runtime names. No new product enum is needed in either validator.
3. The Foundation review adapter must be a versioned peer of the existing native/engine adapters. Use plan schema `programmable.modules.foundation-build-plan.v1`, artifact schema `programmable.modules.foundation-build.v1` and runtime `programmable.module-foundation.solidity@1`. The plan selects the module and factory component IDs, the immutable source subject, configuration ABI, and bounded technical cases.
4. Reuse the protected isolated-build worker, exact source/plan reconstruction, authenticated worker result and existing independent reviewer decision record. The artifact must bind the module and factory ABIs/bytecode, descriptor ABI hash, configuration hash, manifest hash, immutable/context behavior and exercised phase/resource/action checks. A generic engine artifact is insufficient because it uses a different host ABI and money-rights model.
5. Project the accepted decision through the existing authenticated `programmable.modules.review-export.v1` path. Map `subject.submissionId` and `subject.requestDigest` directly; map the accepted artifact and decision digests; use the decision's independent reviewer wallet and the service's verified policy digest. Recompute both source/manifest digests against the exact exported descriptor. The reader must reject a decision for another artifact or source revision.
6. Independently confirm release admission, factory code, module runtime, Foundation descriptor and host release. Supply the resulting release reference and accepted-review reference as trusted catalog snapshots. Only then can a module entry become selectable.

Relevant existing integration points are `packages/classic-modules/src/open-client.mjs`, `open-transport.mjs`, `open-packages.mjs`, `open-review.mjs`, `lib/module-mode/review-contract.ts`, `lib/module-mode/review-engine-contract.ts`, and `lib/server/module-mode/review-client.ts`. The protected backend counterpart needs the same Foundation schema dispatch and worker adapter once; subsequent packages within that ABI supply data and their own conformance cases.

`reviewStatus.state === "accepted"` remains an accepted source decision. The existing owner projection deliberately keeps deployment/availability fields false. Do not reinterpret it as a registry admission or reuse a native/engine availability record for a Foundation module.

## Extending the catalog

A new package within the exposed phase/resource/configuration/action capabilities follows the same source → review → release binding → catalog → selection → launch/action path. It needs its own conforming implementation and focused tests for the resources and interactions it actually uses. The application does not add a product-name switch.

Unknown `requiresHost` names remain valid source ideas. Composition returns the exact missing capability and selected host adapter so the author can add the appropriate versioned adapter and evidence. New money rights, other assets, new execution phases or different failure semantics may require new reviewed core code and a new host version. An application-owned adapter declaration is not itself proof that those semantics are implemented.

New catalog modules initially apply to new launches. Existing hook addresses are part of immutable Uniswap pool keys. This package path exposes no proxy, upgrade mechanism or retroactive module replacement.

## Focused local validation

`tests/module-foundation-catalog.test.ts` covers the independent descriptor ABI vector, real configuration/action encoding, fixed bindings, complete field coverage, zero modules, two compatible stateful-package descriptors with separate budgets, explicit conflicts, gas limits, claim authorization, code/source binding, missing authority, unknown capabilities and serialized-catalog rejection. The fixtures model package conformance; executed module state isolation and fee accounting require the separate contract/fork tests. This is deliberately a small invariant-oriented suite, without enumerating all possible future module combinations.
