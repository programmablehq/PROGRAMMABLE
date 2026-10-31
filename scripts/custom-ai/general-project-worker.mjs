import { createRequire } from "node:module";
import { join } from "node:path";

const requireCompiler = createRequire(join(process.argv[2], "package.json"));
const solc = requireCompiler("solc");
if (!solc.version().startsWith("0.8.26+commit.8a97fa7a")) process.exit(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > 1_500_000) process.exit(3);
});
process.stdin.on("end", () => {
  try {
    const envelope = JSON.parse(input);
    // Solidity source is input data. The compiler has no import callback,
    // filesystem writer, network capability or dependency installer.
    const output = JSON.parse(solc.compile(JSON.stringify(envelope.compilerInput)));
    const hasCompilerErrors = (output.errors ?? []).some(error => error.severity === "error");
    const diagnostics = [...(output.errors ?? []).filter(error => error.severity === "error"),
      ...(output.errors ?? []).filter(error => error.severity !== "error")].slice(0, 16).map(error => ({ severity: error.severity === "error" ? "error" : "warning",
      message: String(error.formattedMessage ?? error.message ?? "Compiler diagnostic").slice(0, 2000) }));
    const contracts = [];
    if (!hasCompilerErrors) for (const entry of envelope.entrypoints) {
      const contract = output.contracts?.[entry.source]?.[entry.contract];
      const bytecode = contract?.evm?.bytecode, runtime = contract?.evm?.deployedBytecode;
      if (!contract || !bytecode?.object || !runtime?.object || typeof contract.metadata !== "string") {
        diagnostics.push({ severity: "error", message: `${entry.source}:${entry.contract} must be a concrete contract.` });
        continue;
      }
      if (runtime.object.length > 49_152 || bytecode.object.length > 98_304) {
        diagnostics.push({ severity: "error", message: `${entry.source}:${entry.contract} exceeds the EVM code size limit.` });
        continue;
      }
      const unlinked = [...Object.values(bytecode.linkReferences ?? {}), ...Object.values(runtime.linkReferences ?? {})]
        .some(file => Object.keys(file).length > 0);
      if (unlinked || !/^[0-9a-f]+$/.test(bytecode.object) || !/^[0-9a-f]+$/.test(runtime.object)) {
        diagnostics.push({ severity: "error", message: `${entry.source}:${entry.contract} needs explicitly linked libraries.` });
        continue;
      }
      contracts.push({ ...entry, abi: contract.abi, creationBytecode: `0x${bytecode.object}`, runtimeBytecode: `0x${runtime.object}`,
        immutableReferences: runtime.immutableReferences ?? {}, storageLayout: contract.storageLayout, compilerMetadata: contract.metadata });
    }
    const compiled = !hasCompilerErrors && !diagnostics.some(error => error.severity === "error") && contracts.length === envelope.entrypoints.length;
    process.stdout.write(JSON.stringify({ compiled, compiler: solc.version(), diagnostics,
      contracts: compiled ? contracts : [] }));
  } catch {
    // Never return process paths, environment values or internal exceptions.
    process.exitCode = 4;
  }
});
