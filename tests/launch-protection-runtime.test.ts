import { proveImmutablePoolFeeRuntimeV2, rebuildImmutablePoolFeeRuntimeProofV2 } from "@/lib/custom-launch/immutable-pool-fee-runtime-custom-launch-plan-v2";
import { describe, expect, it } from "vitest";
import { getContractAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { LAUNCH_PROTECTION_RECIPES_V1 } from "@/lib/launch-protection/recipes-v1";
import { materializeEthereumNative30RuntimeWordsV1 as materialize, proveEthereumNative30RuntimeV1,
  rebuildEthereumNative30RuntimeProofV1, type EthereumNative30MarketV1 } from "@/lib/custom-launch/ethereum-native30-runtime-v1";

const recipe = LAUNCH_PROTECTION_RECIPES_V1.protected_native30_v1;
const hook = "0x11111111111111111111111111111111111120cc" as Address;
const token = "0x2222222222222222222222222222222222222222" as Address;
const developer = "0x3333333333333333333333333333333333333333" as Address;
const initializer = "0x4444444444444444444444444444444444444444" as Address;
const manager = "0x000000000004444c5dc75cB358380D2e3dE08A90" as Address;
const feeVault = getContractAddress({ from: hook, nonce: 1n });
const protectionModule = getContractAddress({ from: hook, nonce: 2n });
const taxVault = getContractAddress({ from: hook, nonce: 3n });
const word = (value: bigint | string) => toHex(BigInt(value), { size: 32 });
const market: EthereumNative30MarketV1 = { chainId: "1", poolManager: manager,
  currency0: "0x0000000000000000000000000000000000000000", currency1: token, fee: 0, tickSpacing: 60, hooks: hook };
function fixture(chainId: 1 | 4663 = 1) {
  const chainManager = chainId === 1 ? manager : "0x8366a39CC670B4001A1121B8F6A443A643e40951";
  const moduleCode = materialize(recipe.module, { developer: word(developer), kernel: word(hook), normalBuyFeePpm: word(10000n),
    router: word("0xd92A36B0000531EF3063dEd4De20A0783308446C"), routerCodeHash: `0x${"1".repeat(64)}`, token: word(token) });
  const words: Record<string, Hex> = { CANONICAL_POOL_MANAGER: word(chainManager), CHAIN_ID: word(BigInt(chainId)),
    creatorBuyFeeBps: word(70n), creatorSellFeeBps: word(70n), feeVault: word(feeVault), initializer: word(initializer),
    initialSqrtPriceX96: word(10n ** 30n), lpFee: word(0n), maxModuleLpFeePips: word(0n), module: word(protectionModule),
    moduleCodeHash: keccak256(moduleCode), openingTaxVault: word(taxVault), poolManager: word(chainManager), tickSpacing: word(60n), token: word(token) };
  const codes: Record<string, Hex> = { [hook]: materialize(recipe.hook, words), [protectionModule]: moduleCode,
    [feeVault]: materialize(recipe.vault, { creatorRecipient: word(developer), kernel: word(hook), poolManager: word(chainManager) }) };
  return { words, codes };
}

describe("protected Native30 exact fee recognition", () => {
  it("recognizes the fixed 0.3% fee without combining opening-tax custody", () => {
    const { codes } = fixture(), proof = proveEthereumNative30RuntimeV1(market, codes)!;
    expect(proof).toMatchObject({ recipeId: "protected_native30_v1", rateBps: 30, feeVault,
      recipient: recipe.recipient, rounding: "ceil_per_trade" });
    expect(rebuildEthereumNative30RuntimeProofV1(JSON.parse(JSON.stringify(proof)), market)).toEqual(proof);
  });
  it("requires the actual protectionModule and fee-vault runtimes and exact market", () => {
    const { codes, words } = fixture();
    expect(proveEthereumNative30RuntimeV1(market, { ...codes, [protectionModule]: "0x6000" })).toBeNull();
    expect(proveEthereumNative30RuntimeV1(market, { ...codes, [feeVault]: "0x6000" })).toBeNull();
    expect(proveEthereumNative30RuntimeV1(market, { ...codes, [hook]: materialize(recipe.hook,
      { ...words, feeVault: word(taxVault) }) })).toBeNull();
    expect(proveEthereumNative30RuntimeV1({ ...market, currency1: developer }, codes)).toBeNull();
  });
});

describe("Robinhood protected fee recognition", () => {
  it("recognizes and rebuilds the exact protected 30 bps proof", () => {
    const { codes } = fixture(4663);
    const rhMarket = { ...market, chainId: "4663" as const, poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address };
    const proof = proveImmutablePoolFeeRuntimeV2(rhMarket, codes)!;
    expect(proof).toMatchObject({ recipeId: "protected_native30_v1", rateBps: 30, feeVault });
    expect(rebuildImmutablePoolFeeRuntimeProofV2(JSON.parse(JSON.stringify(proof)), rhMarket)).toEqual(proof);
    expect(proveImmutablePoolFeeRuntimeV2(rhMarket, { ...codes, [protectionModule]: "0x6000" })).toBeNull();
  });
});
