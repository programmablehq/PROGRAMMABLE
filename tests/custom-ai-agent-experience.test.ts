import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRequest, resumeAIChat, sendAIChat } from "../lib/custom-ai/client";
import { createAIReplyController } from "../lib/custom-ai/reply-controller";
import { passiveRefresh } from "../lib/custom-ai/passive-refresh";
import { CHAT_MESSAGE_LIMIT, pastedMessageFits, workspaceState } from "../lib/custom-ai/workspace-state";
import { readServerEvents } from "../lib/custom-ai/events";

const input = { id: "agent-experience-0001", intent: "chat" as const, messages: [{ role: "user" as const, content: "Build my coin" }] };
const saved = () => Response.json({ id: input.id, request: input, state: "completed", result: { reply: "Saved result" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("bounded browser requests", () => {
  it("ends an unresponsive credential lookup without dispatching later", async () => {
    vi.useFakeTimers();
    let release!: (value: Record<string, string>) => void;
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = aiRequest("/studio", () => new Promise(resolve => { release = resolve; })).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ status: 408, code: "timeout" });
    release({ Authorization: "synthetic-test-only" }); await Promise.resolve(); await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds an unfinished response body and cancels the transport", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"draft":')); } }));
    }));
    const result = aiRequest("/studio", async () => ({})).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ status: 408 }); expect(signal.aborted).toBe(true);
  });
  it("keeps a valid empty studio distinct from unreadable JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(null)).mockResolvedValueOnce(new Response("<html>error</html>")));
    expect(await aiRequest("/studio", async () => ({}))).toBeNull();
    await expect(aiRequest("/studio", async () => ({}))).rejects.toMatchObject({ status: 502, code: "response" });
  });
  it.each([429, 503])("explains HTTP %i even when the proxy returns HTML", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>unavailable</html>", { status, headers: { "Retry-After": "7" } })));
    await expect(aiRequest("/conversations", async () => ({}))).rejects.toMatchObject({ status, retryAfterMs: 7_000 });
  });
  it("respects a Retry-After date without extending a request indefinitely", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00:00Z")); const when = new Date(Date.now() + 20_000).toUTCString();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Wait" }, { status: 429, headers: { "Retry-After": when } })));
    await expect(aiRequest("/usage", async () => ({}))).rejects.toMatchObject({ status: 429, retryAfterMs: 20_000 });
  });
  it("aborts promptly when the user leaves, including a hung credential call", async () => {
    const controller = new AbortController(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = aiRequest("/studio", () => new Promise(() => undefined), undefined, controller.signal).catch(error => error);
    controller.abort(); expect(await result).toMatchObject({ name: "AbortError" }); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("one paid attempt under interruptions", () => {
  it("checks the same saved request after response headers stop arriving", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockImplementationOnce(saved);
    vi.stubGlobal("fetch", fetcher);
    const result = sendAIChat(input, async () => ({}), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toEqual({ reply: "Saved result" });
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
    expect(fetcher.mock.calls[1][0]).toContain(input.id);
  });
  it("checks the saved result when a live stream goes silent", async () => {
    vi.useFakeTimers(); const cancelled = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"phase","phase":"building"}\n\n')); }, cancel: cancelled });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(stream, { headers: { "Content-Type": "text/event-stream" } })).mockImplementationOnce(saved);
    vi.stubGlobal("fetch", fetcher);
    const result = sendAIChat(input, async () => ({}), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await result).toEqual({ reply: "Saved result" }); expect(cancelled).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
  });
  it("recovers an unreadable success payload without submitting another generation", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(null)).mockImplementationOnce(saved);
    vi.stubGlobal("fetch", fetcher);
    expect(await sendAIChat(input, async () => ({}), new AbortController().signal)).toEqual({ reply: "Saved result" });
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(["POST", "GET"]);
  });
  it("turns 100 simultaneous submit events into one request and one result", async () => {
    const fetcher = vi.fn(async () => Response.json({ reply: "Only once" })); vi.stubGlobal("fetch", fetcher);
    const receive = vi.fn(), settled = vi.fn();
    const signals = { busy: vi.fn(), stopping: vi.fn(), phase: vi.fn(), partial: vi.fn(), error: vi.fn(), notice: vi.fn() };
    const controller = createAIReplyController(async () => ({}), false, signals);
    const results = await Promise.all(Array.from({ length: 100 }, () => controller.run({ request: input, onResult: receive, onFailure: vi.fn(), onSettled: settled })));
    expect(results.filter(Boolean)).toHaveLength(1); expect(fetcher).toHaveBeenCalledOnce(); expect(receive).toHaveBeenCalledOnce(); expect(settled).toHaveBeenCalledOnce();
  });
  it("rejects a response for another coin during read-only recovery", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "wrong-coin-000000001", request: input, state: "completed", result: { reply: "Wrong" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resumeAIChat(input, async () => ({}), new AbortController().signal)).rejects.toMatchObject({ code: "context" });
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it("releases a stalled event reader on explicit cancellation", async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const events = readServerEvents(new Response(new ReadableStream({ cancel })), { signal: controller.signal, idleTimeoutMs: 45_000 });
    const next = events.next().catch(error => error); controller.abort();
    expect(await next).toMatchObject({ name: "AbortError" }); expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("passive usage budget", () => {
  it("ignores 100 hidden/offline triggers and coalesces slow visible reads", async () => {
    let visible = false, time = 0, release!: () => void;
    const read = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const polling = passiveRefresh(read, () => visible, () => time);
    await Promise.all(Array.from({ length: 100 }, () => polling.refresh())); expect(read).not.toHaveBeenCalled();
    visible = true; const pending = polling.refresh(); time = 70_000;
    await polling.refresh(); expect(read).toHaveBeenCalledOnce(); release(); await pending;
    const second = polling.refresh(); expect(read).toHaveBeenCalledTimes(2); release(); await second;
    time = 71_000; await polling.refresh(); expect(read).toHaveBeenCalledTimes(2);
    polling.dispose(); time = 200_000; await polling.refresh(); expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("understandable composer state", () => {
  const ready = { restored: true, switching: false, busy: false, stopping: false, recovering: false, launchLocked: false, conflict: false, saveFailed: false, online: true, phase: { type: "phase" as const, phase: "thinking" as const } };
  it.each([
    [{ restored: false }, "restoring"], [{ switching: true }, "switching"], [{ recovering: true }, "reconnecting"],
    [{ stopping: true, busy: true }, "stopping"], [{ launchLocked: true }, "launching"], [{ conflict: true }, "conflict"],
    [{ saveFailed: true }, "save-error"], [{ online: false }, "offline"],
  ])("explains a blocked action for %j", (change, id) => {
    expect(workspaceState({ ...ready, ...change })).toMatchObject({ id, blocked: true });
    expect(workspaceState({ ...ready, ...change }).message.length).toBeGreaterThan(15);
  });
  it("keeps an interrupted active request visibly active when offline", () => {
    expect(workspaceState({ ...ready, online: false, busy: true })).toMatchObject({ id: "thinking", blocked: true });
    expect(workspaceState(ready)).toMatchObject({ id: "ready", blocked: false });
  });
  it("accounts for selected text and multicode-unit characters before accepting a paste", () => {
    expect(pastedMessageFits("x".repeat(CHAT_MESSAGE_LIMIT), "new", 0, 3)).toBe(true);
    expect(pastedMessageFits("x".repeat(CHAT_MESSAGE_LIMIT), "new", 0, 0)).toBe(false);
    expect(pastedMessageFits("x".repeat(7_998), "🌱", 7_998, 7_998)).toBe(true);
    expect(pastedMessageFits("x".repeat(7_999), "🌱", 7_999, 7_999)).toBe(false);
  });
});
