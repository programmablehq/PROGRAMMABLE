# Foundation module action runtime

`lib/module-foundation/action-runtime.ts` connects the admitted package catalog and schema-derived management forms to the actual FoundationHookV1 ABI. An admitted package that stays inside this ABI supplies its configuration mapping and management actions as data. It needs no package-name switch or contributor JavaScript in the application.

## Application API

```ts
const runtime = await readFoundationActionRuntimeV1({
  client,
  binding,                 // Application-authorized foundation deployment pins.
  pool,                    // { token, quote, hook, poolId }
  catalog,                 // bindFoundationCatalogV1 result with current authority.
  selections,              // All original UI selections, in launch order.
  context,                 // Application-resolved assets/accounts/components.
});

const presented = presentFoundationActionsV1({
  catalog,
  instance: runtime.instances[moduleIndex],
  account,
  context,
});

const prepared = await prepareFoundationModuleActionV1({
  client, binding, pool, catalog, selections, context,
  account, moduleIndex,
  selection: { id: packageId, version, digest: manifestHash, actionId, configuration },
  minimumWalletDeltas: [{ token: quote, minimumDelta: minimumQuoteGain }],
  resolveRole,             // Optional application-owned async role reader.
});
```

The returned `FoundationPreparedModuleActionV1` contains one `module-action` step, its exact intent, measured balances, locked balance checks, the original selections and action form, a checkpoint, an expiry, and the deployment binding. Its `sourceKind` is `module-foundation-v1`. It contains no RPC client, function, supplied role grant, or wallet signer and can be cloned for a private preparation registry.

The low-level runtime does not create a wallet authorization. The application SDK must privately record and freeze the successful preparation, require that private record at the wallet boundary, and invoke this validator immediately before sending:

```ts
const current = await revalidateFoundationModuleActionV1(prepared, {
  client,
  catalog: await resolveCurrentAdmittedCatalog(),
  binding: await resolveCurrentDeploymentAuthority(),
  account: connectedAccount,
  resolveRole,
});
```

The validator rebuilds the intent and repeats the simulation with the reviewed balance minima. The original wallet step remains the reviewed step. A changed caller, release, module instance, manifest, action, target, native value or calldata requires another review. A serialized object or arbitrary result passed directly to this function does not gain wallet authority; the enclosing SDK's private registry enforces that boundary.

## Current chain observation

The V1 runtime fixes the actual host adapter to `programmable.module-foundation.host@1` and chain 4663. It uses the SDK's `assertFoundationInfrastructure` and `assertFoundationPool` before reading modules. Those assertions establish the currently pinned infrastructure and canonical launch-factory registration. The module factory in a catalog entry is a separate address from the foundation launch factory in `binding`.

All subsequent reads use the returned block number:

1. Hook `moduleCount()`, `compositionHash()` and deployed code.
2. The complete original composition, reconstructed through `composeFoundationUiSelectionsV1` and `composeFoundationModulesV1`.
3. `moduleAt(index)` for every installed module. Its return is one `Module` tuple containing `instance`, `codeHash`, `configurationHash` and the `Descriptor` tuple.
4. Actual child and module-factory code hashes, child `configurationHash()` and child `descriptor()`.
5. Child `context()` with the exact ABI order `host, token, quote, creator, ledger, poolId`.
6. The checkpoint block hash again, to detect a reorganization during the reads.

Every installed module must match its admitted code, descriptor and original configuration. Checking all children also covers an action that uses the official swap route and invokes another installed module's callbacks. Child contexts must match the registered host, pool, token, quote, creator and ledger. Duplicate child instances are rejected.

`sourceVerificationDigest` hashes these completed public RPC observations, the registered launch and the deployment pins. It is a deterministic observation reference. Source review, admission, deployment and release authority remain the separate catalog and deployment records; the observation digest creates none of them.

## Call and balance boundaries

The transaction is always:

```solidity
FoundationHookV1.executeModuleAction(moduleIndex, selector || abi.encode(actionInputs))
```

