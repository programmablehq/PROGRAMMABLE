/** Closed, source-bound compiler choices. No model-selected optimizer details,
 * import callback, compiler binary or host dependency is accepted. */
export const GENERAL_PROJECT_COMPILER = "0.8.26+commit.8a97fa7a";
export type ProjectCompilerProfile = "standard-v1" | "viair-200-v1";
export type ProjectCompiler = { version: typeof GENERAL_PROJECT_COMPILER; evmVersion: "paris" | "cancun" } &
  ({ optimizerRuns: 1000; viaIR: false } | { optimizerRuns: 200; viaIR: true });
export function approvedProjectCompiler(value: unknown): value is ProjectCompiler {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const compiler = value as Record<string, unknown>;
  return compiler.version === GENERAL_PROJECT_COMPILER && typeof compiler.evmVersion === "string" && ["paris", "cancun"].includes(compiler.evmVersion) &&
    (compiler.optimizerRuns === 1000 && compiler.viaIR === false || compiler.optimizerRuns === 200 && compiler.viaIR === true);
}
export function projectCompilerProfile(value: unknown): ProjectCompilerProfile {
  if (!approvedProjectCompiler(value)) throw new TypeError("Keep the saved approved compiler profile.");
  return value.viaIR ? "viair-200-v1" : "standard-v1";
}
export function createProjectCompiler(profile: unknown, evmVersion: unknown): ProjectCompiler {
  if (typeof evmVersion !== "string" || !["paris", "cancun"].includes(evmVersion) || typeof profile !== "string" || !["standard-v1", "viair-200-v1"].includes(profile))
    throw new TypeError("Use a pinned compiler profile and EVM target.");
  const target = evmVersion as ProjectCompiler["evmVersion"];
  return profile === "viair-200-v1" ? { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 200, viaIR: true, evmVersion: target }
    : { version: GENERAL_PROJECT_COMPILER, optimizerRuns: 1000, viaIR: false, evmVersion: target };
}
/** Original pinned protection-kit aliases. Every resolved source must still be
 * present inline. These are path mappings, never network or filesystem reads. */
export const VIAIR_200_REMAPPINGS = Object.freeze([
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "@openzeppelin/uniswap-hooks/=lib/openzeppelin-uniswap-hooks/",
  "@solady/=lib/solady/", "@uniswap/blocknumberish/=lib/blocknumberish/",
  "@uniswap/liquidity-launcher/=lib/liquidity-launcher/", "@uniswap/uerc20-factory/=lib/uerc20-factory/",
  "@uniswap/universal-router/=lib/universal-router/", "@uniswap/v4-core/=lib/v4-core/",
  "@uniswap/v4-periphery-v211/=lib/v4-periphery-v211/", "@uniswap/v4-periphery/=lib/v4-periphery/",
  "blocknumberish/=lib/blocknumberish/", "continuous-clearing-auction/=lib/continuous-clearing-auction/src/",
  "forge-std/=lib/forge-std/src/", "liquidity-launcher/=lib/liquidity-launcher/", "permit2/=lib/permit2/",
  "solady/=lib/solady/src/", "solmate/=lib/solmate/", "test/module-mode/=test/module-mode/", "v4-periphery/=lib/v4-periphery/",
]);
