import { getAddress, getContractAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { ETHEREUM_NATIVE30_RECIPES_V1 } from "./ethereum-native30-recipes-v1";

import { ETHEREUM_NATIVE30_RECIPES_V2 } from "./ethereum-native30-recipes-v2";
import { ETHEREUM_NATIVE100_RECIPES_V1 } from "./ethereum-native100-recipes-v1";
import { ETHEREUM_CUSTOM_NATIVE30_RECIPES_V1 as customRecipes, isBrownieNative30RecipeV1 } from "./ethereum-custom-native30-recipes-v1";
const recipes = {
  ...ETHEREUM_NATIVE100_RECIPES_V1,
  native30_fee_kernel_v2: { ...ETHEREUM_NATIVE30_RECIPES_V1.native30_fee_kernel_v2, recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" },
  ...ETHEREUM_NATIVE30_RECIPES_V2,
} as const;

/** Optional exact Native30 property. It grants no source-model eligibility,
 * admission or current-chain status and changes no historical V1 statement. */
export const ETHEREUM_NATIVE30_PROOF_SCHEMA_V1 = "programmable.ethereum-native30-runtime-proof.v1" as const;
export const ETHEREUM_NATIVE30_RATE_BPS_V1 = 30 as const;
export const ETHEREUM_NATIVE30_RECIPIENT_V1 = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" as Address;
export const ETHEREUM_NATIVE30_MANAGER_V1 = "0x000000000004444c5dc75cB358380D2e3dE08A90" as Address;
export type EthereumNative30MarketV1 = Readonly<{ chainId: "1"; poolManager: Address; currency0: Address;
  currency1: Address; fee: number; tickSpacing: number; hooks: Address }>;
export type EthereumNative30RecipeIdV1 = keyof typeof recipes | keyof typeof customRecipes;
type Recipe = Readonly<{ runtimeTemplateHex: Hex;
  immutableWords: readonly Readonly<{ name: string; byteOffsets: readonly number[] }>[] }>;
export type EthereumNative30RuntimeBindingV1 = Readonly<{ role: "hook" | "vault" | "module";
  address: Address; runtimeCodeHash: Hex; immutableWords: Readonly<Record<string, Hex>> | null }>;
export interface EthereumNative30RuntimeProofV1 {
  readonly schemaVersion: typeof ETHEREUM_NATIVE30_PROOF_SCHEMA_V1;
  readonly recipeId: EthereumNative30RecipeIdV1;
  readonly sourceArtifactHash: string;
  readonly market: EthereumNative30MarketV1;
  readonly recipient: Address;
  readonly rateBps: 30 | 100;
  readonly denominator: 10000;
  readonly scope: "exact_pool_key";
  readonly feeCurrency: "native";
  readonly assessmentBase: "gross_native_leg";
  readonly rounding: "ceil_per_trade" | "floor_per_trade";
  readonly accrual: "backed_pool_manager_native_claims";
  readonly claim: "permissionless_fixed_recipient";
  readonly feeVault: Address;
  readonly feeRecorder: Address;
  readonly runtimeBindings: readonly EthereumNative30RuntimeBindingV1[];
  readonly proofDigest: Hex;
}
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const WORD0 = `0x${"0".repeat(64)}` as Hex;
const issued = new WeakSet<object>();
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isAddress = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value);
const isWord = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
const fail = (): never => { throw new TypeError("Exact immutable Native30 source/runtime binding differs"); };
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function marketKey(market: EthereumNative30MarketV1): EthereumNative30MarketV1 {
  if (!market || market.chainId !== "1" || ![market.poolManager, market.currency0, market.currency1, market.hooks].every(isAddress)
    || !eq(market.poolManager, ETHEREUM_NATIVE30_MANAGER_V1) || !eq(market.currency0, ZERO)
    || eq(market.currency1, ZERO) || eq(market.hooks, ZERO) || !Number.isSafeInteger(market.fee)
    || !(market.fee >= 0 && (market.fee <= 1000000 || market.fee === 0x800000))
    || !Number.isSafeInteger(market.tickSpacing) || market.tickSpacing <= 0 || market.tickSpacing > 32767) return fail();
  return { ...market, poolManager: getAddress(market.poolManager), currency0: getAddress(market.currency0),
    currency1: getAddress(market.currency1), hooks: getAddress(market.hooks) };
}
function addressWord(words: Readonly<Record<string, Hex>>, name: string): Address {
  const value = words[name]; if (!isWord(value) || BigInt(value) >= 1n << 160n) return fail();
  return getAddress(`0x${value.slice(-40)}`);
}
function numberWord(words: Readonly<Record<string, Hex>>, name: string): bigint {
  const value = words[name]; if (!isWord(value)) return fail(); return BigInt(value);
}

export function readEthereumNative30RuntimeWordsV1(recipe: Recipe, runtime: Hex): Readonly<Record<string, Hex>> | null {
  if (!/^0x(?:[0-9a-f]{2})+$/iu.test(runtime) || runtime.length !== recipe.runtimeTemplateHex.length) return null;
  let normalized = runtime.toLowerCase(); const words: Record<string, Hex> = {}, used = new Set<number>();
  for (const immutable of recipe.immutableWords) {
    if (Object.hasOwn(words, immutable.name) || immutable.byteOffsets.length === 0) return null;
    let value: Hex | undefined;
    for (const offset of immutable.byteOffsets) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset * 2 + 66 > runtime.length) return null;
      const start = offset * 2 + 2, candidate = runtime.slice(start, start + 64).toLowerCase();
      if (recipe.runtimeTemplateHex.slice(start, start + 64) !== "0".repeat(64) || value && value !== `0x${candidate}`) return null;
      for (let index = offset; index < offset + 32; index++) { if (used.has(index)) return null; used.add(index); }
      value = `0x${candidate}`;
      normalized = `${normalized.slice(0, start)}${"0".repeat(64)}${normalized.slice(start + 64)}`;
    }
    words[immutable.name] = value!;
  }
  return normalized === recipe.runtimeTemplateHex.toLowerCase() ? frozen(words) : null;
}
export function materializeEthereumNative30RuntimeWordsV1(recipe: Recipe, words: Readonly<Record<string, Hex>>): Hex {
  if (!words || Object.keys(words).sort().join() !== recipe.immutableWords.map(word => word.name).sort().join()) return fail();
  let runtime = recipe.runtimeTemplateHex;
  for (const immutable of recipe.immutableWords) {
    const word = words[immutable.name]; if (!isWord(word)) return fail();
    for (const offset of immutable.byteOffsets) {
      const start = offset * 2 + 2;
      runtime = `${runtime.slice(0, start)}${word.slice(2).toLowerCase()}${runtime.slice(start + 64)}` as Hex;
    }
  }
  if (!readEthereumNative30RuntimeWordsV1(recipe, runtime)) return fail();
  return runtime;
}

