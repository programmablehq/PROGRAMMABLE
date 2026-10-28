import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { callClaude, MODELS } from "../lib/custom-ai/claude.server";
const input = { model: MODELS.chat, messages: [{ role: "user" as const, content: "Hello" }], system: "Reply", maxTokens: 10, schema: {} };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("provider transport", () => {
  it("classifies a billing body and performs no second upstream call", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "billing-fixture");
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Your credit balance is too low" } }), { status: 400 }));
    vi.stubGlobal("fetch", send);
    await expect(callClaude(input)).rejects.toMatchObject({ code: "provider_billing" });
    await expect(callClaude(input)).rejects.toMatchObject({ code: "provider_cooldown" });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not treat an HTTP 200 stream as a completed reply", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "stream-fixture");
    vi.stubGlobal("fetch", async () => new Response('data: {"type":"message_start","message":{}}\n\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    await expect(callClaude({ ...input, onText: () => undefined })).rejects.toMatchObject({ code: "provider_stream" });
  });
});
