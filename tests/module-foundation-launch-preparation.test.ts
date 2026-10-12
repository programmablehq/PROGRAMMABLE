import { afterEach, describe, expect, it, vi } from "vitest";
import { FoundationLaunchPreparation } from "@/lib/module-foundation/launch-preparation";
import { FOUNDATION_DEFAULT_IMAGE } from "@/lib/module-foundation/default-image";
import { FOUNDATION_PLATFORM_FEE_RECIPIENT, type FoundationLaunchDraft, type FoundationLaunchReview } from "@/lib/module-foundation/ui-types";

const draft: FoundationLaunchDraft = { name: "My coin", symbol: "COIN", description: "", image: FOUNDATION_DEFAULT_IMAGE,
  socialLinks: {}, quoteAsset: "0x1000000000000000000000000000000000000000", creatorFeeBps: 0,
  initialBuy: "0.001", additionalLiquidity: "0", modules: [] };
const context = "account:4663:release";
const review = () => ({ contextKey: context, expiresAt: Math.floor(Date.now() / 1000) + 120,
  platformFeeBps: 30, platformFeeRecipient: FOUNDATION_PLATFORM_FEE_RECIPIENT } as FoundationLaunchReview);
afterEach(() => vi.useRealTimers());

describe("exact launch preparation while editing", () => {
  it("releases a stalled background preparation and rejects its late result", async () => {
    vi.useFakeTimers();
    const cache = new FoundationLaunchPreparation();
    let finish!: (value: FoundationLaunchReview) => void;
    let signal!: AbortSignal;
    const stalled = cache.prepare(draft, context, (_draft, current) => {
      signal = current;
      return new Promise(resolve => { finish = resolve; });
    });
    const rejected = expect(stalled).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(90_000);
    await rejected;
    expect(signal.aborted).toBe(true);
    const next = review();
    expect(await cache.prepare(draft, context, async () => next)).toBe(next);
    finish({ ...review(), expiresAt: 0 });
    await Promise.resolve();
    expect(await cache.prepare(draft, context, vi.fn())).toBe(next);
  });

  it("joins pending work and reuses its successful result for the same click", async () => {
    const cache = new FoundationLaunchPreparation();
    let finish!: (value: FoundationLaunchReview) => void;
    const prepare = vi.fn(() => new Promise<FoundationLaunchReview>(resolve => { finish = resolve; }));
    const background = cache.prepare(draft, context, prepare);
    const clicked = cache.prepare(structuredClone(draft), context, prepare);
    expect(clicked).toBe(background);
    await Promise.resolve();
    const ready = review(); finish(ready);
    expect(await clicked).toBe(ready);
    expect(await cache.prepare(draft, context, prepare)).toBe(ready);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it.each(["name", "symbol", "description", "initialBuy", "creatorFeeBps", "socialLinks", "modules", "image", "quoteAsset"] as const)("invalidates an older %s and aborts its delayed result", async field => {
    const cache = new FoundationLaunchPreparation();
    let finish!: (value: FoundationLaunchReview) => void;
    let signal!: AbortSignal;
    const slow = vi.fn((_draft, currentSignal: AbortSignal) => { signal = currentSignal; return new Promise<FoundationLaunchReview>(resolve => { finish = resolve; }); });
    const pending = cache.prepare(draft, context, slow);
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    const changes = { name: "Other coin", symbol: "OTHER", description: "Changed", initialBuy: "1", creatorFeeBps: 100,
      socialLinks: { website: "https://programmable.market" }, modules: [{ id: "other", configuration: {} }],
      image: { ...FOUNDATION_DEFAULT_IMAGE, sha256: `0x${"aa".repeat(32)}` }, quoteAsset: "0x2000000000000000000000000000000000000000" };
    const changed = { ...draft, [field]: changes[field] } as FoundationLaunchDraft;
    const fresh = vi.fn(async () => review());
    await cache.prepare(changed, context, fresh);
    expect(signal.aborted).toBe(true);
    finish(review()); await rejected;
    expect(await cache.prepare(changed, context, fresh)).toBeDefined();
    expect(fresh).toHaveBeenCalledOnce();
  });

  it("binds the wallet, network and source context, rather than just the form", async () => {
    const cache = new FoundationLaunchPreparation(), prepare = vi.fn(async () => review());
    await cache.prepare(draft, context, prepare);
    for (const nextContext of ["new-account:4663:release", "account:1:release", "account:4663:new-release"]) {
      const next = vi.fn(async () => ({ ...review(), contextKey: nextContext }));
      await cache.prepare(draft, nextContext, next);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("never accepts an expired result and retries failed reads only when requested", async () => {
    vi.useFakeTimers();
    const cache = new FoundationLaunchPreparation(), prepare = vi.fn(async () => review());
    await cache.prepare(draft, context, prepare);
    // Reprepare before expiry, leaving time for the fresh wallet checks to finish.
    vi.advanceTimersByTime(106_000);
    await cache.prepare(draft, context, prepare);
    expect(prepare).toHaveBeenCalledTimes(2);
    cache.invalidate();
    const failure = vi.fn(async () => { throw new Error("Unavailable"); });
    await expect(cache.prepare(draft, context, failure)).rejects.toThrow("Unavailable");
    expect(failure).toHaveBeenCalledOnce();
    await cache.prepare(draft, context, prepare);
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it("snapshots the draft and stops unmounted work before invoking a preparer", async () => {
    const cache = new FoundationLaunchPreparation(), input = structuredClone(draft);
    const prepare = vi.fn(async (value: FoundationLaunchDraft) => { expect(value.name).toBe(draft.name); return review(); });
    const result = cache.prepare(input, context, prepare);
    input.name = "Mutated";
    await result;
    cache.invalidate();
    const notStarted = cache.prepare(draft, context, prepare);
    const rejected = expect(notStarted).rejects.toThrow();
    cache.invalidate(); await rejected;
    expect(prepare).toHaveBeenCalledOnce();
  });
});