function hookCandidate(market: EthereumNative30MarketV1, runtime: Hex) {
  const key = marketKey(market);
  if ((BigInt(key.hooks) & 0x3fffn) !== 0x20ccn) return null;
  const match = (Object.keys(recipes) as (keyof typeof recipes)[]).map(recipeId => ({
    recipeId, recipe: recipes[recipeId], words: readEthereumNative30RuntimeWordsV1(recipes[recipeId].hook, runtime),
  })).find(candidate => candidate.words !== null);
  if (!match?.words) return null;
  const { recipeId, recipe, words } = match;
  const rateBps = recipeId === "native100_fee_kernel_v1" ? 100 as const : 30 as const;
  const vault = addressWord(words, "feeVault"), feeModule = addressWord(words, "module");
  if (!eq(addressWord(words, "poolManager"), key.poolManager) || !eq(addressWord(words, "token"), key.currency1)
    || numberWord(words, "lpFee") !== BigInt(key.fee) || numberWord(words, "tickSpacing") !== BigInt(key.tickSpacing)
    || !eq(vault, getContractAddress({ from: key.hooks, nonce: 1n })) || eq(addressWord(words, "initializer"), ZERO)
    || numberWord(words, "initialSqrtPriceX96") === 0n || numberWord(words, "initialSqrtPriceX96") >= 1n << 160n
    || numberWord(words, "creatorBuyFeeBps") + BigInt(rateBps) >= 10000n || numberWord(words, "creatorSellFeeBps") + BigInt(rateBps) >= 10000n
    || numberWord(words, "maxModuleLpFeePips") > 1000000n || eq(feeModule, key.poolManager)
    || eq(feeModule, ZERO) !== eq(words.moduleCodeHash!, WORD0)) return null;
  return { key, words, vault, feeModule, recipeId, recipe, rateBps };
}
export function ethereumNative30RequiredAddressesV1(market: EthereumNative30MarketV1, hookRuntime: Hex): readonly Address[] | null {
  try {
    const custom = customCandidate(market, hookRuntime);
    if (custom) return frozen([...new Set([custom.key.hooks, custom.vault])]);
    const candidate = hookCandidate(market, hookRuntime); if (!candidate) return null;
    return frozen([candidate.key.hooks, candidate.vault, ...(eq(candidate.feeModule, ZERO) ? [] : [candidate.feeModule])]);
  } catch { return null; }
}

