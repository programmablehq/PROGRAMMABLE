import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { keccak256 } from "viem";
const root = resolve(import.meta.dirname, "../..");
const sha = value => createHash("sha256").update(value).digest("hex");
const contracts = ["CustomAIDataFeedV2", "CustomAIProgramRouterV1", "CustomAIExecutionPriceFeedV1", "CustomAILiquidityProgramV1", "CustomAIProgramFactoryV1", "CustomAIProgramRouterDeployerV1", "CustomAILiquidityProgramDeployerV1", "CustomAIFundedProgramDeployerV1"];
const entries = {};
for (const name of contracts) {
  const raw = JSON.parse(await readFile(resolve(root, `contracts/out/custom-ai/${name.endsWith("DeployerV1") ? "CustomAIProgramDeployersV1" : name}.sol/${name}.json`), "utf8"));
  const metadata = typeof raw.metadata === "string" ? JSON.parse(raw.metadata) : raw.metadata;
  const sourceHashes = [];
  for (const [path, source] of Object.entries(metadata.sources).sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const absolute = resolve(root, "contracts", path);
    if (!absolute.startsWith(resolve(root, "contracts") + "/")) throw Error("Invalid artifact source path");
    const content = await readFile(absolute);
    if (keccak256(content) !== source.keccak256) throw Error(`Stale contract artifact: ${path}`);
    sourceHashes.push({ path, sha256: sha(content) });
  }
  // AST ids depend on which other sources solc compiled in the same batch.
  // Bind the actual immutable offsets so clean and incremental builds agree.
  const immutableReferences = Object.fromEntries(Object.values(raw.deployedBytecode.immutableReferences ?? {})
    .map(offsets => [...offsets].sort((a, b) => a.start - b.start))
    .sort((a, b) => a[0].start - b[0].start).map((offsets, index) => [String(index + 1), offsets]));
  entries[name] = { abi: raw.abi, initCode: raw.bytecode.object, runtimeTemplate: raw.deployedBytecode.object,
    immutableReferences, sourceHashes };
}
const output = { version: "custom-ai-composable-v2", contracts: entries };
const bundle = { ...output, bundleHash: sha(JSON.stringify(output)) };
const save = async (path, value) => {
  const body = JSON.stringify(value, null, 2) + "\n", target = resolve(root, path);
  if (process.argv.includes("--check")) { if (await readFile(target, "utf8") !== body) throw Error(`Stale artifact ${path}`); }
  else await writeFile(target, body);
};
await save("lib/custom-ai/feed-v2-code.json", entries.CustomAIDataFeedV2);
await save("lib/custom-ai/composable-code.json", bundle);
await save("lib/custom-ai/composable-manifest.json", { version: output.version, bundleHash: bundle.bundleHash });
console.log(JSON.stringify({ bundleHash: bundle.bundleHash, contracts: contracts.length }));
