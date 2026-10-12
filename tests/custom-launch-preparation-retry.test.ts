import { describe, it, expect, vi } from "vitest";
import { preparationRetryDelayV1, waitForPreparationRetryV1 } from "../lib/custom-launch/preparation-retry-v1";

describe("owner preparation retry", () => {
  it("honors upstream delays and bounds attempts", () => {
    expect(preparationRetryDelayV1(503, "40", 1)).toBe(40000);
    expect(preparationRetryDelayV1(429, "Tue, 13 Oct 2026 01:00:00 GMT", 1, Date.parse("2026-10-13T00:59:00Z"))).toBe(60000);
    expect(preparationRetryDelayV1(502, null, 2)).toBe(6000);
    expect(preparationRetryDelayV1(503, null, 3)).toBeNull();
    expect(preparationRetryDelayV1(503, "999999999999", 1)).toBeNull();
    for (const status of [400, 401, 403, 404, 409]) expect(preparationRetryDelayV1(status, null, 1)).toBeNull();
  });
  it("cancels a scheduled retry when the owner or launch changes", async () => {
    vi.useFakeTimers();
    try {
      const abort = new AbortController();
      const pending = waitForPreparationRetryV1(10000, abort.signal);
      const rejected = expect(pending).rejects.toThrow();
      abort.abort(); await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