/** These templates establish only fee custody. Admission, project fees and
 * the actual swap still have to pass their independent checks. */
function customCandidate(market: EthereumNative30MarketV1, runtime: Hex) {
  const key = marketKey(market);
  for (const recipeId of Object.keys(customRecipes) as (keyof typeof customRecipes)[]) {
    const recipe = customRecipes[recipeId];
    if ((BigInt(key.hooks) & 0x3fffn) !== BigInt(recipe.hookFlags)) continue;
    const words = readEthereumNative30RuntimeWordsV1(recipe.hook, runtime);
    if (!words || !eq(addressWord(words, "poolManager"), key.poolManager)
      || !eq(addressWord(words, "TOKEN"), key.currency1)) continue;
    if (!isBrownieNative30RecipeV1(recipeId)) {
      if (numberWord(words, "LP_FEE") !== BigInt(key.fee) || numberWord(words, "SPACING") !== BigInt(key.tickSpacing)) continue;
    } else if (!eq(addressWord(words, "QUOTE"), ZERO) || numberWord(words, "QUOTE_ID") !== 0n
      || numberWord(words, "QUOTE_IS_0") !== 1n || numberWord(words, "PLATFORM_BPS") !== 30n
      || !eq(addressWord(words, "PLATFORM_RECIPIENT"), recipe.recipient)) continue;
    return { key, words, recipe, recipeId, vault: !isBrownieNative30RecipeV1(recipeId)
      ? getContractAddress({ from: key.hooks, nonce: 1n }) : key.hooks };
  }
  return null;
}

