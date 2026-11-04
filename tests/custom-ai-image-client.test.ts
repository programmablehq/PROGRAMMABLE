import { afterEach, expect, it, vi } from "vitest";
import { aiImageRequest } from "../lib/custom-ai/client";

const headers = async () => ({ Authorization: "synthetic-test-session" });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(["credentials", "upload", "response"])("releases a stalled image %s after one bounded attempt", async stage => {
  vi.useFakeTimers();
  const pending = () => new Promise<never>(() => {});
  const fetch = vi.fn(stage === "upload" ? pending : async () => ({ ok: true, json: pending }));
  vi.stubGlobal("fetch", fetch);
  const result = expect(aiImageRequest({ url: "https://example.com/coin.png" }, stage === "credentials" ? pending : headers))
    .rejects.toMatchObject({ status: 408, code: "timeout" });
  await vi.advanceTimersByTimeAsync(30_000); await result;
  expect(fetch).toHaveBeenCalledTimes(stage === "credentials" ? 0 : 1);
});

it("cancels immediately and never uploads after late credentials arrive", async () => {
  const controller = new AbortController();
  let finish!: (value: Record<string, string>) => void;
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const result = expect(aiImageRequest(new Blob(["image"], { type: "image/webp" }),
    () => new Promise(resolve => { finish = resolve; }), controller.signal)).rejects.toThrow();
  controller.abort(); await result; finish(await headers()); await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});

it("sends the existing image and link formats once and returns their receipt", async () => {
  const receipt = { id: "a".repeat(64), hash: "b".repeat(64), url: "https://example.com/saved.webp" };
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => Response.json(receipt)); vi.stubGlobal("fetch", fetch);
  const blob = new Blob(["image"], { type: "image/webp" });
  expect(await aiImageRequest(blob, headers)).toEqual(receipt);
  expect(await aiImageRequest({ url: "https://example.com/coin.png" }, headers)).toEqual(receipt);
  expect(fetch.mock.calls).toHaveLength(2);
  expect(fetch.mock.calls[0]).toEqual(["/api/custom-ai/image", expect.objectContaining({ body: blob,
    headers: { Authorization: "synthetic-test-session", "Content-Type": "image/webp" } })]);
  expect(fetch.mock.calls[1]).toEqual(["/api/custom-ai/image", expect.objectContaining({ body: '{"url":"https://example.com/coin.png"}',
    headers: { Authorization: "synthetic-test-session", "Content-Type": "application/json" } })]);
});
