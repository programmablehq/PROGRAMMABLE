import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { callModel } from "../lib/custom-ai/model-provider.server";
import { configuredProvider, researchAvailable } from "../lib/custom-ai/provider-config.server";
import { callSurplus, boundedProviderJSON } from "../lib/custom-ai/surplus.server";
import { createProviderHealth } from "../lib/custom-ai/provider-health.server";
import { executionProfile, assertExecutionProfile } from "../lib/custom-ai/capabilities/registry.server";
import { parseChatRequest } from "../lib/custom-ai/types";

const input = { model: "claude-haiku-5.5", system: "Keep the complete design.", messages: [{ role: "user" as const, content: "Explain this rule." }], schema: { type: "object" }, maxTokens: 200 };
function useSurplus() { vi.stubEnv("CUSTOM_AI_PROVIDER", "surplus");vi.stubEnv("SURPLUS_API_KEY", "inf_test-only-not-a-real-key"); }
afterEach(() => { vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks(); });
describe("Surplus model routing", () => {
  it("keeps provider selection explicit and pins it in new job profiles", () => {
    useSurplus();
    const profile = executionProfile([]);
    expect(profile.providerId).toBe("surplus");expect(profile.models?.chat).toBe("claude-haiku-5.5");
    vi.stubEnv("CUSTOM_AI_PROVIDER", "anthropic");
    expect(() => assertExecutionProfile(profile, [])).toThrow();
    vi.stubEnv("CUSTOM_AI_PROVIDER", "arbitrary-host");expect(() => configuredProvider()).toThrow();
  });
  it("never falls back to Anthropic when the selected Surplus key is missing", async () => {
    useSurplus();vi.stubEnv("SURPLUS_API_KEY", "");vi.stubEnv("ANTHROPIC_API_KEY", "must-not-be-used");
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(callModel(input)).rejects.toMatchObject({code:"configuration"});expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the fixed Surplus endpoint, JSON schema and explicit output budget", async () => {
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"reply":"Saved."}'},finish_reason:"stop"}],usage:{prompt_tokens:13,completion_tokens:5}}));
    vi.stubGlobal("fetch",fetcher);
    expect(await callModel(input)).toEqual({text:'{"reply":"Saved."}',inputTokens:13,outputTokens:5});
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://api.surplusintelligence.ai/v1/chat/completions");
    expect(JSON.parse(String(options.body))).toMatchObject({model:input.model,max_tokens:200,response_format:{type:"json_schema",json_schema:{strict:true}}});
  });
  it("requires both a complete streamed result and the terminal marker", async () => {
    useSurplus();const onText=vi.fn();
    const events=[{choices:[{index:0,delta:{content:'{"reply":"OK"}'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:3,completion_tokens:4}}];
    const data=events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join("");
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(data+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}})));
    expect(await callSurplus({...input,onText})).toEqual({text:'{"reply":"OK"}',inputTokens:3,outputTokens:4});
    expect(onText).toHaveBeenCalledWith('{"reply":"OK"}');
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(data,{headers:{"content-type":"text/event-stream"}})));
    await expect(callSurplus({...input,onText})).rejects.toMatchObject({code:"incomplete"});
  });
  it("rejects a truncated or refused response without repeating the paid request", async () => {
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:"partial"},finish_reason:"length"}]}));vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus(input)).rejects.toMatchObject({code:"incomplete"});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("treats an error envelope in HTTP 200 as a failure", async () => {
    useSurplus();vi.stubEnv("SURPLUS_API_KEY", "inf_http-200-error-test");
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:{code:"insufficient_balance",message:"credit balance low"}})));
    await expect(callSurplus(input)).rejects.toMatchObject({code:"provider_billing"});
  });
  it("does not let an Anthropic cooldown block a different Surplus credential", async () => {
    useSurplus();vi.stubEnv("ANTHROPIC_API_KEY","isolated-health-test");
    await createProviderHealth(undefined,()=>1000,"anthropic").fail({kind:"billing",retryable:false,cooldownMs:10000,refundAccount:true});
    await expect(createProviderHealth(undefined,()=>1001,"surplus").assertAvailable()).resolves.toBeUndefined();
  });
  it("keeps an interrupted stream charged conservatively without retrying it", async () => {
    useSurplus();vi.stubEnv("SURPLUS_API_KEY","inf_partial-stream-test");
    const fetcher=vi.fn(async()=>new Response('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\ndata: {"error":{"code":"overloaded"}}\n\n', {headers:{"content-type":"text/event-stream"}}));
    vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus({...input,onText:vi.fn()})).rejects.toMatchObject({code:"provider_stream"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds response size and keeps unverified research disabled", async () => {
    useSurplus();vi.stubEnv("CUSTOM_AI_SURPLUS_WEB_SEARCH_MODEL","");
    expect(researchAvailable()).toBe(false);
    await expect(boundedProviderJSON(new Response("x".repeat(100)),50)).rejects.toMatchObject({code:"response"});
  });
  it("does not transmit a pasted Surplus API key as a chat prompt", () => {
    expect(()=>parseChatRequest({id:"private-key-test-001",intent:"chat",messages:[{role:"user",content:"inf_"+"x".repeat(40)}]})).toThrow();
  });
});