function buildCustomProof(market: EthereumNative30MarketV1, codes: Readonly<Record<string, Hex>>): EthereumNative30RuntimeProofV1 | null {
  const code = (address: Address) => {
    const matches = Object.entries(codes).filter(([key]) => eq(key, address)).map(([, value]) => value);
    if (matches.some(value => value !== matches[0])) return fail();
    return matches[0];
  };
  const hookCode = code(market.hooks);
  if (!hookCode) return null;
  const candidate = customCandidate(market, hookCode);
  if (!candidate) return null;
  const { key, words, recipe, recipeId, vault } = candidate;
  const bindings: EthereumNative30RuntimeBindingV1[] = [
    { role: "hook", address: key.hooks, runtimeCodeHash: keccak256(hookCode), immutableWords: words },
  ];
  if (!isBrownieNative30RecipeV1(recipeId)) {
    const vaultCode = code(vault);
    if (!vaultCode) return null;
    const vaultWords = readEthereumNative30RuntimeWordsV1(customRecipes[recipeId].vault, vaultCode);
    if (!vaultWords || !eq(addressWord(vaultWords, "poolManager"), key.poolManager)
      || !eq(addressWord(vaultWords, "kernel"), key.hooks)
      || !eq(addressWord(vaultWords, "creatorRecipient"), addressWord(words, "OWNER"))) return null;
    bindings.push({ role: "vault", address: vault, runtimeCodeHash: keccak256(vaultCode), immutableWords: vaultWords });
  }
  const body = { schemaVersion: ETHEREUM_NATIVE30_PROOF_SCHEMA_V1, recipeId, sourceArtifactHash: recipe.sourceArtifactHash,
    market: key, recipient: getAddress(recipe.recipient), rateBps: 30 as const, denominator: 10000 as const,
    scope: "exact_pool_key" as const, feeCurrency: "native" as const, assessmentBase: "gross_native_leg" as const,
    rounding: isBrownieNative30RecipeV1(recipeId) ? "floor_per_trade" as const : "ceil_per_trade" as const,
    accrual: "backed_pool_manager_native_claims" as const, claim: "permissionless_fixed_recipient" as const,
    feeVault: vault, feeRecorder: key.hooks, runtimeBindings: bindings };
  const proof = frozen({ ...body, proofDigest: keccak256(stringToHex(`${ETHEREUM_NATIVE30_PROOF_SCHEMA_V1}\n${canonical(body)}`)) });
  issued.add(proof);
  return proof;
}

function buildProof(market: EthereumNative30MarketV1, codes: Readonly<Record<string, Hex>>, rebuildSourceOnly: boolean) {
  const code = (address: Address) => {
    const matches = Object.entries(codes).filter(([key]) => eq(key, address)).map(([, value]) => value);
    if (matches.some(value => value !== matches[0])) return fail(); return matches[0];
  };
  const hookCode = code(market.hooks); if (!hookCode) return null;
  const candidate = hookCandidate(market, hookCode); if (!candidate) return null;
  const { key, words, vault, feeModule, recipeId, recipe, rateBps } = candidate, vaultCode = code(vault); if (!vaultCode) return null;
  const vaultWords = readEthereumNative30RuntimeWordsV1(recipe.vault, vaultCode);
  if (!vaultWords || !eq(addressWord(vaultWords, "poolManager"), key.poolManager)
    || !eq(addressWord(vaultWords, "kernel"), key.hooks) || eq(addressWord(vaultWords, "creatorRecipient"), ZERO)) return null;
  const bindings: EthereumNative30RuntimeBindingV1[] = [
    { role: "hook", address: key.hooks, runtimeCodeHash: keccak256(hookCode), immutableWords: words },
    { role: "vault", address: vault, runtimeCodeHash: keccak256(vaultCode), immutableWords: vaultWords },
  ];
  if (!eq(feeModule, ZERO)) {
    const moduleCode = code(feeModule);
    if ((!moduleCode || moduleCode === "0x") && !rebuildSourceOnly) return null;
    if (moduleCode && keccak256(moduleCode) !== words.moduleCodeHash) return null;
    bindings.push({ role: "module", address: feeModule, runtimeCodeHash: words.moduleCodeHash!, immutableWords: null });
  }
  if (new Set(bindings.map(binding => binding.address.toLowerCase())).size !== bindings.length) return null;
  bindings.sort((a, b) => a.role.localeCompare(b.role));
  const body = { schemaVersion: ETHEREUM_NATIVE30_PROOF_SCHEMA_V1, recipeId,
    sourceArtifactHash: recipe.sourceArtifactHash, market: key,
    recipient: getAddress(recipe.recipient), rateBps, denominator: 10000 as const,
    scope: "exact_pool_key" as const, feeCurrency: "native" as const, assessmentBase: "gross_native_leg" as const,
    rounding: "ceil_per_trade" as const, accrual: "backed_pool_manager_native_claims" as const,
    claim: "permissionless_fixed_recipient" as const, feeVault: vault, feeRecorder: key.hooks, runtimeBindings: bindings };
  const proof = frozen({ ...body, proofDigest: keccak256(stringToHex(`${ETHEREUM_NATIVE30_PROOF_SCHEMA_V1}\n${canonical(body)}`)) });
  issued.add(proof); return proof;
}

