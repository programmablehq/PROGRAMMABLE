import { concatHex, encodeAbiParameters, encodeFunctionData, formatUnits, getAddress, getCreate2Address, hashTypedData, keccak256, parseAbi,
  parseAbiParameters, stringToHex, verifyTypedData, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { foundationSqrtPriceAtTick } from "@/lib/module-foundation/price";
import { parseCoinSettings } from "./preview";
import launchCode from "./launch-code.json";
import programManifest from "./program-manifest.json";
import { requireMinimumInitialBuy } from "./initial-buy";

export const customAIFactoryAbi = parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleBinding { address instance; bytes32 runtimeHash; bytes32 configurationHash; }",
  "struct Rewards { address creatorRecipient; uint16 creatorShareBps; ModuleBinding module; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; bytes32 launchSalt; bytes32 hookSalt; ModuleBinding feeModule; Rewards rewards; uint128 initialBuyQuote; uint128 minimumBuyTokens; uint16 maximumFeeBps; uint64 deadline; }",
  "struct Price { uint256 quoteUsdE18; uint256 ethUsdE18; uint64 observedAt; uint64 validUntil; }",
  "struct LaunchResult { bytes32 planHash; bytes32 poolId; address token; address hook; address ledger; address rewardVault; address liquidityVault; uint128 liquidity; uint128 tokenPrincipal; uint128 tokenRounding; uint256 initialBuyTokens; }",
  "function hashPlan(address creator, LaunchParams p) view returns (bytes32)",
  "function priceDigest(bytes32 planHash, Price price) view returns (bytes32)",
  "function predictTokenAddress(address creator, LaunchParams p) view returns (address)",
  "function launchOf(address creator, bytes32 salt) view returns (LaunchResult)",
  "function launch(LaunchParams p, Price price, bytes signature) returns (LaunchResult)",
]);
const parameterTypes = parseAbiParameters("bytes32,uint256,address,address,((string name,string symbol,string description,string imageURI,string website,bytes socialData) metadata,address quote,uint8 quoteDecimals,int24 initialTick,bytes32 launchSalt,bytes32 hookSalt,(address instance,bytes32 runtimeHash,bytes32 configurationHash) feeModule,(address creatorRecipient,uint16 creatorShareBps,(address instance,bytes32 runtimeHash,bytes32 configurationHash) module) rewards,uint128 initialBuyQuote,uint128 minimumBuyTokens,uint16 maximumFeeBps,uint64 deadline)");
export type ModuleBinding = { instance: Address; runtimeHash: Hex; configurationHash: Hex };
export type LaunchParameters = {
  metadata: { name: string; symbol: string; description: string; imageURI: string; website: string; socialData: Hex };
  quote: Address; quoteDecimals: number; initialTick: number; launchSalt: Hex; hookSalt: Hex;
  feeModule: ModuleBinding; rewards: { creatorRecipient: Address; creatorShareBps: number; module: ModuleBinding };
  initialBuyQuote: bigint; minimumBuyTokens: bigint; maximumFeeBps: number; deadline: bigint;
};
export type LaunchPrice = { quoteUsdE18: bigint; ethUsdE18: bigint; observedAt: bigint; validUntil: bigint };
export type LaunchOrder = {
  version: 1; chainId: 1 | 4663; factory: Address; account: Address; planHash: Hex;
  sourceHash: string; artifactHash: string; coreBundleHash: string;
  rewardProgram?: { bundleHash: string; binding: ModuleBinding; creatorShareBps: number };
  predictedToken: Address;
  parameters: LaunchParameters; price: LaunchPrice; signature: Hex; priceSigner: Address;
  transaction: { from: Address; to: Address; data: Hex; value: 0n; chainId: 1 | 4663 };
};
const supply = 10n ** 27n, target = 15000n * 10n ** 18n, maxTarget = target * 10061n / 10000n;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;