The target is the verified hook, `from` is the connected caller, and native value is zero. The hook forwards that caller to the installed module's `onAction`. It enforces its own phase, code and acknowledgement checks. There is no caller-supplied action target or native transfer value.

The runtime uses the real `simulateFoundationSequence` path: ERC20 `balanceOf(caller)` calls before the action, the exact action, and the same balance reads afterward in one ephemeral RPC state. It permits no negative caller balance delta for the launch token or quote. Callers may request nonnegative minimum gains for those assets and up to two additional ERC20 assets, subject to the four-asset sequence limit. A revert, malformed balance read, unexpected hook return data or inadequate observed balance delta fails preparation.

Without an explicit minimum for a protected asset, any positive gain observed during preparation becomes its minimum for the later review replay. If preparation sees a gain of 25 raw quote units, a replay showing 24 units requires a fresh review. If the caller explicitly asked for 20 units, that minimum stays 20.

These checks cover the explicitly measured ERC20 assets. Native gas and unspecified wallet assets are outside their scope. The result is an RPC simulation at a current checkpoint; chain state can change before execution. An amount guarantee at execution must be enforced by the admitted module's source and its action inputs. The generic hook does not add an onchain wallet-delta guard or an action deadline.

## Roles

The reviewed source action declares its role. `creator` binds to the actual hook creator and `public` admits any valid connected account. Other role names require an application-owned `FoundationActionRoleResolverV1`:

```ts
type FoundationActionRoleResolverV1 = (input: {
  client: PublicClient;
  checkpoint: FoundationCheckpoint;
  instance: FoundationActionContextV1;
  account: Address;
  actionId: string;
  role: string;
}) => Promise<FoundationActionRoleGrantV1 | null>;
```

The resolver must derive a grant from the reviewed source's real role state at that checkpoint. A grant binds the exact role, account, instance context key and evidence digest. Contributors and form inputs cannot install the callback or supply trusted grants. Revalidation invokes the resolver again against the fresh bound instance. The action's own simulation and contract authorization remain necessary even after a grant is resolved.

## Restore the original selections

```ts
const restored = decodeFoundationLaunchSelectionsV1({
  catalog,
  calldata: launchTransaction.input,
  context,
  packageIds: originalArtifact.packageIds, // Needed if several admitted packages share the same bindings.
});
```

The helper decodes the exact foundation `launch` ABI, requires canonical full calldata, and identifies each currently admitted package through module factory, factory code hash, module code hash and descriptor hash. It restores the reviewed ABI fields, then re-encodes them byte for byte against the source configuration schema. UI selection IDs, versions and manifest digests come from that admitted entry. It preserves module order and converts the original `creatorShareBps` into the schema-derived percentage field.

Named tuples, nested records, ABI arrays, integers, booleans, bytes, strings and address fields use the existing generic configuration mapping. Asset addresses require a unique matching asset in the application's verified context because raw ABI addresses contain no token decimals or metadata. Fixed source values remain fixed and are checked by exact re-encoding. The helper never guesses source IDs, package versions, decimals, review digests or release evidence.

Several packages can legitimately share one runtime and descriptor. In that case the original artifact must supply the package IDs to resolve the ambiguity. A package that is no longer currently admitted is not silently replaced by a newer version.

The result explicitly includes `transactionVerified: false`. Parsing calldata proves its contents, not that the transaction was sent or succeeded. The application must establish canonical transaction/receipt and launch-factory provenance, or use the restored selections in `readFoundationActionRuntimeV1`, which compares their full composition against the actual registered pool. The decoder's `calldataHash` is a byte reference and is never review or deployment evidence.

## Local validation

`tests/module-foundation-action-runtime.test.ts` uses technical state-cell package fixtures. It exercises the actual SDK sequence simulator with mocked RPC results and mocks the infrastructure assertions already covered by the SDK tests. Coverage includes zero and two installed modules, changes in an unselected child's code/configuration/descriptor/context, factory changes, composition limits and reorganization, exact hook targeting, caller losses, minimum gain replay, custom roles, stale identities, and exact launch configuration restoration. These are local tests, not deployed or funded lifecycle evidence.