/** Every code binding is required, including a nonzero read-only module. Caller
 * still proves where/when those exact bytes were observed independently. */
export function proveEthereumNative30RuntimeV1(market: EthereumNative30MarketV1,
  codes: Readonly<Record<string, Hex>>): EthereumNative30RuntimeProofV1 | null {
  try { return buildCustomProof(market, codes) ?? buildProof(market, codes, false); } catch { return null; }
}
export function assertIssuedEthereumNative30RuntimeProofV1(proof: EthereumNative30RuntimeProofV1, market: EthereumNative30MarketV1): void {
  if (!issued.has(proof) || canonical(proof.market) !== canonical(marketKey(market))) return fail();
}

/** Rebuilds a serialized source statement, never an observation. A module hash
 * is committed by the exact kernel immutable; the consumer MUST read its actual
 * runtime (along with every binding) before treating the statement as current. */
export function rebuildEthereumNative30RuntimeProofV1(value: unknown, market: EthereumNative30MarketV1): EthereumNative30RuntimeProofV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const supplied = value as EthereumNative30RuntimeProofV1;
  if (Object.hasOwn(customRecipes, supplied.recipeId)) {
    const recipeId = supplied.recipeId as keyof typeof customRecipes;
    if (!Array.isArray(supplied.runtimeBindings) || supplied.runtimeBindings.length !== (isBrownieNative30RecipeV1(recipeId) ? 1 : 2)) return fail();
    const codes: Record<string, Hex> = {};
    for (const binding of supplied.runtimeBindings) {
      if (!binding || !isAddress(binding.address) || Object.hasOwn(codes, binding.address.toLowerCase())
        || (binding.role !== "hook" && binding.role !== "vault")) return fail();
      codes[binding.address.toLowerCase()] = materializeEthereumNative30RuntimeWordsV1(binding.role === "hook"
        ? customRecipes[recipeId].hook : isBrownieNative30RecipeV1(recipeId) ? fail() : customRecipes[recipeId].vault, binding.immutableWords!);
    }
    const proof = buildCustomProof(market, codes);
    if (!proof || canonical(proof) !== canonical(supplied)) return fail();
    return proof;
  }
  if (!Object.hasOwn(recipes, supplied.recipeId) || !Array.isArray(supplied.runtimeBindings)
    || supplied.runtimeBindings.length < 2 || supplied.runtimeBindings.length > 3) return fail();
  const codes: Record<string, Hex> = {}, roles = new Set<string>(), addresses = new Set<string>();
  for (const binding of supplied.runtimeBindings) {
    if (!binding || !["hook", "vault", "module"].includes(binding.role) || !isAddress(binding.address)
      || !isWord(binding.runtimeCodeHash) || roles.has(binding.role) || addresses.has(binding.address.toLowerCase())) return fail();
    roles.add(binding.role); addresses.add(binding.address.toLowerCase());
    if (binding.role === "module") { if (binding.immutableWords !== null) return fail(); }
    else codes[binding.address.toLowerCase()] = materializeEthereumNative30RuntimeWordsV1(
      binding.role === "hook" ? recipes[supplied.recipeId as keyof typeof recipes].hook : recipes[supplied.recipeId as keyof typeof recipes].vault,
      binding.immutableWords!,
    );
  }
  const proof = buildProof(market, codes, true);
  if (!proof || canonical(proof) !== canonical(supplied)) return fail();
  return proof;
}
