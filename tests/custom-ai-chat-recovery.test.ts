import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
vi.mock("next/server", async original => ({ ...await original<object>(), after: (task: () => Promise<unknown>) => { void task(); } }));
const runtime = vi.hoisted(() => ({ store: null as unknown, owner: "alice", run: vi.fn() }));
vi.mock("../lib/custom-ai/auth.server", () => ({ authorizeCustomAI: async () => ({ kind: "account", owner: runtime.owner }) }));
vi.mock("../lib/custom-ai/service.server", () => ({ runCustomAI: runtime.run }));
vi.mock("../lib/custom-ai/store.server", async original => ({ ...await original<object>(), productionAIStore: () => runtime.store }));
import { createAIStore, CUSTOM_AI_SCHEMA } from "../lib/custom-ai/store.server";
import { POST, GET } from "../app/api/custom-ai/route";
import { AIRequestError, sendAIChat } from "../lib/custom-ai/client";
import { CustomAIError, type ChatProgress, type ChatRequest } from "../lib/custom-ai/types";

let database: PGlite;
const request: ChatRequest = { id: "recovery-request-00001", intent: "chat", messages: [{ role: "user", content: "Make the buy fee 2%." }] };
beforeEach(async () => {
  vi.stubEnv("CUSTOM_AI_PROVIDER", "anthropic");vi.stubEnv("ANTHROPIC_API_KEY", "test-only-configuration");
  runtime.run.mockReset(); runtime.owner = "alice";
  database = new PGlite(); await database.exec(CUSTOM_AI_SCHEMA);
  runtime.store = createAIStore({ connect: async () => ({ query: (sql, values) => database.query(sql, values), release() {} }) },
    { hourlyUnits: 100, dailyUnits: 200, globalDailyUnits: 300, concurrent: 1 });
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const call = new Request(`https://programmable.market${url}`, init);
    return init?.method === "POST" ? POST(call) : GET(call);
  }));
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await database.close(); });

describe("durable chat retry and streaming", () => {
  it("does not reserve an attempt or call a model when the selected provider is unconfigured", async () => {
    vi.stubEnv("CUSTOM_AI_PROVIDER", "surplus");vi.stubEnv("SURPLUS_API_KEY", "");
    const response=await POST(new Request("https://programmable.market/api/custom-ai",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)}));
    expect(response.status).toBe(503);expect((await response.json()).code).toBe("configuration");
    expect(runtime.run).not.toHaveBeenCalled();
    expect((await database.query("SELECT count(*)::int AS n FROM programmable_custom_ai_v1.jobs")).rows).toEqual([{n:0}]);
  });
  it("reports a terminal failure so a deliberate retry can use a new attempt", async () => {
    runtime.run.mockRejectedValueOnce(new CustomAIError("provider_503", "Temporary provider error", 503)).mockResolvedValue({ reply: "Recovered." });
    const send = (id: string) => sendAIChat({ ...request, id }, async () => ({}), new AbortController().signal);
    await expect(send(request.id)).rejects.toMatchObject({ status: 503, requestState: "failed" });
    await expect(send(request.id)).rejects.toMatchObject({ status: 409, requestState: "failed" });
    expect(await send("recovery-request-00002")).toEqual({ reply: "Recovered." });
    expect(runtime.run).toHaveBeenCalledTimes(2);
  });
  it("recovers a completed result under the same ID without a second paid call", async () => {
    runtime.run.mockResolvedValue({ reply: "Saved answer." });
    const first = await POST(new Request("https://programmable.market/api/custom-ai", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(request) }));
    expect(first.status).toBe(200); // simulate a response lost before it reached the browser
    expect(await sendAIChat(request, async () => ({}), new AbortController().signal)).toEqual({ reply: "Saved answer." });
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
  it("delivers progress before completion and commits only the complete answer", async () => {
    const events: ChatProgress[] = [];
    let complete!: () => void;
    const pause = new Promise<void>(resolve => { complete = resolve; });
    runtime.run.mockImplementation(async (_request, _signal, _deps, context) => {
      context.onProgress({ type: "reply", text: "Working on your" });
      await pause;
      return { reply: "Your complete answer." };
    });
    const result = sendAIChat(request, async () => ({}), new AbortController().signal, event => events.push(event));
    await expect.poll(() => events.length).toBe(1);
    expect(events[0]).toEqual({ type: "reply", text: "Working on your" });
    complete();
    expect(await result).toEqual({ reply: "Your complete answer." });
  });
  it("never lets a different account supply another owner's saved context", async () => {
    runtime.run.mockResolvedValue({ reply: "Private", memory: "Private requirements." });
    await sendAIChat(request, async () => ({}), new AbortController().signal);
    runtime.owner = "bob";
    await expect(sendAIChat({ ...request, id: "other-request-0001", contextId: request.id }, async () => ({}), new AbortController().signal)).rejects.toBeInstanceOf(AIRequestError);
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });
});
