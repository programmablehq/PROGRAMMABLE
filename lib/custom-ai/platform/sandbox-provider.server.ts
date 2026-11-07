import "server-only";
import { Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";
import type { SandboxInstance, SandboxOutput, SandboxProvider } from "./sandbox-executor.server";
import { projectFileBytes, projectFilePath } from "./files";

function credentials() {
  const token = process.env.PROJECT_SANDBOX_VERCEL_TOKEN, teamId = process.env.PROJECT_SANDBOX_TEAM_ID, projectId = process.env.PROJECT_SANDBOX_PROJECT_ID;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}
const absent = (error: unknown) => typeof error === "object" && error !== null && ("status" in error && error.status === 404 || "statusCode" in error && error.statusCode === 404);
async function destroy(box: Sandbox) {
  await box.stop({ signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
  try { await box.delete({ signal: AbortSignal.timeout(15_000) }); } catch (error) { if (!absent(error)) throw error; }
}
function collector() {
  const chunks: Buffer[] = []; let size = 0, truncated = false;
  return { stream: new Writable({ write(chunk, _encoding, callback) {
    const bytes = Buffer.from(chunk); const remaining = 48_000 - size;
    if (remaining > 0) { chunks.push(bytes.subarray(0, remaining)); size += Math.min(remaining, bytes.length); }
    if (bytes.length > remaining) truncated = true;
    callback();
  } }), text: () => Buffer.concat(chunks).toString("utf8"), truncated: () => truncated };
}

export const vercelSandboxProvider: SandboxProvider = {
  async create(input, signal) {
    const box = await Sandbox.create({ ...credentials(), name: input.name, runtime: "node24", persistent: false,
      region: "fra1", timeout: input.timeoutMs, resources: { vcpus: input.vcpus }, networkPolicy: input.network, env: { CI: "true" }, signal });
    const run = async (cmd: string, args: string[], timeout: number, signal: AbortSignal): Promise<SandboxOutput> => {
      const stdout = collector(), stderr = collector();
      const result = await box.runCommand({ cmd, args, cwd: "/vercel/sandbox", env: { CI: "true" }, timeoutMs: timeout, signal, stdout: stdout.stream, stderr: stderr.stream });
      return { exitCode: result.exitCode, stdout: stdout.text(), stderr: stderr.text(), truncated: stdout.truncated() || stderr.truncated() };
    };
    const instance: SandboxInstance = {
      writeFiles: async (files, signal) => { await box.writeFiles(Object.entries(files).map(([path, file]) => ({ path: `/vercel/sandbox/${projectFilePath(path)}`, content: projectFileBytes(file) })), { signal }); },
      install: async (resolve, signal) => {
        await box.update({ networkPolicy: { allow: ["registry.npmjs.org"] } }, { signal });
        try { return await run("npm", resolve ? ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"] : ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], 120_000, signal); }
        finally { await box.update({ networkPolicy: "deny-all" }, { signal: AbortSignal.timeout(15_000) }); }
      },
      execute: (script, signal) => run("bash", ["-c", script], 90_000, signal),
      readFile: async (path, signal) => {
        const stream = await box.readFile({ path: `/vercel/sandbox/${projectFilePath(path)}` }, { signal });
        if (!stream) return null;
        const chunks: Buffer[] = []; let size = 0;
        try {
          for await (const chunk of stream as AsyncIterable<Uint8Array>) {
            size += chunk.byteLength;
            if (size > 512_000) throw new Error("Artifact exceeds limit");
            chunks.push(Buffer.from(chunk));
          }
          return Buffer.concat(chunks);
        } finally { if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy(); }
      },
      close: () => destroy(box),
    };
    return instance;
  },
  async cleanup(name) {
    try { await destroy(await Sandbox.get({ ...credentials(), name, signal: AbortSignal.timeout(15_000) })); }
    catch (error) { if (!absent(error)) throw error; }
  },
};