export const CUSTOM_AI_BUNDLE_HASH = launchCode.bundleHash;
export function predictCustomAIToken(factory: Address, creator: Address, p: LaunchParameters): Address {
  const argumentsHex = encodeAbiParameters(parseAbiParameters("(string name,string symbol,string description,string imageURI,string website,bytes socialData),address"), [p.metadata, p.quote]);
  return getCreate2Address({ from: factory,
    salt: keccak256(encodeAbiParameters(parseAbiParameters("address,bytes32"), [creator, p.launchSalt])),
    bytecodeHash: keccak256(concatHex([launchCode.tokenCreationCode as Hex, argumentsHex])) });
}

/** Exact port of the immutable core's conservative price bounds, including Q128 rounding. */
export function customAIPriceBounds(token0: boolean, tick: number, decimals: number, usdE18: bigint) {
  if (!Number.isInteger(tick) || Math.abs(tick) >= 887220 || tick % 60 !== 0 || !Number.isInteger(decimals)
    || decimals < 0 || decimals > 36 || usdE18 <= 0n || usdE18 > 10n ** 36n) throw Error("Invalid launch price inputs.");
  const sqrt = foundationSqrtPriceAtTick(tick), square = sqrt * sqrt;
  let amount: bigint, upper: bigint;
  if (sqrt <= (1n << 128n) - 1n) {
    const [n, d] = token0 ? [square * supply, 1n << 192n] : [(1n << 192n) * supply, square];
    amount = n / d; upper = ceil(n, d);
  } else {
    const ratio = square / (1n << 64n);
    amount = token0 ? ratio * supply / (1n << 128n) : (1n << 128n) * supply / (ratio + 1n);
    upper = token0 ? ceil((ratio + 1n) * supply, 1n << 128n) : ceil((1n << 128n) * supply, ratio);
  }
  return { lower: amount * usdE18 / 10n ** BigInt(decimals), upper: ceil(upper * usdE18, 10n ** BigInt(decimals)) };
}

export function planCustomAIPrice(token: Address, quote: Address, decimals: number, usdE18: bigint) {
  if (getAddress(token) === getAddress(quote)) throw Error("Coin and quote must be different tokens.");
  const token0 = BigInt(token) < BigInt(quote);
  let low = -14786, high = 14786;
  const at = (index: number) => customAIPriceBounds(token0, index * 60 * (token0 ? 1 : -1), decimals, usdE18);
  if (at(high).lower < target || at(low).lower >= target) throw Error("This quote price cannot form the required starting FDV.");
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (at(mid).lower < target) low = mid + 1; else high = mid;
  }
  const bounds = at(low);
  if (bounds.lower < target || bounds.upper > maxTarget || at(low - 1).lower >= target) throw Error("This quote price cannot form the required starting FDV.");
  return { initialTick: low * 60 * (token0 ? 1 : -1), token0, ...bounds };
}

export function customAIPlanHash(chainId: 1 | 4663, factory: Address, account: Address, parameters: LaunchParameters) {
  if (chainId !== 1 && chainId !== 4663) throw Error("Unsupported Custom AI network.");
  return keccak256(encodeAbiParameters(parameterTypes,
    [keccak256(stringToHex("programmable.custom-ai.core.v1")), BigInt(chainId), factory, account, parameters]));
}

export function customAIPriceTypedData(chainId: 1 | 4663, factory: Address, planHash: Hex, price: LaunchPrice) {
  return { domain: { name: "Programmable Custom AI Launch", version: "1", chainId, verifyingContract: factory },
    types: { LaunchPrice: [{ name: "planHash", type: "bytes32" }, { name: "quoteUsdE18", type: "uint256" },
      { name: "ethUsdE18", type: "uint256" },
      { name: "observedAt", type: "uint64" }, { name: "validUntil", type: "uint64" }] },
    primaryType: "LaunchPrice", message: { planHash, ...price } } as const;
}

