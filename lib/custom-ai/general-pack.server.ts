import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { generalGraphPackConfig, type GeneralPackInput } from "./general-pack-config.server";
import { materializeGeneralRuntime, type GeneralDeploymentPrediction, type GeneralRuntimeDependencyResolver } from "./runtime-materialization.server";
import { CustomAIError } from "./types";

type MaterializedTarget = { targetId: string; applicantSalt: `0x${string}`;
  runtimeImmutables: { immutableId: string; abiType: "bytes32"; literal: `0x${string}` }[]; runtimeCodeHash: `0x${string}` };
type PackComplete = { type: "complete"; bodyBase64: string; receipt: Record<string, unknown>;
  runtimeMaterialization: { version: 1; targets: MaterializedTarget[] }; diagnostics: { code: string; stage: string }[] };
const workerError = () => new CustomAIError("launch-pack-worker", "The isolated launch preparation did not finish. Your saved source is kept.", 503);
export class GeneralPackRejected extends CustomAIError {
  readonly finding: Readonly<{ code: string }>;
  constructor(code: string) {
    const infrastructure = /^(?:ERR_|MODULE_NOT_FOUND$)/u.test(code);
    super(infrastructure ? "launch-pack-worker" : "launch-pack-profile", infrastructure ? workerError().message
      : "This source does not yet satisfy the selected launch profile. Your source is saved for a focused update.", infrastructure ? 503 : 422);
    this.finding = Object.freeze({ code: /^[A-Z0-9_-]{1,96}$/u.test(code) ? code : "PACK_INVALID" });
  }
}

/** One bounded, local canonical pack. The caller must durably reserve identity
 * first, persist these exact bytes before transport, and revalidate ownership
 * and current production context. This function never submits or signs. */
