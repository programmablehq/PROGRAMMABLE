import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";

const root = new URL("../../", import.meta.url);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(root), encoding: "utf8" }).trim();
const contracts = {};
for (const name of ["FoundationEthereumGraphProxyV2", "FoundationTokenV1", "FoundationHookV2"]) {
  const artifact = JSON.parse(await readFile(new URL(`contracts/out/module-foundation/${name}.sol/${name}.json`, root), "utf8"));
  const { settings, sources, compiler } = artifact.metadata;
  if (compiler.version !== "0.8.26+commit.8a97fa7a" || settings.evmVersion !== "cancun"
    || !settings.viaIR || !settings.optimizer.enabled || settings.optimizer.runs !== 200
    || settings.metadata.bytecodeHash !== "none" || settings.metadata.appendCBOR !== false
    || Object.keys(settings.libraries).length) throw new Error(`Unexpected compiler settings: ${name}`);
  for (const [path, source] of Object.entries(sources)) {
    const bytes = await readFile(new URL(`contracts/${path}`, root));
    if (keccak256(bytes) !== source.keccak256) throw new Error(`Stale compiler input: ${path}`);
    if (!path.startsWith("lib/")) {
      const committed = execFileSync("git", ["show", `${sourceCommit}:contracts/${path}`], { cwd: fileURLToPath(root) });
      if (!committed.equals(bytes)) throw new Error(`Source has not been committed: ${path}`);
    }
  }
  const creationBytecode = artifact.bytecode.object, runtimeTemplate = artifact.deployedBytecode.object;
  if (![creationBytecode, runtimeTemplate].every(code => /^0x(?:[a-f0-9]{2})+$/i.test(code))) throw new Error(`Unlinked bytecode: ${name}`);
  contracts[name] = {
    constructorInputs: artifact.abi.find(item => item.type === "constructor").inputs,
    creationBytecode, creationCodeHash: keccak256(creationBytecode), runtimeTemplate,
    immutableReferences: Object.values(artifact.deployedBytecode.immutableReferences).flat(),
    sources: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, source.keccak256])),
  };
}
const body = JSON.stringify({ schemaVersion: "programmable.ethereum-module-bytecode.v2", sourceCommit,
  compilerVersion: "0.8.26+commit.8a97fa7a", evmVersion: "cancun", viaIR: true, optimizerRuns: 200, contracts }, null, 2) + "\n";
await writeFile(new URL("contracts/spec/module-foundation/ethereum-graph-bytecode.v2.json", root), body);
console.log(`Exported source-bound V2 proxy, token and hook bytecode (${Buffer.byteLength(body)} bytes).`);