/** Builds calldata only after readback has supplied the real factory, module and signer bindings. No wallet access. */
export async function bindCustomAILaunch(input: Omit<LaunchOrder, "version" | "planHash" | "transaction">, now: bigint): Promise<LaunchOrder> {
  const { chainId, parameters: p, price } = input;
  const factory = getAddress(input.factory), account = getAddress(input.account);
  if ([factory, account, getAddress(input.priceSigner), getAddress(p.feeModule.instance), getAddress(p.rewards.creatorRecipient)].includes(zeroAddress)) throw Error("Missing launch deployment binding.");
  for (const hash of [input.sourceHash, input.artifactHash, input.coreBundleHash]) if (!/^[0-9a-f]{64}$/.test(hash)) throw Error("Missing source or artifact binding.");
  if (input.coreBundleHash !== CUSTOM_AI_BUNDLE_HASH) throw Error("The core build changed. Prepare the launch again.");
  if (!Number.isInteger(p.quoteDecimals) || p.quoteDecimals < 0 || p.quoteDecimals > 36 || !Number.isInteger(p.maximumFeeBps)
    || p.maximumFeeBps < 50 || p.maximumFeeBps > 1500 || p.initialBuyQuote <= 0n || p.initialBuyQuote > (1n << 127n) - 1n
    || p.minimumBuyTokens <= 0n || p.minimumBuyTokens > (1n << 128n) - 1n) throw Error("Invalid fee or initial-buy limits.");
  const settings = parseCoinSettings({ ...p.metadata, chainId, quote: p.quote, initialBuy: formatUnits(p.initialBuyQuote, p.quoteDecimals) });
  if (settings.name !== p.metadata.name || settings.symbol !== p.metadata.symbol || settings.imageURI !== p.metadata.imageURI) throw Error("Normalize the metadata before preparing the order.");
  if (new TextEncoder().encode(p.metadata.description).length > 280 || new TextEncoder().encode(p.metadata.website).length > 2048
    || !/^0x(?:[0-9a-f]{2}){0,1200}$/i.test(p.metadata.socialData)) throw Error("Coin metadata exceeds the contract limits.");
  if (!Number.isInteger(p.initialTick) || p.initialTick % 60 !== 0 || Math.abs(p.initialTick) >= 887220) throw Error("Invalid starting pool tick.");
  if (getAddress(input.predictedToken) !== predictCustomAIToken(factory, account, p)) throw Error("The predicted coin does not match the exact launch.");
  if (planCustomAIPrice(input.predictedToken, p.quote, p.quoteDecimals, price.quoteUsdE18).initialTick !== p.initialTick) throw Error("The starting price does not match the predicted coin.");
  if (price.observedAt > now || price.observedAt < 0n || now - price.observedAt > 120n || price.validUntil <= now
    || price.validUntil > price.observedAt + 120n || p.deadline <= now || p.deadline > price.validUntil
    || price.quoteUsdE18 <= 0n || price.quoteUsdE18 > 10n ** 36n
    || price.ethUsdE18 <= 0n || price.ethUsdE18 > 10n ** 36n) throw Error("Refresh the launch price before signing.");
  requireMinimumInitialBuy(p.initialBuyQuote, p.quoteDecimals, price.quoteUsdE18, price.ethUsdE18);
  for (const b of [p.feeModule, p.rewards.module]) {
    if (!/^0x[0-9a-f]{64}$/i.test(b.runtimeHash) || !/^0x[0-9a-f]{64}$/i.test(b.configurationHash)) throw Error("Invalid module binding.");
  }
  if (p.feeModule.runtimeHash === zeroHash || p.feeModule.configurationHash === zeroHash) throw Error("Invalid fee module binding.");
  const program = input.rewardProgram;
  if (program) {
    if (program.bundleHash !== programManifest.bundleHash || !Number.isInteger(program.creatorShareBps)
      || program.creatorShareBps < 0 || program.creatorShareBps >= 10000
      || program.creatorShareBps !== p.rewards.creatorShareBps
      || program.binding.instance === zeroAddress || program.binding.runtimeHash === zeroHash || program.binding.configurationHash === zeroHash
      || (["instance", "runtimeHash", "configurationHash"] as const).some(key => program.binding[key].toLowerCase() !== p.rewards.module[key].toLowerCase())) {
      throw Error("The reward program differs from the checked launch binding.");
    }
  } else if (p.rewards.creatorShareBps !== 10000 || p.rewards.module.instance !== zeroAddress
    || p.rewards.module.runtimeHash !== zeroHash || p.rewards.module.configurationHash !== zeroHash) {
    throw Error("A separately checked reward program is required.");
  }
  const planHash = customAIPlanHash(chainId, factory, account, p);
  if (!await verifyTypedData({ ...customAIPriceTypedData(chainId, factory, planHash, price), address: input.priceSigner, signature: input.signature })) throw Error("The launch price signature does not match this order.");
  // Copy through the ABI boundary so later UI object edits cannot change the stored order.
  const parameters = structuredClone(p), savedPrice = structuredClone(price);
  return { ...input, version: 1, factory, account, parameters, price: savedPrice, planHash,
    transaction: { from: account, to: factory, value: 0n, chainId,
      data: encodeFunctionData({ abi: customAIFactoryAbi, functionName: "launch", args: [parameters, savedPrice, input.signature] }) } };
}

