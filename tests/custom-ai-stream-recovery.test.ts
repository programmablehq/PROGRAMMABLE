import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeAIChat, sameAIRequest, sendAIChat } from "../lib/custom-ai/client";
afterEach(() => {vi.unstubAllGlobals();vi.useRealTimers();});
const input = { id: "saved-request-0000001", intent: "chat" as const, messages: [{ role: "user" as const, content: "Build my coin" }] };
describe("saved request recovery", () => {
  it("reads the stored result after a cut stream without another paid POST", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('data: {"type":"reply","text":"Partial"}\n\n', { headers: {"Content-Type":"text/event-stream"} }))
      .mockResolvedValueOnce(Response.json({ id:input.id,request:input,state: "completed", result: { reply: "Complete" } }));
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
  it("reloads a completed reply with GET only and rejects a changed cached payload", async () => {
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({id:input.id,request:input,state:"completed",result:{reply:"Saved"}}));vi.stubGlobal("fetch",fetcher);
    expect(await resumeAIChat(input,async()=>({}),new AbortController().signal)).toEqual({reply:"Saved"});
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
    await expect(resumeAIChat({...input,messages:[{role:"user",content:"A different coin"}]},async()=>({}),new AbortController().signal)).rejects.toMatchObject({code:"context"});
    expect(fetcher.mock.calls.every(([,options])=>options?.method==="GET")).toBe(true);
  });
  it("compares the server payload without treating displayed source links as a new paid request", () => {
    const first={...input,messages:[{role:"assistant" as const,content:"A sourced explanation.",sources:[{title:"Docs",url:"https://example.org",retrievedAt:"2026-10-31T00:00:00Z"}]},{role:"user" as const,content:"Keep the same rule."}]};
    const stored={...first,messages:first.messages.map(({role,content})=>({role,content}))};
    expect(sameAIRequest(first,stored)).toBe(true);
    expect(sameAIRequest(first,{...stored,contextId:"another-context-0001"})).toBe(false);
  });
  it("polls only the bound status after the first read instead of resending the conversation", async () => {
    vi.useFakeTimers();const hash="a".repeat(64),events:unknown[]=[];
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id:input.id,request:input,payloadHash:hash,state:"running",phase:"checking",heartbeatAt:Date.now()}))
      .mockResolvedValueOnce(Response.json({id:input.id,payloadHash:hash,state:"completed",result:{reply:"Done"}}));
    vi.stubGlobal("fetch",fetcher);
    const result=resumeAIChat(input,async()=>({}),new AbortController().signal,event=>events.push(event));
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({reply:"Done"});
    expect(events).toContainEqual({type:"phase",phase:"checking"});
    expect(fetcher.mock.calls[1][0]).toContain("view=status");expect(fetcher.mock.calls.every(([,options])=>options?.method==="GET")).toBe(true);
  });
});
