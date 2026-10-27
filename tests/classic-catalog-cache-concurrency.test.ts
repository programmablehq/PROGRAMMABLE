import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: <T>(read: T) => read }));

import { readClassicCatalogGroups } from "../lib/market-data/classic-launch-catalog.server";

afterEach(() => vi.useRealTimers());

describe("Classic catalog cache reads", () => {
  it("reads a full catalog within bounded cache waves without losing or reordering groups", async () => {
    vi.useFakeTimers();
    const groups = Array.from({ length: 67 }, (_, index) => index);
    let active = 0;
    let peak = 0;
    const reads: number[] = [];
    const pending = readClassicCatalogGroups(groups, async group => {
      reads.push(group);
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, group % 8 === 0 ? 100 : 10));
      active--;
      return [group * 2, group * 2 + 1];
    });
    let finished = false;
    void pending.then(() => { finished = true; });

    await vi.advanceTimersByTimeAsync(899);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual(Array.from({ length: 134 }, (_, index) => index));
    expect(reads).toEqual(groups);
    expect(peak).toBe(8);
    expect(active).toBe(0);
  });

  it("propagates a failed group without starting the remaining catalog", async () => {
    const read = vi.fn(async (group: number) => {
      if (group === 2) throw new Error("Unverified group");
      return [group];
    });

    await expect(readClassicCatalogGroups(Array.from({ length: 20 }, (_, index) => index), read))
      .rejects.toThrow("Unverified group");
    expect(read.mock.calls.map(([group]) => group)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