export function customAIOrderMatchesTransaction(order: LaunchOrder, tx: { from: Address; to: Address | null; input: Hex; value: bigint; chainId: number }) {
  return tx.chainId === order.chainId && tx.from.toLowerCase() === order.account.toLowerCase()
    && tx.to?.toLowerCase() === order.factory.toLowerCase() && tx.value === 0n
    && tx.input.toLowerCase() === order.transaction.data.toLowerCase();
}

/** An uncertain wallet dispatch never becomes permission to send another transaction. */
export function reconcileCustomAILaunch(order: LaunchOrder, observation: {
  chainId: number; factory: Address; account: Address; launchSalt: Hex;
  finalizedPlanHash: Hex; finalizedToken: Address;
  dispatch: "not-sent" | "uncertain" | "submitted";
  transaction?: Parameters<typeof customAIOrderMatchesTransaction>[1]; receipt?: "pending" | "success" | "reverted";
}, now = BigInt(Math.floor(Date.now() / 1000))) {
  try {
    if (order.coreBundleHash !== CUSTOM_AI_BUNDLE_HASH
      || predictCustomAIToken(order.factory, order.account, order.parameters).toLowerCase() !== order.predictedToken.toLowerCase()
      || customAIPlanHash(order.chainId, order.factory, order.account, order.parameters) !== order.planHash
      || encodeFunctionData({ abi: customAIFactoryAbi, functionName: "launch", args: [order.parameters, order.price, order.signature] }).toLowerCase() !== order.transaction.data.toLowerCase()
      || !customAIOrderMatchesTransaction(order, { ...order.transaction, input: order.transaction.data })) return { state: "conflict", canSend: false } as const;
  } catch { return { state: "conflict", canSend: false } as const; }
  if (observation.chainId !== order.chainId || observation.factory.toLowerCase() !== order.factory.toLowerCase()
    || observation.account.toLowerCase() !== order.account.toLowerCase() || observation.launchSalt !== order.parameters.launchSalt) return { state: "conflict", canSend: false } as const;
  if (observation.finalizedToken !== zeroAddress) return observation.finalizedPlanHash === order.planHash
    && observation.finalizedToken.toLowerCase() === order.predictedToken.toLowerCase()
    ? { state: "confirmed", canSend: false } as const : { state: "conflict", canSend: false } as const;
  if (observation.finalizedPlanHash !== zeroHash) return { state: "conflict", canSend: false } as const;
  if (observation.transaction && !customAIOrderMatchesTransaction(order, observation.transaction)) return { state: "conflict", canSend: false } as const;
  if (observation.receipt === "reverted") return { state: "failed", canSend: false } as const;
  if (observation.dispatch !== "not-sent" || observation.transaction || observation.receipt) return { state: "pending", canSend: false } as const;
  if (order.price.validUntil <= now || order.parameters.deadline <= now || order.price.observedAt > now
    || now - order.price.observedAt > 120n) return { state: "expired", canSend: false } as const;
  return { state: "not-sent", canSend: true } as const;
}

export const customAIPriceDigest = (chainId: 1 | 4663, factory: Address, planHash: Hex, price: LaunchPrice) => hashTypedData(customAIPriceTypedData(chainId, factory, planHash, price));
