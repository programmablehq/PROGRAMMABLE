# Foundation factory V2 interface

This is a new factory with permanent DEAD custody for every position it creates. Existing V1 contracts and pools keep their V1 ABI and behavior. This document defines the implementation interface; it is not release acceptance or a deployment record.

## Version and custody getters

| Getter | Solidity return | Fixed value |
| --- | --- | --- |
| `VERSION_ID()` | `bytes32` | `keccak256("programmable.module-foundation.factory.v2")` |
| `MODULE_ABI_ID()` | `bytes32` | `keccak256("programmable.module-foundation.v1")` |
| `LP_CUSTODY_ID()` | `bytes32` | `keccak256("programmable.module-foundation.launch-nfts.dead.v1")` |
| `LP_RECIPIENT()` | `address` | `0x000000000000000000000000000000000000dEaD` |
| `ROUNDING_INVENTORY_RECIPIENT()` | `address` | same DEAD address |
| `LP_FEE()` | `uint24` | `0` |

The public `chainId`, `poolManager`, `positionManager`, `universalRouter`, `permit2`, `hookDeployer` and corresponding five `*CodeHash` getters retain their V1 types and meaning. The constructor retains the five infrastructure addresses in that order followed by `bytes32[5] expectedCodeHashes`. Its router interface type is named `IFoundationUniversalRouterV2`; the encoded constructor ABI is unchanged.

`FoundationTokenV1`, `FoundationHookDeployerV1`, `FoundationHookV1`, `FoundationLedgerV1`, `FoundationFeeMathV1`, `FoundationTypesV1` and `IFoundationModuleV1` sources are unchanged. The existing deployer can initialize a V2 hook for the V2 factory. Reusing a deployed deployer still requires a genuine new source/release binding.

## Functions and launch input

```solidity
launch(FoundationTypesV1.LaunchParams p)
    external returns (FoundationLaunchTypesV2.LaunchResultV2 result);
launchOf(address token)
    external view returns (FoundationLaunchTypesV2.LaunchResultV2);
predictTokenAddress(address creator, bytes32 tokenSalt, FoundationTypesV1.Metadata metadata_)
    public view returns (address);
hookInitCodeHash(address creator, address predictedToken, FoundationTypesV1.LaunchParams p)
    public view returns (bytes32);
predictHookAddress(address creator, address predictedToken, FoundationTypesV1.LaunchParams p)
    external view returns (address);
```

`LaunchParams` and all its nested tuples retain the exact V1 field order and types. `launch` is nonpayable and has no recipient, custody opt-out or additional supply parameter. Creator approval to the factory covers exactly `additionalQuoteAmount + initialBuyQuoteAmount`. Prediction uses the new actual factory address; hook salt mining binds that factory as initializer. Module composition still hashes `abi.encode(FoundationTypesV1.ABI_ID, modules)`.

## Exact result tuple

`FoundationLaunchTypesV2.LaunchResultV2`, in this order:

| Field | Solidity type | Meaning |
| --- | --- | --- |
| `token` | `address` | Actual fixed-supply token |
| `hook` | `address` | Actual V1 hook initialized for this factory |
| `ledger` | `address` | Actual independent V1 quote fee ledger |
| `poolId` | `bytes32` | Hook's canonical pool ID |
| `basePositionOwner` | `address` | DEAD |
| `creatorPositionOwner` | `address` | DEAD if the extra position exists, otherwise zero |
| `roundingInventoryRecipient` | `address` | DEAD; this address is not a vault |
| `basePositionId` | `uint256` | Actual official PM NFT ID |
| `creatorPositionId` | `uint256` | Actual optional PM NFT ID, otherwise zero |
| `initialBuyTokenAmount` | `uint256` | Actual tokens sent to the creator by initial buy |
| `baseTokenPrincipal` | `uint128` | Actual token debt paid to Core for base mint |
| `baseTokenRounding` | `uint128` | `1e27 - baseTokenPrincipal`, sent to DEAD |
| `creatorQuotePrincipal` | `uint128` | Actual quote debt paid to Core for extra mint, otherwise zero |
| `actualQuoteRefund` | `uint256` | Actual final quote refund to creator |

These are immutable launch records. Principal fields describe launch deposits, not present asset composition or withdrawable rights. `launchOf` for an unregistered token returns the all-zero tuple, including all owner fields. Supply remains `1e27` after the dust transfer. No `baseVault` field or new vault exists.

## Exact event

```solidity
event FoundationLaunchedV2(
    address indexed token,
    address indexed creator,
    bytes32 indexed poolId,
    address hook,
    address ledger,
    address quote,
    bytes32 metadataHash,
    bytes32 compositionHash,
    bytes32 custodyId,
    uint256 initialBuyQuoteAmount,
    FoundationLaunchTypesV2.LaunchResultV2 result
);
```

The event is emitted only after all settlement/refund checks and registry storage. Duplicate identities inside the tuple must equal the event identities. Decode using the V2 ABI and bind the emitting factory, transaction calldata/from/to, metadata, composition, pool, actual registry and actual NFT owners. PM IDs predicted during simulation may change before inclusion; use the IDs in the actual source-bound receipt. Do not feed this tuple into the V1 vault reader.

## Atomic side effects

1. Verify chain and five runtime hashes, deadline and quote/funding bounds. Pull exact quote funding.
2. Create the fixed-supply V1 token and actual V1 hook/ledger/modules. Plan the same one-sided base band and optional quote-only opposing band. Enforce their combined liquidity at the shared tick.
3. Initialize the canonical pool. `MINT_POSITION` the base NFT directly to DEAD and settle exact principal through official Permit2/PM. Keep all existing owner, single-approval, ID, range, liquidity and balance checks.
4. Transfer the exact token rounding remainder to DEAD. `MINT_POSITION` the optional quote-funded NFT directly to DEAD and settle its exact principal. No intermediate creator/factory NFT custody.
5. Execute initial buy with official UR 2.1.1, empty hook data, the same full-fill and minimum-output constraints. Send actual bought tokens to creator.
6. Refund actual remaining quote above the factory's prelaunch quote balance. Revoke allowances, require zero new-token factory balance and unchanged prelaunch quote balance. Store and emit the exact result.

Any failure reverts every effect, including NFT mints, token/hook/module creation, dust transfer, initial buy, ledger credits, approvals and refund. `BURN_POSITION` is never used for launch custody: it removes liquidity and deletes the NFT. Direct mint to DEAD leaves positive official PM liquidity in place.

## Fee and consent semantics

The pool's ordinary LP swap fee is fixed at zero, with no dynamic/configurable LP-fee path. Both DEAD NFTs forfeit all management, principal withdrawal and any position-fee collection rights. Core donations can still accrue position fees; those would be unclaimable. The separate hook charges 30 bps gross quote to the fixed platform recipient plus the configured V1 creator fee, with unchanged separately backed ledger and module budgets. These hook claims remain payable.

The creator must see and consent to permanent custody of any additional quote actually invested. The ordinary difference between additional quote funding and principal is refunded, not locked. Report the actual refund independently because V1 preserves any extra quote received during launch construction as well. Do not label dust as LP principal or a transfer to DEAD as ERC20 supply burning.

External parties retain permissionless access to official LP mint/management after launch. Those later NFTs are not covered by this factory's DEAD custody guarantee. Source verification and GMGN filter recognition need separate actual evidence before public claims.