export async function packGeneralGraph(input: GeneralPackInput, signal?: AbortSignal, resolveObservedDependencies?: GeneralRuntimeDependencyResolver) {
  signal?.throwIfAborted();
  const nativeFundingWei = input.nativeFundingWei;
  const plan = generalGraphPackConfig(input);
  const production = plan.source.project.production!;
  let toolchain: string;
  try { toolchain = await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR ?? join(process.cwd(), "scripts/custom-ai/toolchain")); }
  catch { throw workerError(); }
  signal?.throwIfAborted();
  const directory = await realpath(await mkdtemp(join(tmpdir(), "custom-ai-pack-"))), sourceRoot = join(directory, "source"), sdkRoot = join(directory, "sdk");
  try {
    await mkdir(sourceRoot);
    for (const file of plan.files) {
      if (!/^(?:input\.json|image\.webp|artifacts\/target-[0-9]{1,2}\.json|evidence\/(?:compilation|behavior|declaration)\.json)$/u.test(file.path)) throw workerError();
      const target = join(sourceRoot, file.path); await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.bytes, { mode: 0o600, flag: "wx" });
    }
    const configPath = join(sourceRoot, "config.json");
    await writeFile(configPath, JSON.stringify(plan.config), { mode: 0o600, flag: "wx" });
    // Resolve SDK dependencies only from the already pinned toolchain. Do not
    // install packages in a request or rely on a developer's nested node_modules.
    await mkdir(sdkRoot);
    for (const part of ["src", "contracts"]) await cp(join(process.cwd(), "packages/launch", part), join(sdkRoot, part), { recursive: true });
    await cp(join(process.cwd(), "packages/launch/package.json"), join(sdkRoot, "package.json"));
    await symlink(join(toolchain, "node_modules"), join(directory, "node_modules"), "dir");
    signal?.throwIfAborted();
    const worker = join(process.cwd(), "scripts/custom-ai/general-pack-worker.mjs"), stopped = new AbortController();
    const combined = signal ? AbortSignal.any([signal, stopped.signal]) : stopped.signal;
    let construction: Awaited<ReturnType<typeof materializeGeneralRuntime>> | undefined;
    const completed = await new Promise<PackComplete>((resolve, reject) => {
      let buffer = "", runtimeCalls = 0, frame: PackComplete | undefined, failure: unknown, handling: Promise<void> | undefined;
      const fail = (error: unknown) => { failure ??= error; stopped.abort(); };
      const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${directory}`, `--allow-fs-read=${toolchain}`,
        `--allow-fs-read=${worker}`, "--max-old-space-size=384", worker, join(sdkRoot, "src/pack.mjs")],
      { cwd: directory, env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 75_000, maxBuffer: 16_000_000, signal: combined }, error => {
        stopped.abort();
        if (failure) reject(failure);
        else if (error || !frame || buffer.trim() || runtimeCalls !== 1) reject(workerError());
        else resolve(frame);
      });
      child.stdin?.on("error", () => undefined);
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 16_000_000) { fail(workerError()); return; }
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0 && !failure) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.type === "runtime" && !frame && ++runtimeCalls === 1) {
              if (message.prediction.chainId !== String(plan.source.project.chainId)
                || message.prediction.launchWallet.toLowerCase() !== plan.values.controller.toLowerCase()) throw workerError();
              handling = (async () => {
                const runtime = await materializeGeneralRuntime(plan.source.project, plan.source.compilation,
                  { controller: plan.values.controller, settings: plan.values.settings,
                    ...(plan.values.opening ? { opening: plan.values.opening } : {}),
                    ...(resolveObservedDependencies ? { resolveObservedDependencies } : {}),
                    ...(nativeFundingWei === undefined ? {} : { nativeFundingWei }) },
                  message.prediction.predictions as GeneralDeploymentPrediction[], combined);
                construction = runtime;
                if (!failure && !combined.aborted) child.stdin?.write(`${JSON.stringify({ type: "runtime-result", materialization: {
                  targets: runtime.contracts.map(contract => ({ targetId: contract.id, runtimeImmutables: contract.runtimeImmutables, runtimeCodeHash: contract.runtimeCodeHash })) } })}\n`);
              })();
              void handling.catch(fail);
            } else if (message.type === "complete" && runtimeCalls === 1 && !frame) {
              frame = message as PackComplete; child.stdin?.end();
            } else if (message.type === "failed") {
              fail(new GeneralPackRejected(typeof message.code === "string" ? message.code : "PACK_INVALID"));
            } else throw workerError();
          } catch (error) { fail(error instanceof CustomAIError ? error : workerError()); }
        }
      });
      const overrides = { directNativeProfileVersion: production.profileVersion, directNativeRouter: production.executor.address,
        ...(plan.source.project.chainId === 1 ? { directNativeTradeFeePolicy: production.graphProfile!.programmableTradeFeePolicy } : {}) };
      child.stdin?.write(`${JSON.stringify({ version: 1, configPath, overrides })}\n`);
    });
    signal?.throwIfAborted();
    if (typeof completed.bodyBase64 !== "string" || completed.bodyBase64.length > 11_184_816) throw workerError();
    const bytes = Buffer.from(completed.bodyBase64, "base64"), requestSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.byteLength > 8_388_608 || bytes.toString("base64") !== completed.bodyBase64 || completed.receipt?.requestSha256 !== requestSha256
      || completed.runtimeMaterialization?.version !== 1 || completed.runtimeMaterialization.targets?.length !== plan.config.targets.length) throw workerError();
    const requestBody = bytes.toString("utf8"), request = JSON.parse(requestBody);
    if (request.schemaVersion !== "programmable.custom-launch-create-request.v3" || request.chainId !== String(plan.source.project.chainId)
      || request.launchWallet.toLowerCase() !== plan.values.controller.toLowerCase() || request.nonce !== plan.identity.nonce
      || canonicalBrowserSha256V2("programmable.custom-ai-exact-launch-profile.v1", request.launchProfile)
        !== canonicalBrowserSha256V2("programmable.custom-ai-exact-launch-profile.v1", production.graphProfile)) throw workerError();
    const finalTargets = new Map(completed.runtimeMaterialization.targets.map(target => [target.targetId, target]));
    if (!construction || construction.contracts.some(contract => finalTargets.get(contract.id)?.runtimeCodeHash !== contract.runtimeCodeHash)
      || plan.source.project.deployment?.version === 2 && (construction.version < 2 || !construction.children?.length)) throw workerError();
    const reproducibleConfig = { ...plan.config, targets: plan.config.targets.map(target => {
      const actual = finalTargets.get(target.targetId);
      if (!actual) throw workerError();
      return { ...target, applicantSalt: actual.applicantSalt, runtimeImmutables: actual.runtimeImmutables };
    }) };
    const body = { version: construction.version, route: "graph-v3" as const, chainId: plan.source.project.chainId,
      bindingHash: plan.bindingHash, projectHash: plan.source.project.hash, artifactHash: plan.source.compilation.artifactHash,
      productionId: plan.productionId, publicSourceId: plan.publicSourceId, identity: plan.identity,
      requestBody, requestSha256, receipt: completed.receipt, reproducibleConfig,
      runtimeMaterialization: completed.runtimeMaterialization,
      ...(construction.version >= 2 ? { constructorMaterialization: construction } : {}), launchReady: false as const };
    return { ...body, hash: canonicalBrowserSha256V2(`programmable.custom-ai-general-graph-pack.v${body.version}`, body) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
