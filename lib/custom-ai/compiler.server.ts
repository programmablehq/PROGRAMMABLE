import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import core from "./core-sources.json";
import { CustomAIError, type Draft, type FeeExpectation } from "./types";

export async function compileDraft(source: string, signal?: AbortSignal, expectations: FeeExpectation[] = [], feed?: import("./feed").FeedBinding, composable?: import("./rule-compiler.server").BoundRuleSpec): Promise<Draft> {
  if (!source || source.length > 32_000) throw new CustomAIError("source", "The generated module is too large.", 502);
  // The sandbox toolchain is included explicitly in next.config.ts.
  const compiler = await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR ?? join(process.cwd(), "scripts/custom-ai/toolchain"));
  const worker = join(process.cwd(), "scripts/custom-ai/compile-worker.mjs");
  const directory = await mkdtemp(join(tmpdir(), "custom-ai-compile-"));
  const input = JSON.stringify({ language: "Solidity", sources: { ...core.sources, "GeneratedFeeModule.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun",
      outputSelection: { "GeneratedFeeModule.sol": { "": ["ast"], "GeneratedFeeModule": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } } } });
  // The WebAssembly compiler receives only standard JSON, with no import
  // callback. The child has no secrets, file writes or process permissions.
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${compiler}`, `--allow-fs-read=${join(process.cwd(), "scripts/custom-ai")}`,
        "--max-old-space-size=384", worker, compiler],
        { cwd: directory, env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 35_000, maxBuffer: 2_000_000, signal },
        (error, stdout) => error ? reject(new CustomAIError("compiler", "The isolated module check did not finish.", 503)) : resolve(stdout));
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(JSON.stringify({ compilerInput: JSON.parse(input), expectations, feed, composable }));
    });
    const result = JSON.parse(output) as Omit<Draft, "source" | "sourceHash">;
    return { ...result, ...(feed ? { feed } : {}), ...(composable ? { composable } : {}), source, sourceHash: createHash("sha256").update(source).digest("hex") };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
