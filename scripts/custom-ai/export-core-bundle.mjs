// Export trusted, source-bound fixtures for the networkless EVM worker.
// Run after the focused Foundry build. Never compiles submitted source.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const requireTool = createRequire(resolve(process.env.CUSTOM_AI_COMPILER_DIR, "package.json"));
const { keccak256 } = requireTool("viem");
const sha = value => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(resolve(root, "contracts/spec/custom-ai/verification-bundle/manifest.json")));
const names = ["PoolManager", "CustomAIFactoryV1", "CustomAIHookDeployerV1", "CustomAILiquidityDeployerV1",
  "CustomAISwapRouterV1", "CustomAITokenV1", "CustomAIHookV1", "CustomAIFeeLedgerV1", "CustomAIRewardVaultV1",
  "CustomAILiquidityVaultV1"];
const contracts = {}, sourceHashes = {};
for (const name of names) {
  const file = name;
  const artifact = JSON.parse(await readFile(resolve(root, `contracts/out/custom-ai/${file}.sol/${name}.json`)));
  for (const [path, data] of Object.entries(artifact.metadata.sources)) {
    const full = resolve(root, "contracts", path);
    if (!full.startsWith(root + "/contracts/")) throw Error("Source path escapes contracts");
    const content = await readFile(full);
    if (keccak256(content) !== data.keccak256) throw Error(`Stale artifact: ${path}`);
    sourceHashes[path] = sha(content);
  }
  const initCode = artifact.bytecode.object, runtimeTemplate = artifact.deployedBytecode.object;
  const target = manifest.targets[name];
  if (name.startsWith("CustomAI") && (!target || sha(Buffer.from(initCode.slice(2), "hex")) !== target.creationTemplateSha256
    || sha(Buffer.from(runtimeTemplate.slice(2), "hex")) !== target.runtimeTemplateSha256)) throw Error(`Unreproduced core: ${name}`);
  contracts[name] = { abi: artifact.abi, initCode, runtimeTemplate,
    immutableReferences: artifact.deployedBytecode.immutableReferences ?? {} };
}
const fixtureSource = await readFile(resolve(import.meta.dirname, "SimulationQuote.sol"), "utf8");
const solc = requireTool("solc");
if (!solc.version().startsWith("0.8.26+commit.8a97fa7a")) throw Error("Wrong fixture compiler");
const fixtureOutput = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity",
  sources: { "SimulationQuote.sol": { content: fixtureSource } }, settings: { optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } } })));
if (fixtureOutput.errors?.some(e => e.severity === "error")) throw Error("Fixture compilation failed");
const fixture = fixtureOutput.contracts["SimulationQuote.sol"].SimulationQuote;
contracts.SimulationQuote = { abi: fixture.abi, initCode: "0x" + fixture.evm.bytecode.object, runtimeTemplate: "0x" + fixture.evm.deployedBytecode.object };
sourceHashes["scripts/custom-ai/SimulationQuote.sol"] = sha(fixtureSource);
const payload = { version: "custom-ai-composed-lifecycle-v1", compiler: manifest.compilerVersion,
  coreManifestHash: sha(JSON.stringify(manifest)), sourceHashes, contracts };
const bundle = { ...payload, bundleHash: sha(JSON.stringify(payload)) };
await writeFile(resolve(import.meta.dirname, "core-bundle.json"), JSON.stringify(bundle) + "\n");
await writeFile(resolve(root, "lib/custom-ai/launch-code.json"), JSON.stringify({
  bundleHash: bundle.bundleHash, tokenCreationCode: contracts.CustomAITokenV1.initCode,
}) + "\n");
console.log(JSON.stringify({ contracts: names.length, sources: Object.keys(sourceHashes).length, bundleHash: bundle.bundleHash }));
