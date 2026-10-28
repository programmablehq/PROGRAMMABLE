import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAIChat } from "../lib/custom-ai/client";
afterEach(() => vi.unstubAllGlobals());
const input = { id: "saved-request-0000001", intent: "chat" as const, messages: [{ role: "user" as const, content: "Build my coin" }] };
describe("saved request recovery", () => {
  it("reads the stored result after a cut stream without another paid POST", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('data: {"type":"reply","text":"Partial"}\n\n', { headers: {"Content-Type":"text/event-stream"} }))
      .mockResolvedValueOnce(Response.json({ state: "completed", result: { reply: "Complete" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await sendAIChat(input, async()=>({}), new AbortController().signal)).toEqual({reply:"Complete"});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].method).toBe("GET");
  });
  it("keeps an explicit failed response terminal", async () => {
    const fetcher=vi.fn(async()=>new Response('data: {"type":"error","error":"Provider unavailable","status":503,"requestState":"failed"}\n\n',{headers:{"Content-Type":"text/event-stream"}}));
    vi.stubGlobal("fetch", fetcher);
    await expect(sendAIChat(input,async()=>({}),new AbortController().signal)).rejects.toMatchObject({requestState:"failed"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
