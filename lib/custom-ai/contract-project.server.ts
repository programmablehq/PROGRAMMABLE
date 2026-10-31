import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { projectCompilerInput, type ContractProject, type ProjectEntrypoint } from "./contract-project";
import { CustomAIError } from "./types";

export type CompiledProject = {
  version: 1;
  projectHash: ContractProject["hash"];
  artifactHash: `sha256:${string}`;
  compiled: boolean;
  compiler: string;
  diagnostics: { severity: "error" | "warning"; message: string }[];
  contracts: (ProjectEntrypoint & { abi: import("viem").Abi; creationBytecode: `0x${string}`; runtimeBytecode: `0x${string}`;
    immutableReferences: Record<string, { start: number; length: number }[]>; storageLayout: unknown;
    /** Older saved builds remain readable; new production packing requires the
     * exact compiler metadata rather than a client-created reconstruction. */
    compilerMetadata?: string })[];
  /** Compilation does not establish intended behavior or review approval. */
  verification: "not-run";
  launchReady: false;
};

export async function compileContractProject(project: ContractProject, signal?: AbortSignal): Promise<CompiledProject> {
  const compilerInput = projectCompilerInput(project);
  const compiler = await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR ?? join(process.cwd(), "scripts/custom-ai/toolchain"));
  const worker = join(process.cwd(), "scripts/custom-ai/general-project-worker.mjs");
  const directory = await mkdtemp(join(tmpdir(), "custom-ai-project-"));
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${compiler}`, `--allow-fs-read=${worker}`,
        "--max-old-space-size=384", worker, compiler], { cwd: directory, env: { NODE_ENV: "production" }, encoding: "utf8",
        timeout: 35_000, maxBuffer: 4_000_000, signal }, (error, stdout) => error
        ? reject(new CustomAIError("project-compiler", "The isolated contract build did not finish. Your source package is saved.", 503)) : resolve(stdout));
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(JSON.stringify({ compilerInput, entrypoints: project.entrypoints }));
    });
    const result = JSON.parse(output) as Pick<CompiledProject, "compiled" | "compiler" | "diagnostics" | "contracts">;
    const body = { version: 1 as const, projectHash: project.hash, ...result, verification: "not-run" as const, launchReady: false as const };
    return { ...body, artifactHash: canonicalBrowserSha256V2("programmable.custom-ai-project-artifacts.v1", body) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
