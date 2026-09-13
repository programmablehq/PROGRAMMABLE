import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, zeroAddress } from 'viem';
import { OFFICIAL, need } from './core.mjs';

export const ANY_QUOTE_POSITION_MANAGER_ENGINE = Object.freeze({
  sourcePath: 'src/module-engine/any-quote/AnyQuotePositionManagerLPModuleV1.sol',
  contractName: 'AnyQuotePositionManagerLPModuleV1',
});
export const ANY_QUOTE_LP_CUSTODY_SCHEMA_ID = keccak256(toHex('programmable.any-quote.position-manager-custody.v1'));
export const ANY_QUOTE_POSITION_MANAGER_RESOURCES_ABI = parseAbiParameters(
  'bytes32,address,uint256,bytes32,int24,int24,uint128,uint256,uint8');
export const ANY_QUOTE_POSITION_PERMIT2 = Object.freeze({
  address: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  runtimeCodeHash: '0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca',
});
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The caller authenticates the complete reviewed artifact before selecting a resource adapter. */
export function isAnyQuotePositionManagerEngine(artifact) {
  return artifact?.sourcePath === ANY_QUOTE_POSITION_MANAGER_ENGINE.sourcePath
    && artifact?.contractName === ANY_QUOTE_POSITION_MANAGER_ENGINE.contractName;
}

export function anyQuotePositionManagerResourceHash(identity, state) {
  need(identity.anyQuoteRelease?.sourceVersion === 'module-engine-any-quote-v1'
    && isAnyQuotePositionManagerEngine(identity.manifest.source?.engine), 'Authenticated PositionManager engine required');
  need(same(state.LP_CUSTODY_SCHEMA_ID, ANY_QUOTE_LP_CUSTODY_SCHEMA_ID)
    && same(state.positionManager, OFFICIAL.positionManager.address)
    && typeof state.positionTokenId === 'bigint' && state.positionTokenId > 0n
    && state.positionTokenId < (1n << 256n), 'Any Quote PositionManager custody identity differs');
  return keccak256(encodeAbiParameters(ANY_QUOTE_POSITION_MANAGER_RESOURCES_ABI, [
    ANY_QUOTE_LP_CUSTODY_SCHEMA_ID, state.positionManager, state.positionTokenId, state.poolId,
    state.tickLower, state.tickUpper, state.lockedLiquidity, state.lockedTokenDust, state.quoteDecimals,
  ]));
}

/** Validate canonical PositionManager readback in addition to the engine's self-reported getters. */
export function verifyAnyQuotePositionManagerCustody(identity, state, actual) {
  anyQuotePositionManagerResourceHash(identity, state);
  const key = actual.poolKey;
  const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  const lower = BigInt.asIntN(24, actual.positionInfo >> 8n);
  const upper = BigInt.asIntN(24, actual.positionInfo >> 32n);
  need(same(keccak256(actual.runtime), OFFICIAL.positionManager.runtimeCodeHash)
    && same(keccak256(actual.permit2Runtime), ANY_QUOTE_POSITION_PERMIT2.runtimeCodeHash)
    && same(actual.permit2, ANY_QUOTE_POSITION_PERMIT2.address)
    && same(actual.poolManager, identity.anyQuoteRelease.contracts.poolManager.address)
    && same(actual.owner, identity.launch.engine) && same(actual.approved, zeroAddress)
    && same(poolId, state.poolId) && lower === BigInt(state.tickLower) && upper === BigInt(state.tickUpper)
    && (actual.positionInfo & 255n) === 0n
    && (actual.positionInfo >> 56n) === (BigInt(poolId) >> 56n)
    && actual.liquidity === state.lockedLiquidity && actual.permit2Amount === 0n,
  'Any Quote canonical PositionManager custody differs');
  return { positionManager: state.positionManager, positionTokenId: String(state.positionTokenId),
    custodySchemaId: ANY_QUOTE_LP_CUSTODY_SCHEMA_ID, owner: actual.owner,
    approved: actual.approved, liquidity: String(actual.liquidity), permit2Amount: '0' };
}
