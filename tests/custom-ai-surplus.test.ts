import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { callModel } from "../lib/custom-ai/model-provider.server";
import { configuredProvider, researchAvailable } from "../lib/custom-ai/provider-config.server";
import { callSurplus, boundedProviderJSON } from "../lib/custom-ai/surplus.server";
import { prepareSurplusSchema } from "../lib/custom-ai/surplus-schema.server";
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

const toolSchema = { type: "object", properties: {
  reply: { type: "string" },
  lookups: { type: "array", maxItems: 2, items: { anyOf: [
    { type: "object", properties: { kind: { const: "catalog" }, input: { type: "object", properties: { query: { type: "string", maxLength: 10 } }, required: ["query"], additionalProperties: false } }, required: ["kind", "input"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "search_hooks" }, input: { type: "object", properties: { chain: { enum: ["current", "all"] } }, required: ["chain"], additionalProperties: false } }, required: ["kind", "input"], additionalProperties: false },
  ] } },
}, required: ["reply", "lookups"], additionalProperties: false };

describe("Surplus planner schema transport", () => {
  it("encodes the unsupported union and restores a validated tool input through the real adapter", async () => {
    useSurplus();
    const lookup = { kind: "catalog", input: { query: "fees" } };
    const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ reply: "Search", lookups: [JSON.stringify(lookup)] }) }, finish_reason: "stop" }] }));
    vi.stubGlobal("fetch", fetcher);
    const answer = await callSurplus({ ...input, schema: toolSchema });
    const sent = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent.response_format.json_schema.schema.properties.lookups.items.type).toBe("string");
    expect(sent.response_format.json_schema.schema.properties.lookups.items.anyOf).toBeUndefined();
    expect(JSON.parse(answer.text)).toEqual({ reply: "Search", lookups: [lookup] });
    expect(toolSchema.properties.lookups.items.anyOf).toHaveLength(2);
  });

  it.each([
    "not json",
    JSON.stringify({ kind: "unknown", input: { query: "fees" } }),
    JSON.stringify({ kind: "catalog", input: { query: "fees", hidden: true } }),
    JSON.stringify({ kind: "catalog", input: { query: "longer than ten" } }),
    JSON.stringify({ kind: "search_hooks", input: { chain: "unsupported" } }),
  ])("rejects invalid decoded union input %s", encoded => {
    expect(() => prepareSurplusSchema(toolSchema).decode(JSON.stringify({ reply: "Search", lookups: [encoded] }))).toThrow();
  });

  it("retains the original limit on the number of requested lookups", () => {
    const encoded = JSON.stringify({ kind: "catalog", input: { query: "fees" } });
    expect(() => prepareSurplusSchema(toolSchema).decode(JSON.stringify({ reply: "Search", lookups: [encoded, encoded, encoded] }))).toThrow();
  });

  it("round-trips nullable objects without relaxing their required properties", () => {
    const schema = { type: "object", properties: { program: { type: ["object", "null"], properties: { interval: { type: "integer" } }, required: ["interval"], additionalProperties: false } }, required: ["program"], additionalProperties: false };
    const format = prepareSurplusSchema(schema);
    expect(format.schema.properties?.program.type).toBe("string");
    expect(JSON.parse(format.decode('{"program":"null"}'))).toEqual({ program: null });
    expect(JSON.parse(format.decode(JSON.stringify({ program: '{"interval":600}' })))).toEqual({ program: { interval: 600 } });
    expect(() => format.decode(JSON.stringify({ program: '{}' }))).toThrow();
  });

  it("keeps unsupported length and number constraints enforced locally", () => {
    const format = prepareSurplusSchema({ type: "object", properties: { count: { type: "integer", maximum: 2 }, name: { type: "string", maxLength: 3 } }, required: ["count", "name"], additionalProperties: false });
    expect(format.schema.properties?.count.maximum).toBeUndefined();
    expect(format.schema.properties?.name.maxLength).toBeUndefined();
    expect(JSON.parse(format.decode('{"count":2,"name":"ok"}'))).toEqual({ count: 2, name: "ok" });
    expect(() => format.decode('{"count":3,"name":"ok"}')).toThrow();
    expect(() => format.decode('{"count":2,"name":"long"}')).toThrow();
  });
});
