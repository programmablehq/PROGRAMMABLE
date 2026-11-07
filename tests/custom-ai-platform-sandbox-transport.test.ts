import { createServer, type Server } from "node:http";
import { Agent } from "undici";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/sandbox", () => ({ Sandbox: sdk }));
import { vercelSandboxProvider } from "../lib/custom-ai/platform/sandbox-provider.server";

let server: Server, dispatcher: Agent, url: string;
beforeEach(async () => {
  server = createServer((_request, response) => response.end("sandbox transport reached"));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test HTTP listener");
  url = `http://127.0.0.1:${address.port}`;
  dispatcher = new Agent({ bodyTimeout: 0 });
});
afterEach(async () => {
  await dispatcher.close();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.clearAllMocks();
});

it("creates and recovers sandboxes with the repository's HTTP dispatcher on Node 24", async () => {
  const stop = vi.fn(async () => undefined), remove = vi.fn(async () => undefined);
  const connect = async (options: { fetch?: typeof fetch; signal: AbortSignal }) => {
    // The SDK supplies its own Agent. Exercise a real request with the pinned
    // dispatcher instead of accepting a mock successful Sandbox.create result.
    const response = await (options.fetch ?? fetch)(url, { dispatcher, signal: options.signal } as RequestInit);
    expect(await response.text()).toBe("sandbox transport reached");
    return { stop, delete: remove };
  };
  sdk.create.mockImplementation(connect);
  sdk.get.mockImplementation(connect);

  const box = await vercelSandboxProvider.create({ name: "transport-test", timeoutMs: 240_000, vcpus: 1, network: "deny-all" }, AbortSignal.timeout(5_000));
  await box.close();
  await vercelSandboxProvider.cleanup("transport-test");
  expect(stop).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(2);
});

it("preserves imported executable modes and binary bytes without accepting special permissions", async () => {
  const writeFiles = vi.fn(async () => undefined);
  sdk.create.mockResolvedValueOnce({ writeFiles });
  const box = await vercelSandboxProvider.create({ name: "file-modes-test", timeoutMs: 240_000, vcpus: 1, network: "deny-all" }, AbortSignal.timeout(5_000));
  const signal = AbortSignal.timeout(5_000);
  const bytes = Buffer.from([0, 128, 255, 10]);
  await box.writeFiles({
    "bin/reference.sh": "#!/bin/sh\nprintf 'ok\\n'\n",
    "assets/pixel.bin": { encoding: "base64", content: bytes.toString("base64"), mediaType: "application/octet-stream" },
    "special.sh": "#!/bin/sh\nexit 0\n",
    "plain.txt": "unchanged",
  }, signal, {
    "bin/reference.sh": "100755", "assets/pixel.bin": "100644", "special.sh": "104755", "missing.sh": "100755",
  });
  expect(writeFiles).toHaveBeenCalledExactlyOnceWith([
    { path: "/vercel/sandbox/bin/reference.sh", content: Buffer.from("#!/bin/sh\nprintf 'ok\\n'\n"), mode: 0o755 },
    { path: "/vercel/sandbox/assets/pixel.bin", content: bytes, mode: 0o644 },
    { path: "/vercel/sandbox/special.sh", content: Buffer.from("#!/bin/sh\nexit 0\n"), mode: 0o644 },
    { path: "/vercel/sandbox/plain.txt", content: Buffer.from("unchanged"), mode: 0o644 },
  ], { signal });
});

it("accepts the SDK response status when an already removed sandbox returns 404",async()=>{
  sdk.get.mockRejectedValueOnce(Object.assign(new Error("Not found"),{response:new Response(null,{status:404})}));
  await expect(vercelSandboxProvider.cleanup("already-removed")).resolves.toBeUndefined();
});

it("accepts a 404 deletion after a successful sandbox lookup",async()=>{
  const stop=vi.fn(async()=>undefined),remove=vi.fn(async()=>{throw Object.assign(new Error("Not found"),{response:new Response(null,{status:404})});});
  sdk.get.mockResolvedValueOnce({stop,delete:remove});
  await expect(vercelSandboxProvider.cleanup("removed-during-cleanup")).resolves.toBeUndefined();
  expect(stop).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledOnce();
});

it.each([401,403,429,500])("preserves SDK HTTP%d as an unconfirmed cleanup",async status=>{
  const error=Object.assign(new Error("Unconfirmed"),{response:new Response(null,{status})});
  sdk.get.mockRejectedValueOnce(error);
  await expect(vercelSandboxProvider.cleanup("not-confirmed")).rejects.toBe(error);
});
