import { getAddress, getContractAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { IMMUTABLE_POOL_FEE_RECIPES_V2 } from "./immutable-pool-fee-recipes-custom-launch-plan-v2";
import { LAUNCH_PROTECTION_RECIPES_V1 } from "../launch-protection/recipes-v1";
const recipes = { ...IMMUTABLE_POOL_FEE_RECIPES_V2, ...LAUNCH_PROTECTION_RECIPES_V1 } as const;

/** Optional exact Native30 property. It grants no source-model eligibility,
 * admission or current-chain status and changes no historical V1 statement. */
export const IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2 = "programmable.immutable-pool-fee-runtime-proof.v2" as const;
export const IMMUTABLE_POOL_FEE_RATE_BPS_V2 = 30 as const;
export const IMMUTABLE_POOL_FEE_RECIPIENT_V2 = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" as Address;
export const IMMUTABLE_POOL_FEE_MANAGER_V2 = "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address;
export type ImmutablePoolFeeMarketV2 = Readonly<{ chainId: "4663"; poolManager: Address; currency0: Address;
  currency1: Address; fee: number; tickSpacing: number; hooks: Address }>;
export type ImmutablePoolFeeRecipeIdV2 = keyof typeof recipes;
type Recipe = Readonly<{ runtimeTemplateHex: Hex;
  immutableWords: readonly Readonly<{ name: string; byteOffsets: readonly number[] }>[] }>;
export type ImmutablePoolFeeRuntimeBindingV2 = Readonly<{ role: "hook" | "vault" | "module";
  address: Address; runtimeCodeHash: Hex; immutableWords: Readonly<Record<string, Hex>> | null }>;
export interface ImmutablePoolFeeRuntimeProofV2 {
  readonly schemaVersion: typeof IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2;
  readonly recipeId: ImmutablePoolFeeRecipeIdV2;
  readonly sourceArtifactHash: string;
  readonly market: ImmutablePoolFeeMarketV2;
  readonly recipient: Address;
  readonly rateBps: typeof IMMUTABLE_POOL_FEE_RATE_BPS_V2;
  readonly denominator: 10000;
  readonly scope: "exact_pool_key";
  readonly feeCurrency: "native";
  readonly assessmentBase: "gross_native_leg";
  readonly rounding: "ceil_per_trade";
  readonly accrual: "backed_pool_manager_native_claims";
  readonly claim: "permissionless_fixed_recipient";
  readonly feeVault: Address;
  readonly feeRecorder: Address;
  readonly runtimeBindings: readonly ImmutablePoolFeeRuntimeBindingV2[];
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
function marketKey(market: ImmutablePoolFeeMarketV2): ImmutablePoolFeeMarketV2 {
  if (!market || market.chainId !== "4663" || ![market.poolManager, market.currency0, market.currency1, market.hooks].every(isAddress)
    || !eq(market.poolManager, IMMUTABLE_POOL_FEE_MANAGER_V2) || !eq(market.currency0, ZERO)
    || eq(market.currency1, ZERO) || eq(market.hooks, ZERO) || !Number.isSafeInteger(market.fee)
    || !(market.fee >= 0 && (market.fee <= 1000000 || market.fee === 0x800000))
    || !Number.isSafeInteger(market.tickSpacing) || market.tickSpacing <= 0 || market.tickSpacing > 32767
    || (BigInt(market.hooks) & 0x3fffn) !== 0x20ccn) return fail();
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

export function readImmutableFeeRuntimeWordsV2(recipe: Recipe, runtime: Hex): Readonly<Record<string, Hex>> | null {
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
export function materializeImmutableFeeRuntimeWordsV2(recipe: Recipe, words: Readonly<Record<string, Hex>>): Hex {
  if (!words || Object.keys(words).sort().join() !== recipe.immutableWords.map(word => word.name).sort().join()) return fail();
  let runtime = recipe.runtimeTemplateHex;
  for (const immutable of recipe.immutableWords) {
    const word = words[immutable.name]; if (!isWord(word)) return fail();
    for (const offset of immutable.byteOffsets) {
      const start = offset * 2 + 2;
      runtime = `${runtime.slice(0, start)}${word.slice(2).toLowerCase()}${runtime.slice(start + 64)}` as Hex;
    }
  }
  if (!readImmutableFeeRuntimeWordsV2(recipe, runtime)) return fail();
  return runtime;
}

function hookCandidate(market: ImmutablePoolFeeMarketV2, runtime: Hex) {
  const key = marketKey(market);
  const match = (Object.keys(recipes) as (keyof typeof recipes)[]).map(recipeId => ({ recipeId, recipe: recipes[recipeId],
    words: readImmutableFeeRuntimeWordsV2(recipes[recipeId].hook, runtime) })).find(candidate => candidate.words !== null);
  if (!match?.words) return null;
  const { recipeId, recipe, words } = match;
  const vault = addressWord(words, "feeVault"), feeModule = addressWord(words, "module");
  if (!eq(addressWord(words, "poolManager"), key.poolManager) || !eq(addressWord(words, "token"), key.currency1)
    || numberWord(words, "lpFee") !== BigInt(key.fee) || numberWord(words, "tickSpacing") !== BigInt(key.tickSpacing)
    || !eq(vault, getContractAddress({ from: key.hooks, nonce: 1n })) || eq(addressWord(words, "initializer"), ZERO)
    || numberWord(words, "initialSqrtPriceX96") === 0n || numberWord(words, "initialSqrtPriceX96") >= 1n << 160n
    || numberWord(words, "creatorBuyFeeBps") + 30n >= 10000n || numberWord(words, "creatorSellFeeBps") + 30n >= 10000n
    || numberWord(words, "maxModuleLpFeePips") > 1000000n || eq(feeModule, key.poolManager)
    || eq(feeModule, ZERO) !== eq(words.moduleCodeHash!, WORD0)) return null;
  return { key, words, vault, feeModule, recipeId, recipe };
}
export function immutablePoolFeeRequiredAddressesV2(market: ImmutablePoolFeeMarketV2, hookRuntime: Hex): readonly Address[] | null {
  try {
    const candidate = hookCandidate(market, hookRuntime); if (!candidate) return null;
    return frozen([candidate.key.hooks, candidate.vault, ...(eq(candidate.feeModule, ZERO) ? [] : [candidate.feeModule])]);
  } catch { return null; }
}

function buildProof(market: ImmutablePoolFeeMarketV2, codes: Readonly<Record<string, Hex>>, rebuildSourceOnly: boolean) {
  const code = (address: Address) => {
    const matches = Object.entries(codes).filter(([key]) => eq(key, address)).map(([, value]) => value);
    if (matches.some(value => value !== matches[0])) return fail(); return matches[0];
  };
  const hookCode = code(market.hooks); if (!hookCode) return null;
  const candidate = hookCandidate(market, hookCode); if (!candidate) return null;
  const { key, words, vault, feeModule, recipeId, recipe } = candidate, vaultCode = code(vault); if (!vaultCode) return null;
  const vaultWords = readImmutableFeeRuntimeWordsV2(recipe.vault, vaultCode);
  if (!vaultWords || !eq(addressWord(vaultWords, "poolManager"), key.poolManager)
    || !eq(addressWord(vaultWords, "kernel"), key.hooks) || eq(addressWord(vaultWords, "creatorRecipient"), ZERO)) return null;
  const bindings: ImmutablePoolFeeRuntimeBindingV2[] = [
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
  const body = { schemaVersion: IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2, recipeId,
    sourceArtifactHash: recipe.sourceArtifactHash, market: key,
    recipient: IMMUTABLE_POOL_FEE_RECIPIENT_V2, rateBps: IMMUTABLE_POOL_FEE_RATE_BPS_V2, denominator: 10000 as const,
    scope: "exact_pool_key" as const, feeCurrency: "native" as const, assessmentBase: "gross_native_leg" as const,
    rounding: "ceil_per_trade" as const, accrual: "backed_pool_manager_native_claims" as const,
    claim: "permissionless_fixed_recipient" as const, feeVault: vault, feeRecorder: key.hooks, runtimeBindings: bindings };
  const proof = frozen({ ...body, proofDigest: keccak256(stringToHex(`${IMMUTABLE_POOL_FEE_PROOF_SCHEMA_V2}\n${canonical(body)}`)) });
  issued.add(proof); return proof;
}

/** Every code binding is required, including a nonzero read-only module. Caller
 * still proves where/when those exact bytes were observed independently. */
export function proveImmutablePoolFeeRuntimeV2(market: ImmutablePoolFeeMarketV2,
  codes: Readonly<Record<string, Hex>>): ImmutablePoolFeeRuntimeProofV2 | null {
  try { return buildProof(market, codes, false); } catch { return null; }
}
export function assertIssuedImmutablePoolFeeRuntimeProofV2(proof: ImmutablePoolFeeRuntimeProofV2, market: ImmutablePoolFeeMarketV2): void {
  if (!issued.has(proof) || canonical(proof.market) !== canonical(marketKey(market))) return fail();
}

/** Rebuilds a serialized source statement, never an observation. A module hash
 * is committed by the exact kernel immutable; the consumer MUST read its actual
 * runtime (along with every binding) before treating the statement as current. */
export function rebuildImmutablePoolFeeRuntimeProofV2(value: unknown, market: ImmutablePoolFeeMarketV2): ImmutablePoolFeeRuntimeProofV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const supplied = value as ImmutablePoolFeeRuntimeProofV2;
  if (!Object.hasOwn(recipes, supplied.recipeId) || !Array.isArray(supplied.runtimeBindings)
    || supplied.runtimeBindings.length < 2 || supplied.runtimeBindings.length > 3) return fail();
  const codes: Record<string, Hex> = {}, roles = new Set<string>(), addresses = new Set<string>();
  for (const binding of supplied.runtimeBindings) {
    if (!binding || !["hook", "vault", "module"].includes(binding.role) || !isAddress(binding.address)
      || !isWord(binding.runtimeCodeHash) || roles.has(binding.role) || addresses.has(binding.address.toLowerCase())) return fail();
    roles.add(binding.role); addresses.add(binding.address.toLowerCase());
    if (binding.role === "module") { if (binding.immutableWords !== null) return fail(); }
    else codes[binding.address.toLowerCase()] = materializeImmutableFeeRuntimeWordsV2(
      binding.role === "hook" ? recipes[supplied.recipeId].hook : recipes[supplied.recipeId].vault,
      binding.immutableWords!,
    );
  }
  const proof = buildProof(market, codes, true);
  if (!proof || canonical(proof) !== canonical(supplied)) return fail();
  return proof;
}
