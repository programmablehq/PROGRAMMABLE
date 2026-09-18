import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, keccak256, stringToHex, zeroAddress, type Hex, type PublicClient } from "viem";
import { foundationFactoryNativeAbi, foundationLaunchParameters, type FoundationLaunchParameters } from "./abi";
import { foundationFactoryAbiFor, foundationFactoryVersion, type FoundationDeploymentBinding } from "./protocol";
import { FOUNDATION_WETH, FOUNDATION_WETH_CODE_HASH } from "./native-funding";
import type { FoundationPoolKey } from "./route";

export const FOUNDATION_NATIVE_FUNDING_ID = keccak256(stringToHex("programmable.module-foundation.native-funding.v1"));
export const FOUNDATION_NO_FUNDING_POOL: FoundationPoolKey = { currency0: zeroAddress, currency1: zeroAddress, fee: 0, tickSpacing: 0, hooks: zeroAddress };
export interface FoundationEthFunding { maximumEth: bigint; quoteAmount: bigint; pool: FoundationPoolKey }

export async function assertFoundationAtomicEth(client: PublicClient, binding: FoundationDeploymentBinding, blockNumber: bigint) {
  try {
    if (foundationFactoryVersion(binding) !== "v2") throw new Error("version");
    const [id, weth, hash, code] = await Promise.all([
      client.readContract({ address: binding.factory.address, abi: foundationFactoryNativeAbi, functionName: "NATIVE_FUNDING_ID", blockNumber }),
      client.readContract({ address: binding.factory.address, abi: foundationFactoryNativeAbi, functionName: "wrappedEth", blockNumber }),
      client.readContract({ address: binding.factory.address, abi: foundationFactoryNativeAbi, functionName: "wrappedEthCodeHash", blockNumber }),
      client.getCode({ address: FOUNDATION_WETH, blockNumber }),
    ]);
    if (id !== FOUNDATION_NATIVE_FUNDING_ID || getAddress(weth) !== FOUNDATION_WETH || hash !== FOUNDATION_WETH_CODE_HASH
      || !code || keccak256(code) !== hash) throw new Error("binding");
  } catch { throw new Error("This launch version does not yet support ETH and the initial buy in one confirmation. The new launch contract must be activated first."); }
}

/** Exact calldata and value, shared by simulation, discovery and receipt verification. */
function decodeCall(binding: FoundationDeploymentBinding, transaction: { data: Hex; value: bigint }) {
  const abi = foundationFactoryVersion(binding) === "v2" ? foundationFactoryNativeAbi : foundationFactoryAbiFor(binding);
  const decoded = decodeFunctionData({ abi, data: transaction.data });
  let parameters: FoundationLaunchParameters;
  let native = false;
  let encoded: Hex;
  if (decoded.functionName === "launch") {
    if (transaction.value !== 0n) throw new Error("An ERC20 launch cannot accept ETH.");
    parameters = decoded.args[0];
    encoded = encodeFunctionData({ abi, functionName: "launch", args: [parameters] });
  } else if (decoded.functionName === "launchWithEth" && foundationFactoryVersion(binding) === "v2") {
    parameters = decoded.args[0]; native = true;
    const pool = decoded.args[1], amount = parameters.initialBuyQuoteAmount + parameters.additionalQuoteAmount;
    if (transaction.value < 0n || transaction.value > (1n << 127n) - 1n || (amount > 0n && transaction.value === 0n)) throw new Error("Invalid ETH funding budget.");
    if (getAddress(parameters.quote) === FOUNDATION_WETH) {
      if (transaction.value < amount || JSON.stringify(pool) !== JSON.stringify(FOUNDATION_NO_FUNDING_POOL)) throw new Error("Invalid ETH funding pool.");
    } else if (amount > 0n && (BigInt(pool.currency0) >= BigInt(pool.currency1)
      || ![pool.currency0, pool.currency1].some(a => getAddress(a) === FOUNDATION_WETH)
      || ![pool.currency0, pool.currency1].some(a => getAddress(a) === getAddress(parameters.quote)))) throw new Error("The funding pool uses another asset.");
    encoded = encodeFunctionData({ abi: foundationFactoryNativeAbi, functionName: "launchWithEth", args: [parameters, pool] });
  } else throw new Error("The transaction does not call foundation launch.");
  if (encoded.toLowerCase() !== transaction.data.toLowerCase()) throw new Error("The launch calldata is not canonical.");
  return { parameters, native };
}

export function decodeFoundationLaunchCall(binding: FoundationDeploymentBinding, transaction: { data: Hex; value: bigint }) {
  try { return decodeCall(binding, transaction); }
  catch { throw new Error("The launch calldata does not call the selected foundation factory with the canonical ABI encoding or ETH value."); }
}

export function assertFoundationLaunchCall(binding: FoundationDeploymentBinding, transaction: { data: Hex; value: bigint }, expected: FoundationLaunchParameters) {
  const call = decodeFoundationLaunchCall(binding, transaction);
  if (encodeAbiParameters(foundationLaunchParameters, [call.parameters]).toLowerCase() !== encodeAbiParameters(foundationLaunchParameters, [expected]).toLowerCase()) {
    throw new Error("The launch calldata differs from the coin settings.");
  }
  return call;
}
