import "server-only";
import { execFile } from "node:child_process";
import { artifactHash } from "../../scripts/custom-ai/artifact-hash.mjs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDraft } from "./compiler.server";
import { CustomAIError, type Draft, type FeeExpectation, type LifecycleCheck } from "./types";

export async function compileLaunchDraft(source: string, signal?: AbortSignal, expectations: FeeExpectation[] = [], feed?: import("./feed").FeedBinding, composable?: import("./rule-compiler.server").BoundRuleSpec): Promise<Draft> {
  const draft = await compileDraft(source, signal, expectations, feed, composable);
  if (!draft.compiled || draft.validation?.status !== "passed") return draft;
  const lifecycle = await checkLifecycle(draft, signal);
  return { ...draft, lifecycle, diagnostics: lifecycle.diagnostics,
    validation: { ...draft.validation, status: lifecycle.status },
    artifact: lifecycle.status === "passed" ? draft.artifact : undefined };
}

export async function checkLifecycle(draft: Draft, signal?: AbortSignal): Promise<LifecycleCheck> {
  if (!draft.compiled || !draft.artifact || draft.validation?.status !== "passed"
    || artifactHash(draft.artifact) !== draft.validation.artifactHash) {
    throw new CustomAIError("module", "Use the exact checked fee module.", 422);
  }
  // The sandbox toolchain is included explicitly in next.config.ts.
  const compiler = await realpath(/* turbopackIgnore: true */ process.env.CUSTOM_AI_COMPILER_DIR ?? join(process.cwd(), "scripts/custom-ai/toolchain"));
  const directory = join(process.cwd(), "scripts/custom-ai");
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, ["--permission", `--allow-fs-read=${compiler}`, `--allow-fs-read=${directory}`,
      "--max-old-space-size=384", join(directory, "lifecycle-worker.mjs"), compiler],
      { cwd: tmpdir(), env: { NODE_ENV: "production" }, encoding: "utf8", timeout: 45_000, maxBuffer: 200_000, signal },
      (error, stdout) => error ? reject(new CustomAIError("lifecycle", "The launch simulation did not finish. Try again shortly.", 503)) : resolve(stdout));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(JSON.stringify({ artifact: draft.artifact, feed: draft.feed, composable: draft.composable }));
  });
  return JSON.parse(output) as LifecycleCheck;
}
