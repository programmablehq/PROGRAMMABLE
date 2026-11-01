export const V4_WORLD_FIXTURES=["pool-manager","v4-router"] as const;
export type V4WorldFixture=typeof V4_WORLD_FIXTURES[number];
export type V4CheckWorld={kind:"v4-native-token-v1";token:string;hook:string;hookPermissions:number;fee:number;tickSpacing:number;sqrtPriceX96:string};
export const V4_WORLD_STEP_SIGNATURES=[
  "initialize((address,address,uint24,int24,address),uint160)",
  "liquidity((address,address,uint24,int24,address),(int24,int24,int256,bytes32),bytes)",
  "swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)",
] as const;

/** World data chooses the declared pool, never a live address, URL, compiler,
 * source file, arbitrary fixture or external execution provider. */
export function parseV4CheckWorld(value:unknown,contracts:ReadonlySet<string>):V4CheckWorld {
  const fail=():never=>{throw TypeError("Declare one bounded native/token v4 fixture pool.");};
  if(!value||typeof value!=="object"||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();
  const v=value as V4CheckWorld;
  if(Object.keys(v).sort().join()!=="fee,hook,hookPermissions,kind,sqrtPriceX96,tickSpacing,token"||v.kind!=="v4-native-token-v1"
    ||typeof v.token!=="string"||typeof v.hook!=="string"||v.token===v.hook||!contracts.has(v.token)||!contracts.has(v.hook)
    ||!Number.isInteger(v.hookPermissions)||v.hookPermissions<1||v.hookPermissions>16383
    ||!Number.isInteger(v.fee)||(v.fee!==0x800000&&(v.fee<0||v.fee>=1_000_000))
    ||!Number.isInteger(v.tickSpacing)||v.tickSpacing<1||v.tickSpacing>32767
    ||typeof v.sqrtPriceX96!=="string"||!/^\d{1,49}$/.test(v.sqrtPriceX96)
    ||BigInt(v.sqrtPriceX96)<=4295128739n||BigInt(v.sqrtPriceX96)>=1461446703485210103287273052203988822378723970342n)return fail();
  return {kind:v.kind,token:v.token,hook:v.hook,hookPermissions:v.hookPermissions,fee:v.fee,tickSpacing:v.tickSpacing,sqrtPriceX96:v.sqrtPriceX96};
}
