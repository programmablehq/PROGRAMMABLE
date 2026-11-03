import "server-only";
import type { ClaudeInput, ClaudeResult } from "./claude.server";
import { CustomAIError } from "./types";
import { ModelResponseError } from "./model-response";
import { checkedSourceProgress, type SourceProgress } from "./source-progress";

export class SourceProgressPending extends CustomAIError {
  constructor(readonly completed: number, readonly total: number) {
    super("source-pending", "Your build is saved. Continue building to finish the remaining contracts.", 422);
  }
}

/** One complete file per response, within the original total output budget.
 * Completed files are checkpointed; a continuation never regenerates them.
 * The frozen source-blind interfaces remain the authority for every part. */
export async function writeSourceParts(input: {
  request: ClaudeInput; paths: readonly string[]; contextHash: `sha256:${string}`;
  cached?: SourceProgress; save: (progress: SourceProgress) => Promise<void>;
}, call: (input: ClaudeInput) => Promise<ClaudeResult>): Promise<ClaudeResult> {
  if (!input.paths.length || input.paths.length > 16 || new Set(input.paths).size !== input.paths.length)
    throw new TypeError("Invalid frozen source files.");
  const progress: SourceProgress = input.cached
    ? checkedSourceProgress(input.cached, input.contextHash, input.paths)
    : { version: 1, contextHash: input.contextHash, files: {}, reply: "", summary: "" };
  let remaining = input.request.maxTokens, inputTokens = 0, outputTokens = 0, calls = 0;
  const deadline = Date.now() + 180_000;
  const todo = input.paths.filter(path => !Object.hasOwn(progress.files, path));
  for (let i = 0; i < todo.length; i++) {
    input.request.signal?.throwIfAborted();
    if (calls >= 4 || remaining < 1024 || Date.now() >= deadline - 30_000) throw new SourceProgressPending(Object.keys(progress.files).length, input.paths.length);
    // Files can differ greatly in size. A per-file equal split can truncate a
    // large hook even when its small companion would fit the total budget.
    // Charge actual output after each complete file and give the next file
    // the remaining allowance, without increasing the overall ceiling.
    const path = todo[i], maxTokens = remaining;
    const schema = { type: "object", properties: {
      reply: { type: "string", maxLength: 3000 }, summary: { type: "string", maxLength: 360 },
      sourceFiles: { type: "array", minItems: 1, maxItems: 1, items: { type: "object", properties: {
        path: { type: "string", enum: [path] }, content: { type: "string", minLength: 1, maxLength: 96_000 },
      }, required: ["path", "content"], additionalProperties: false } },
    }, required: ["reply", "summary", "sourceFiles"], additionalProperties: false };
    let response: ClaudeResult;
    try {
      response = await call({ ...input.request, maxTokens, schema, onText: undefined,
        signal: AbortSignal.any([...(input.request.signal ? [input.request.signal] : []), AbortSignal.timeout(Math.max(1, deadline-Date.now()))]),
        system: `${input.request.system}\nThis response writes only the complete frozen source file ${JSON.stringify(path)}. Return exactly one sourceFiles item at that path. Implement every contract assigned to this file by the fixed blueprint. Put private helpers in this same file, or import the exact supplied libraries and other frozen source paths. Do not create extra files, redeclare imported contracts, omit a body or use a placeholder. Other files are generated separately from the same frozen interfaces. The reply and summary describe the complete saved design, not only this file. Already saved files: ${JSON.stringify(Object.keys(progress.files))}. Keep the JSON complete within this response budget.`,
      });
    } catch (error) {
      input.request.signal?.throwIfAborted();
      if ((Date.now() >= deadline || error instanceof ModelResponseError) && Object.keys(progress.files).length)
        throw new SourceProgressPending(Object.keys(progress.files).length, input.paths.length);
      throw error;
    }
    calls++;
    const charged = response.outputTokens ?? maxTokens;
    if (!Number.isSafeInteger(charged) || charged < 0 || charged > maxTokens) throw new TypeError("Invalid source token accounting.");
    remaining -= charged; inputTokens += response.inputTokens ?? 0; outputTokens += charged;
    let part: unknown;
    try { part = JSON.parse(response.text); } catch { throw new CustomAIError("project-response", "This source part did not arrive completely. Your saved work is kept.", 502); }
    const v = part as {reply:string;summary:string;sourceFiles:{path:string;content:string}[]};
    if (!v || Object.keys(v).sort().join() !== "reply,sourceFiles,summary" || typeof v.reply !== "string" || !v.reply.trim() || v.reply.length > 3000
      || typeof v.summary !== "string" || !v.summary.trim() || v.summary.length > 360 || !Array.isArray(v.sourceFiles) || v.sourceFiles.length !== 1
      || v.sourceFiles[0]?.path !== path || Object.keys(v.sourceFiles[0]).sort().join() !== "content,path")
      throw new CustomAIError("project-response", "This source part does not match the saved design. Your earlier work is kept.", 502);
    const next = checkedSourceProgress({ ...progress, reply:v.reply, summary:v.summary,
      files: { ...progress.files, [path]: {content:v.sourceFiles[0].content} } }, input.contextHash, input.paths);
    await input.save(next); Object.assign(progress, next);
  }
  return { text: JSON.stringify({reply:progress.reply,summary:progress.summary,
    sourceFiles:input.paths.map(path=>({path,content:progress.files[path].content}))}), inputTokens, outputTokens };
}
