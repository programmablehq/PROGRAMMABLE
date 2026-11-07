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
