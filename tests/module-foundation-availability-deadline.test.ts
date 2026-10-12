import { afterEach, expect, it, vi } from "vitest";
import { fetchFoundationAvailability } from "@/lib/module-foundation/availability";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([1, 4663] as const)("ends an unresponsive %i availability check even when its transport ignores abort", async chainId => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
  const pending = fetchFoundationAvailability(undefined, undefined, chainId);
  const rejected = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(signal.aborted).toBe(true);
});

it("cancels a previous network's availability immediately without waiting for its RPC", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const controller = new AbortController();
  const pending = fetchFoundationAvailability(controller.signal, undefined, 1);
  const rejected = expect(pending).rejects.toThrow("changed network");
  await Promise.resolve();
  controller.abort(new Error("changed network"));
  await rejected;
});
