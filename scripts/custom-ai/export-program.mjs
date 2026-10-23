import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const requireTool = createRequire(resolve(process.env.CUSTOM_AI_COMPILER_DIR, "package.json"));
const { keccak256 } = requireTool("viem");
const sha = value => createHash("sha256").update(value).digest("hex");
const built = JSON.parse(await readFile(resolve(root, "contracts/out/custom-ai/CustomAIProgramV1.sol/CustomAIProgramV1.json")));
const sourceHashes = {};
for (const [path, data] of Object.entries(built.metadata.sources)) {
  const absolute = resolve(root, "contracts", path);
  if (!absolute.startsWith(root + "/contracts/")) throw Error("Invalid source path");
  const content = await readFile(absolute);
  if (keccak256(content) !== data.keccak256) throw Error(`Stale program build: ${path}`);
  sourceHashes[path] = sha(content);
}
const payload = { version: "custom-ai-funded-program-v1", compiler: built.metadata.compiler.version, sourceHashes,
  artifact: { abi: built.abi, initCode: built.bytecode.object, runtimeTemplate: built.deployedBytecode.object,
    immutableReferences: built.deployedBytecode.immutableReferences } };
const bundle = { ...payload, bundleHash: sha(JSON.stringify(payload)) };
const save = async (path, value) => {
  const text = JSON.stringify(value) + "\n";
  if (process.argv.includes("--check")) {
    if (await readFile(resolve(root, path), "utf8") !== text) throw Error(`Stale exported artifact: ${path}`);
  } else await writeFile(resolve(root, path), text);
};
await save("lib/custom-ai/program-code.json", bundle);
await save("lib/custom-ai/program-manifest.json", { bundleHash: bundle.bundleHash });
const feed = JSON.parse(await readFile(resolve(root, "contracts/out/custom-ai/CustomAIDataFeedV1.sol/CustomAIDataFeedV1.json")));
const feedSources = {};
for (const [path, data] of Object.entries(feed.metadata.sources)) {
  const absolute = resolve(root, "contracts", path);
  if (!absolute.startsWith(root + "/contracts/")) throw Error("Invalid feed source path");
  const content = await readFile(absolute);
  if (keccak256(content) !== data.keccak256) throw Error(`Stale feed build: ${path}`);
  feedSources[path] = sha(content);
}
await save("lib/custom-ai/feed-code.json", { abi: feed.abi, initCode: feed.bytecode.object,
  runtimeTemplate: feed.deployedBytecode.object, immutableReferences: feed.deployedBytecode.immutableReferences, sourceHashes: feedSources });
console.log(JSON.stringify({ bundleHash: bundle.bundleHash, sources: Object.keys(sourceHashes).length }));
