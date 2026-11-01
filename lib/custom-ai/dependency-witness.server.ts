import "server-only";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { toHex, type Address } from "viem";
import { canonicalBrowserSha256V2 } from "@/lib/custom-launch/browser-authority-v2";
import { agreedTradeRpcV1, tradeBlockV1, type TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import type { LaunchDependencyObservation } from "./dependency-observations.server";
import { checkNativeFeedObservation, createNativeFeedConstructorWitness } from "./dependency-witness";
import { CustomAIError } from "./types";
const unavailable = () => new CustomAIError("dependency-replay", "The native price feed could not be independently replayed from its observed state. Your source is saved.", 422);

/** One prestate read and one canonical-block comparison per provider. Only
 * the caller's fixed feed decimals selector is traced; provider instructions,
 * URLs and account balances are excluded from the sandbox payload. */
export async function replayNativeFeedConstructorRead(observation: LaunchDependencyObservation, caller: Address,
  dependencies: { rpcs: readonly [TradeRpcV1, TradeRpcV1]; now: () => number }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const snapshot = structuredClone(observation);
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(30_000)]);
  try {
    checkNativeFeedObservation(snapshot, caller, dependencies.now());
    if (dependencies.rpcs.length !== 2 || dependencies.rpcs[0] === dependencies.rpcs[1]) throw unavailable();
    const counts = [0, 0];
    const rpcs = dependencies.rpcs.map((rpc, index): TradeRpcV1 => async (method, params) => {
      deadline.throwIfAborted();
      if (++counts[index] > 2) throw unavailable();
      return new Promise((resolve, reject) => {
        const stopped = () => { deadline.removeEventListener("abort", stopped); reject(unavailable()); };
        deadline.addEventListener("abort", stopped, { once: true });
        if (deadline.aborted) { stopped(); return; }
        Promise.resolve().then(() => rpc(method, params)).then(value => {
          deadline.removeEventListener("abort", stopped); if (!deadline.aborted) resolve(value);
        }, error => { deadline.removeEventListener("abort", stopped); if (!deadline.aborted) reject(error); });
      });
    }) as [TradeRpcV1, TradeRpcV1];
    const traces = await Promise.all(rpcs.map(rpc => rpc("debug_traceCall", [
      { from: caller, to: snapshot.nativeUsdFeed.address, data: "0x313ce567", value: "0x0", gas: "0x1e8480" },
      toHex(BigInt(snapshot.block.number)), { tracer: "prestateTracer", timeout: "5s", tracerConfig: { diffMode: false } },
    ])));
    deadline.throwIfAborted();
    const witness = createNativeFeedConstructorWitness(snapshot, caller, traces[0], traces[1], dependencies.now());
    const toolchain = await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR ?? join(process.cwd(), "scripts/custom-ai/toolchain"));
    const worker = join(process.cwd(), "scripts/custom-ai/dependency-call-worker.mjs"), payload = JSON.stringify(witness);
    if (Buffer.byteLength(payload) > 400_000) throw unavailable();
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${toolchain}`, `--allow-fs-read=${worker}`, "--max-old-space-size=192", worker, toolchain],
        { env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 10_000, maxBuffer: 32_768, signal: deadline }, (error, stdout) => error ? reject(unavailable()) : resolve(stdout));
      child.stdin?.on("error", () => undefined); child.stdin?.end(payload);
    });
    deadline.throwIfAborted();
    const replay = JSON.parse(output) as { status: string; passes: number; gasUsed: string; output: string; failures: unknown[]; launchReady: boolean };
    if (replay.status !== "replayed" || replay.passes !== 2 || replay.launchReady !== false || !Array.isArray(replay.failures)
      || replay.failures.length || replay.output !== witness.expectedOutput || !/^[0-9]{1,7}$/u.test(replay.gasUsed)
      || BigInt(replay.gasUsed) > 4_000_000n) throw unavailable();
    const final = await agreedTradeRpcV1(rpcs)("eth_getBlockByNumber", [toHex(BigInt(snapshot.block.number)), false], tradeBlockV1);
    if (final.hash !== snapshot.block.hash || final.timestamp !== snapshot.block.timestamp || final.number !== snapshot.block.number) throw unavailable();
    checkNativeFeedObservation(snapshot, caller, dependencies.now());
    const result = { version: 1 as const, witness, replay: { status: "replayed" as const, passes: 2 as const,
      output: replay.output, gasUsed: replay.gasUsed }, launchReady: false as const };
    return { ...result, id: canonicalBrowserSha256V2("programmable.custom-ai-native-feed-constructor-read.v1", result) };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof CustomAIError && error.code === "dependency-replay") throw error;
    throw unavailable();
  }
}
