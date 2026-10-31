import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// The parent supplies only fixed local SDK/config paths. Generated Solidity is
// data for the existing packer and isolated EVM, never a host-language program.
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const lines = input[Symbol.asyncIterator]();
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
try {
  const first = await lines.next();
  if (first.done || Buffer.byteLength(first.value) > 64_000) throw Error();
  const envelope = JSON.parse(first.value);
  if (envelope.version !== 1) throw Error();
  const { buildLaunch } = await import(pathToFileURL(process.argv[2]).href);
  let runtimeCalls = 0;
  const built = await buildLaunch({ configPath: envelope.configPath, ...envelope.overrides,
    runtimeMaterializer: async prediction => {
      if (++runtimeCalls !== 1) throw Error();
      emit({ type: "runtime", prediction });
      const next = await lines.next();
      if (next.done || Buffer.byteLength(next.value) > 4_000_000) throw Error();
      const result = JSON.parse(next.value);
      if (result.type !== "runtime-result") throw Error();
      return result.materialization;
    } });
  if (runtimeCalls !== 1 || !built.runtimeMaterialization) throw Error();
  emit({ type: "complete", bodyBase64: built.requestBytes.toString("base64"), receipt: built.receipt,
    runtimeMaterialization: built.runtimeMaterialization,
    diagnostics: built.diagnostics?.map(diagnostic => ({ code: diagnostic.code, stage: diagnostic.stage })) ?? [] });
} catch (error) {
  emit({ type: "failed", code: typeof error?.code === "string" && /^[A-Z0-9_-]{1,96}$/u.test(error.code) ? error.code : "PACK_INVALID" });
  process.exitCode = 4;
} finally { input.close(); }
