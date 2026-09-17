import {
  computeLbpPoolId,
  getLauncherAddresses,
  selectTokenFactory,
  type TokenFactoryKind,
} from "@uniswap/liquidity-launcher-sdk";
import { getAddress, type Address, type Hex } from "viem";

export type OfficialLauncherDependencies = {
  liquidityLauncher: Address;
  tokenFactory: Address;
  tokenFactoryKind: TokenFactoryKind;
  positionManager: Address;
  permit2: Address;
};

export type OfficialV4PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export class OfficialLauncherSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialLauncherSdkError";
  }
}

/**
 * Addresses bundled in the pinned SDK 1.0.1, retained for package compatibility
 * verification. These are historical SDK defaults, not the current deployment
 * registry. Current Mainnet/Sepolia runtime pins live in contracts/dependencies.
 */
export function getOfficialLauncherDependencies(
  chainId: number,
): OfficialLauncherDependencies {
  const addresses = getLauncherAddresses(chainId);
  if (!addresses) {
    throw new OfficialLauncherSdkError(
      `The Uniswap Liquidity Launcher is not supported on chain ${chainId}`,
    );
  }

  const tokenFactory = selectTokenFactory(addresses);
  if (!tokenFactory) {
    throw new OfficialLauncherSdkError(
      `The Uniswap token factory is not available on chain ${chainId}`,
    );
  }
  if (!addresses.positionManager) {
    throw new OfficialLauncherSdkError(
      `The Uniswap v4 PositionManager is not available on chain ${chainId}`,
    );
  }

  return {
    liquidityLauncher: addresses.liquidityLauncher,
    tokenFactory: tokenFactory.factory,
    tokenFactoryKind: tokenFactory.kind,
    positionManager: addresses.positionManager,
    permit2: addresses.permit2,
  };
}

export function computeOfficialV4PoolId(poolKey: OfficialV4PoolKey): Hex {
  const currency0 = getAddress(poolKey.currency0);
  const currency1 = getAddress(poolKey.currency1);
  if (BigInt(currency0) >= BigInt(currency1)) {
    throw new OfficialLauncherSdkError(
      "Pool currencies must be distinct and in canonical order",
    );
  }
  if (
    !Number.isSafeInteger(poolKey.fee) ||
    (poolKey.fee !== 0x80_00_00 &&
      (poolKey.fee < 0 || poolKey.fee > 1_000_000))
  ) {
    throw new OfficialLauncherSdkError("Pool fee is invalid");
  }
  if (
    !Number.isSafeInteger(poolKey.tickSpacing) ||
    poolKey.tickSpacing < 1 ||
    poolKey.tickSpacing > 32_767
  ) {
    throw new OfficialLauncherSdkError("Pool tick spacing is invalid");
  }

  return computeLbpPoolId(
    currency0,
    currency1,
    poolKey.fee,
    poolKey.tickSpacing,
    getAddress(poolKey.hooks),
  );
}
