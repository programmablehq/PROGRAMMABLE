import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const type = p => p.type.startsWith("tuple") ? `(${p.components.map(type).join(",")})${p.type.slice(5)}` : p.type;
const parameters = values => (values ?? []).map(type).join(",");
// The selector uses types only, but the planner also needs parameter meaning.
// Keep compiler-issued top-level names, especially adjacent bool/uint fields.
const namedParameters = values => (values ?? []).map(p => `${type(p)}${p.name ? ` ${p.name}` : ""}`).join(",");
const groups = [
  ["elysium-launch-protection-v1", ["ElysiumProtectedNativeInitializerV1", "ProtectedLaunchTokenV1", "ElysiumProtectedNative30HookV1", "EthereumNativeFeeVaultV3", "ElysiumLaunchProtectionModuleV1"]],
  ["launch-protection-v1", ["ProtectedNativeInitializerV1", "ProtectedLaunchTokenV1", "ProtectedNative30HookV1", "EthereumNativeFeeVaultV3", "LaunchProtectionModuleV1"]],
  ["base-launch-protection-v1", ["BaseProtectedNativeInitializerV1", "ProtectedLaunchTokenV1", "BaseProtectedNative30HookV1", "EthereumNativeFeeVaultV3", "BaseLaunchProtectionModuleV1"]],
  ["hyperevm-launch-protection-v1", ["HyperEvmProtectedNativeInitializerV1", "ProtectedLaunchTokenV1", "HyperEvmProtectedNative30HookV1", "EthereumNativeFeeVaultV3", "HyperEvmLaunchProtectionModuleV1"]],
];
const families = {};
for (const [family, names] of groups) {
  const folder = resolve(root, "packages/launch/contracts", family);
  const sources = JSON.parse(readFileSync(resolve(folder, "standard-json.json"), "utf8")).sources;
  families[family] = names.map(name => {
    const artifact = JSON.parse(readFileSync(resolve(folder, `${name}.artifact.json`), "utf8"));
    return {
      source: artifact.sourcePath, contract: artifact.contractName,
      sourceSha256: createHash("sha256").update(sources[artifact.sourcePath].content).digest("hex"),
      constructor: parameters(artifact.abi.find(f => f.type === "constructor")?.inputs),
      functions: artifact.abi.filter(f => f.type === "function").map(f => `function ${f.name}(${namedParameters(f.inputs)})${f.stateMutability === "nonpayable" ? "" : ` ${f.stateMutability}`}${f.outputs?.length ? ` returns (${namedParameters(f.outputs)})` : ""}`),
      events: artifact.abi.filter(f => f.type === "event").map(f => `event ${f.name}(${f.inputs.map(p => `${type(p)}${p.indexed ? " indexed" : ""}`).join(",")})`),
      allowReceive: artifact.abi.some(f => f.type === "receive"), allowFallback: artifact.abi.some(f => f.type === "fallback"),
    };
  });
}
const content = JSON.stringify({ version: 1, families }, null, 2) + "\n";
const target = resolve(root, "lib/custom-ai/canonical-interfaces.json");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content) throw Error("Canonical interface catalog differs from the pinned contract artifacts.");
} else writeFileSync(target, content);
