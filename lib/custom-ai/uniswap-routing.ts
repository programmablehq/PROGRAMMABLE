import {checkedLaunchProductionContext,type LaunchProductionContext} from "./launch-production";
// @ts-expect-error The pinned launch package is ESM without TypeScript declarations.
import {PROTECTED_LAUNCH_CHAIN_PINS_V1} from "@/packages/launch/src/launch-protection-pins-v1.mjs";
import {UNISWAP_TRADING_API_ROUTER_VERSION} from "@/lib/uniswap/trading-api-router";

/** Describe the exact production route already selected by discovery. This
 * neither substitutes the hosted API's router nor certifies execution. */
export function uniswapRoutingContext(input?:LaunchProductionContext) {
  if(!input)return {status:"not-observed" as const};
  const context=checkedLaunchProductionContext(input,input.chainId),binding=context.protectionBindings;
  if(!binding)return {status:"not-observed" as const,productionId:context.id};
  const pin=PROTECTED_LAUNCH_CHAIN_PINS_V1[context.chainId];
  if(binding.swapRouter.address.toLowerCase()!==pin.router.toLowerCase()
    ||binding.swapRouter.runtimeCodeHash.toLowerCase()!==pin.routerCodeHash.toLowerCase())return {status:"unrecognized-binding" as const,productionId:context.id};
  return {status:"configured-not-execution-proof" as const,productionId:context.id,chainId:context.chainId,
    poolManager:context.poolManager,swapRouter:binding.swapRouter,
    abiFamily:context.chainId===1?"2.0":"2.1.x",
    entrypoint:"execute(bytes,bytes[],uint256)",
    exactInputNativePair:{commands:["V4_SWAP","SWEEP"],actions:["SWAP_EXACT_IN_SINGLE","SETTLE_ALL","TAKE_ALL"],
      minHopPriceX36:context.chainId===1?"absent-in-2.0-ABI":"present-in-2.1-ABI",hookData:"0x",
      note:"Actual payer/recipient settlement, slippage, deadline, balances and runtime hashes require the current route simulation. Forwarded recipients use TAKE."},
    customHookData:"requires-explicit-encoding-and-route-verification",
    hostedAPI:{version:UNISWAP_TRADING_API_ROUTER_VERSION,automaticHookRouting:false,
      note:"Hosted API support and router addresses differ from immutable launch bindings. Never replace a required router with the API default."},
    localEvidence:"The isolated v4-router fixture is not the production Universal Router bytecode."};
}
