import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRequest } from "../lib/custom-ai/client";
import { loadStudio, restoreStudio, saveStudio, studioBase, studioSnapshot, StudioConflictError } from "../lib/custom-ai/studio-sync";
import { EMPTY_COIN_SETUP } from "../lib/custom-ai/coin-setup";
import type { StudioState } from "../lib/custom-ai/studio";

const original: StudioState = { settings: { ...EMPTY_COIN_SETUP, name: "Original" }, messages: [] };
const changed: StudioState = { settings: { ...EMPTY_COIN_SETUP, name: "Saved coin" }, messages: [{ role: "user", content: "Build my coin" }] };
const server = { revision: 1, state: original };
const response = (body: unknown, status = 200, retryAfter?: string) => Response.json(body, {
  status, headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
});
const headers = async () => ({ Authorization: "synthetic-test-session" });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("online draft recovery", () => {
  it("waits out a credential rate limit before reconciling and saving", async () => {
    vi.useFakeTimers();
    const credentials = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { status: 429 })).mockImplementation(headers);
    const fetch = vi.fn().mockResolvedValueOnce(response(server)).mockResolvedValueOnce(response({ revision: 2 }));
    vi.stubGlobal("fetch", fetch);
    const onRetry = vi.fn();
    const saved = saveStudio({ account: "test", headers: credentials, state: changed, base: studioBase(server), signal: new AbortController().signal, onRetry });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await saved).toEqual({ revision: 2, snapshot: studioSnapshot(changed) });
    expect(onRetry).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([, request]) => request.method)).toEqual(["GET", "POST"]);
  });

  it("honors Retry-After and stops after a bounded number of retries", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => Promise.resolve(response({ error: "Busy" }, 429, "60")));
    vi.stubGlobal("fetch", fetch);
    const failed = expect(loadStudio("test", headers, new AbortController().signal)).rejects.toThrow("Busy");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(120_001);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("reconciles a successful write with a lost response instead of replaying it", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ revision: 2, state: changed }));
    vi.stubGlobal("fetch", fetch);
    const result = saveStudio({ account: "test", headers, state: changed, base: studioBase(server), signal: new AbortController().signal, onRetry: () => {} });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ revision: 2, snapshot: studioSnapshot(changed) });
    expect(fetch.mock.calls.map(([, request]) => request.method)).toEqual(["POST", "GET"]);
  });

  it("keeps another tab's version when a write conflicts", async () => {
    vi.useFakeTimers();
    const other = { revision: 2, state: { ...original, settings: { ...original.settings, name: "Other tab" } } };
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: "Changed" }, 409)).mockResolvedValueOnce(response(other));
    vi.stubGlobal("fetch", fetch);
    const failed = expect(saveStudio({ account: "test", headers, state: changed, base: studioBase(server), signal: new AbortController().signal, onRetry: () => {} }))
      .rejects.toBeInstanceOf(StudioConflictError);
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rejected wallet or invalid draft", async () => {
    for (const status of [400, 401, 403]) {
      const fetch = vi.fn().mockResolvedValue(response({ error: "Rejected" }, status));
      vi.stubGlobal("fetch", fetch);
      await expect(saveStudio({ account: "test", headers, state: changed, base: studioBase(server), signal: new AbortController().signal, onRetry: () => {} })).rejects.toThrow("Rejected");
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it("does not dispatch after the account was unmounted while credentials were loading", async () => {
    const controller = new AbortController();
    let finish!: (value: Record<string, string>) => void;
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = aiRequest("/studio", () => new Promise(resolve => { finish = resolve; }), {}, controller.signal);
    controller.abort(); finish({ Authorization: "obsolete" });
    await expect(result).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels retries on unmount", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn().mockRejectedValue(new TypeError("Offline")); vi.stubGlobal("fetch", fetch);
    const result = expect(loadStudio("test", headers, controller.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1); controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("restoring local changes", () => {
  it("preserves unsaved changes after reload when the online version is unchanged", () => {
    expect(restoreStudio(changed, studioBase(server), server)).toMatchObject({ keepLocal: true, conflict: false });
    expect(restoreStudio(changed, undefined, null)).toMatchObject({ keepLocal: true, conflict: false });
  });
  it("does not overwrite either draft when another tab changed it", () => {
    expect(restoreStudio(changed, studioBase(server), { revision: 2, state: original })).toMatchObject({ keepLocal: true, conflict: true });
    expect(restoreStudio(changed, undefined, server)).toMatchObject({ keepLocal: true, conflict: true });
  });
  it("uses the online version when the local copy has no unsaved changes", () => {
    expect(restoreStudio(original, studioBase(server), { revision: 2, state: changed })).toMatchObject({ keepLocal: false, conflict: false });
    expect(restoreStudio(changed, undefined, { revision: 2, state: changed })).toMatchObject({ keepLocal: false, conflict: false });
  });
});

it("upgrades the original snapshot without a false conflict while keeping unsent input",()=>{
  const previous={revision:server.revision,snapshot:JSON.stringify(JSON.parse(studioSnapshot(original)).slice(0,10))};
  const local={...original,input:"Keep this unsent idea"};
  expect(restoreStudio(local,previous,server)).toMatchObject({keepLocal:true,conflict:false});
  expect(restoreStudio(local,previous,{...server,revision:2})).toMatchObject({keepLocal:true,conflict:true});
});
