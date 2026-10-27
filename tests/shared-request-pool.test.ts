import { afterEach, describe, expect, it, vi } from "vitest";
import { createSharedRequestPool } from "@/lib/shared-request-pool";

afterEach(() => vi.useRealTimers());

describe("shared browser reads", () => {
  it("joins a prefetch and foreground read without cancelling either observer", async () => {
    const acquire = createSharedRequestPool<number>(15_000);
    const result = Promise.withResolvers<number>();
    let signal!: AbortSignal;
    const read = vi.fn((input: AbortSignal) => { signal = input; return result.promise; });
    const prefetch = acquire("page:2", read);
    const foreground = acquire("page:2", read);
    await Promise.resolve();
    prefetch.release();
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    result.resolve(2);
    expect(await foreground.promise).toBe(2);
    foreground.release();
  });

  it("lets a same-turn replacement observer join before aborting", async () => {
    const acquire = createSharedRequestPool<number>(15_000);
    const result = Promise.withResolvers<number>();
    let signal!: AbortSignal;
    const read = vi.fn((input: AbortSignal) => { signal = input; return result.promise; });
    const previous = acquire("page:2", read);
    await Promise.resolve();
    previous.release();
    const current = acquire("page:2", read);
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    result.resolve(2);
    expect(await current.promise).toBe(2);
    expect(read).toHaveBeenCalledTimes(1);
    current.release();
  });

  it("aborts abandoned reads and isolates different chains", async () => {
    const acquire = createSharedRequestPool<number>(15_000);
    const signals = new Map<string, AbortSignal>();
    const read = (key: string) => (signal: AbortSignal) => new Promise<number>((_, reject) => {
      signals.set(key, signal);
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const eth = acquire("ethereum", read("ethereum"));
    const base = acquire("base", read("base"));
    const ethFailed = expect(eth.promise).rejects.toThrow("aborted");
    const baseFailed = expect(base.promise).rejects.toThrow("aborted");
    await Promise.resolve();
    eth.release(); eth.release();
    await Promise.resolve();
    expect(signals.get("ethereum")?.aborted).toBe(true);
    expect(signals.get("base")?.aborted).toBe(false);
    base.release();
    await Promise.all([ethFailed, baseFailed]);
  });

  it("does not cache failed or completed reads", async () => {
    const acquire = createSharedRequestPool<number>(15_000);
    const read = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(2);
    const first = acquire("page:2", read);
    await expect(first.promise).rejects.toThrow("unavailable");
    first.release();
    const second = acquire("page:2", read);
    expect(await second.promise).toBe(2);
    second.release();
    const third = acquire("page:2", read);
    expect(await third.promise).toBe(2);
    third.release();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("times out a stuck read once", async () => {
    vi.useFakeTimers();
    const acquire = createSharedRequestPool<number>(1_000);
    const request = acquire("stuck", signal => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }));
    const failed = expect(request.promise).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(1_000);
    await failed;
    request.release();
  });
});
