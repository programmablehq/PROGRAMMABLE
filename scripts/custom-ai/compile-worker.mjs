import { createRequire } from "node:module";
import { join } from "node:path";
import { artifactHash } from "./artifact-hash.mjs";
import { eventModuleSource } from "./event-module.mjs";
import { inspectModule, simulateModule } from "./validate-module.mjs";

const requireCompiler = createRequire(join(process.argv[2], "package.json"));
const solc = requireCompiler("solc");
if (!solc.version().startsWith("0.8.26+commit.8a97fa7a")) process.exit(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > 256_000) process.exit(3);
});
process.stdin.on("end", async () => {
  // No import callback. Solidity is data to the WebAssembly compiler,
  // never JavaScript or a program to execute on the host.
  try {
    const envelope = JSON.parse(input);
    const expectations = envelope.expectations ?? [];
    if (!Array.isArray(expectations) || expectations.length > 64) throw Error("Invalid expectations");
    const result = JSON.parse(solc.compile(JSON.stringify(envelope.compilerInput ?? envelope)));
    const diagnostics = (result.errors ?? []).filter(entry => entry.severity === "error")
      .slice(0, 8).map(entry => (entry.formattedMessage ?? entry.message).slice(0, 1500));
    const contract = result.contracts?.["GeneratedFeeModule.sol"]?.GeneratedFeeModule;
    if (!diagnostics.length && !contract?.evm?.deployedBytecode?.object) diagnostics.push("GeneratedFeeModule must be a concrete contract.");
    if (contract?.evm?.deployedBytecode?.object.length > 49_152) diagnostics.push("The module exceeds the EVM runtime size limit.");
    if (contract?.evm?.bytecode?.object.length > 98_304) diagnostics.push("The module exceeds the EVM initcode size limit.");
    if (diagnostics.length) { process.stdout.write(JSON.stringify({ compiled: false, diagnostics })); return; }
    const ast = result.sources["GeneratedFeeModule.sol"].ast;
    const source = envelope.compilerInput?.sources?.["GeneratedFeeModule.sol"]?.content ?? "";
    const cleanSource = source.replace(/\n?\/\/ @programmable-program-v1 [^\n]*/g, "").trim();
    const structural = envelope.feed && cleanSource === eventModuleSource(envelope.feed).trim() ? [] : inspectModule(ast);
    const simulation = structural.length ? { cases: 0, samples: [], diagnostics: structural } : await simulateModule(requireCompiler, contract, ast, expectations, envelope.feed);
    const artifact = { compiler: solc.version(), optimizerRuns: 200, evmVersion: "cancun", abi: contract.abi,
      initCode: `0x${contract.evm.bytecode.object}`, runtimeTemplate: `0x${contract.evm.deployedBytecode.object}`,
      immutableReferences: contract.evm.deployedBytecode.immutableReferences };
    process.stdout.write(JSON.stringify({ compiled: true, diagnostics: simulation.diagnostics,
      validation: { version: "self-contained-fee-v1", status: simulation.diagnostics.length ? "blocked" : "passed",
        artifactHash: artifactHash(artifact), cases: simulation.cases, maxGas: simulation.maxGas, samples: simulation.samples,
        deployments: simulation.deployments ?? [], expectationCases: simulation.expectationCases ?? 0 }, artifact: simulation.diagnostics.length ? undefined : artifact }));
  } catch {
    // Host errors must never include paths, environment values or input source.
    process.exitCode = 4;
  }
});
