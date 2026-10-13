import { afterEach, expect, it, vi } from "vitest";
import { withTokenImageUploadDeadline } from "@/lib/token-image-upload";
import { readTokenImageUploadResponse } from "@/lib/token-image";

afterEach(() => vi.useRealTimers());

it("bounds a stalled response body and aborts its transport", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const pending = withTokenImageUploadDeadline(async current => {
    signal = current;
    return readTokenImageUploadResponse(new Response(new ReadableStream(), { headers: { "content-type": "application/json" } }));
  });
  const rejected = expect(pending).rejects.toThrow("image upload timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves cancellation and never starts an already cancelled request", async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const reason = new Error("Image replaced");
  parent.abort(reason);
  const upload = vi.fn();
  await expect(withTokenImageUploadDeadline(upload, parent.signal)).rejects.toBe(reason);
  expect(upload).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("returns successful results and clears the deadline", async () => {
  vi.useFakeTimers();
  await expect(withTokenImageUploadDeadline(async () => "saved")).resolves.toBe("saved");
  expect(vi.getTimerCount()).toBe(0);
});
