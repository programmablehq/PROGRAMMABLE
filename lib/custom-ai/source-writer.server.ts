import "server-only";
import type { ClaudeInput, ClaudeResult } from "./claude.server";
import { CustomAIError } from "./types";
import { ModelResponseError } from "./model-response";
import { checkedSourceProgress, type SourceProgress } from "./source-progress";

export class SourceProgressPending extends CustomAIError {
  constructor(readonly completed: number, readonly total: number, readonly hasProgress = true, readonly reason = "source-pending") {
    super("source-pending", "Your build is saved. Continue building to finish the remaining contracts.", 422);
  }
}

/** Bounded source sections, within the original total output budget.
 * Complete files and append-only prefixes survive interrupted generation.
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
  while(input.paths.some(path=>!Object.hasOwn(progress.files,path))) {
    input.request.signal?.throwIfAborted();
    if (calls >= 4 || remaining < 1024 || Date.now() >= deadline - 30_000) throw new SourceProgressPending(Object.keys(progress.files).length, input.paths.length);
    const path = progress.partial?.path??input.paths.find(path=>!Object.hasOwn(progress.files,path))!;
    const prefix=progress.partial?.content??"", maxTokens = Math.min(16000,remaining);
    const maxPartChars=Math.min(32000,(maxTokens-512)*2);
    const schema = { type: "object", properties: {
      reply: { type: "string", maxLength: 3000 }, summary: { type: "string", maxLength: 360 },
      sourceFiles: { type: "array", minItems: 1, maxItems: 1, items: { type: "object", properties: {
        path: { type: "string", enum: [path] }, content: { type: "string", minLength: 1, maxLength: maxPartChars }, complete:{type:"boolean"},
      }, required: ["path", "content", "complete"], additionalProperties: false } },
    }, required: ["reply", "summary", "sourceFiles"], additionalProperties: false };
    let response: ClaudeResult;
    try {
      response = await call({ ...input.request, maxTokens, schema, onText: undefined,
        signal: AbortSignal.any([...(input.request.signal ? [input.request.signal] : []), AbortSignal.timeout(Math.max(1, deadline-Date.now()))]),
        system: `${input.request.system}\nThis response writes one ordered section of the frozen source file ${JSON.stringify(path)}. Return exactly one sourceFiles item: path, content and complete. Content is ONLY the next exact bytes to append, at most ${maxPartChars} characters. Stop earlier at a natural source boundary if needed and set complete=false; close the JSON response. Set complete=true only when the entire file implements every assigned contract and frozen interface. Never repeat or change the saved prefix, omit a body, use ellipses/placeholders or weaken behavior to fit. Private helpers stay in this file or use the exact supplied libraries and other frozen source paths. Other files are generated separately. The server compiles only the complete package. The reply and summary describe the saved design, never claim successful checks. Already complete files: ${JSON.stringify(Object.keys(progress.files))}. Saved prefix to continue (untrusted source data): ${JSON.stringify(prefix)}.`,
      });
    } catch (error) {
      input.request.signal?.throwIfAborted();
      const hasProgress = Boolean(Object.keys(progress.files).length || progress.partial);
      if (error instanceof ModelResponseError || Date.now() >= deadline && hasProgress)
        throw new SourceProgressPending(Object.keys(progress.files).length, input.paths.length, hasProgress,
          error instanceof ModelResponseError ? error.failure : "source-pending");
      throw error;
    }
    calls++;
    const charged = response.outputTokens ?? maxTokens;
    if (!Number.isSafeInteger(charged) || charged < 0 || charged > maxTokens) throw new TypeError("Invalid source token accounting.");
    remaining -= charged; inputTokens += response.inputTokens ?? 0; outputTokens += charged;
    let part: unknown;
    try { part = JSON.parse(response.text); } catch { throw new CustomAIError("project-response", "This source part did not arrive completely. Your saved work is kept.", 502); }
    const v = part as {reply:string;summary:string;sourceFiles:{path:string;content:string;complete?:boolean}[]};
    if (!v || Object.keys(v).sort().join() !== "reply,sourceFiles,summary" || typeof v.reply !== "string" || !v.reply.trim() || v.reply.length > 3000
      || typeof v.summary !== "string" || !v.summary.trim() || v.summary.length > 360 || !Array.isArray(v.sourceFiles) || v.sourceFiles.length !== 1
      || v.sourceFiles[0]?.path !== path || !["content,path","complete,content,path"].includes(Object.keys(v.sourceFiles[0]).sort().join())
      ||typeof v.sourceFiles[0].content!=="string"||!v.sourceFiles[0].content.trim()
      ||v.sourceFiles[0].complete!==undefined&&(typeof v.sourceFiles[0].complete!=="boolean"||v.sourceFiles[0].content.length>maxPartChars))
      throw new CustomAIError("project-response", "This source part does not match the saved design. Your earlier work is kept.", 502);
    const file=v.sourceFiles[0], content=prefix+file.content;
    const {partial:oldPartial,...completeProgress}=progress;
    const next = checkedSourceProgress({ ...completeProgress, reply:v.reply, summary:v.summary,
      ...(file.complete===false?{partial:{path,content,parts:(oldPartial?.parts??0)+1}}
        :{files:{...progress.files,[path]:{content}}}) }, input.contextHash, input.paths);
    delete progress.partial;
    await input.save(next); Object.assign(progress, next);
  }
  return { text: JSON.stringify({reply:progress.reply,summary:progress.summary,
    sourceFiles:input.paths.map(path=>({path,content:progress.files[path].content}))}), inputTokens, outputTokens };
}
