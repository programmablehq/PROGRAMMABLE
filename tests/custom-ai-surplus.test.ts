import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { callModel } from "../lib/custom-ai/model-provider.server";
import { configuredProvider, researchAvailable } from "../lib/custom-ai/provider-config.server";
import { callSurplus, boundedProviderJSON } from "../lib/custom-ai/surplus.server";
import { prepareSurplusSchema } from "../lib/custom-ai/surplus-schema.server";
import { createProviderHealth } from "../lib/custom-ai/provider-health.server";
import { executionProfile, assertExecutionProfile } from "../lib/custom-ai/capabilities/registry.server";
import capturedAnswer from "./fixtures/custom-ai/surplus-answer-null-v1.json";
import { parseChatRequest } from "../lib/custom-ai/types";

const input = { model: "claude-haiku-5.5", system: "Keep the complete design.", messages: [{ role: "user" as const, content: "Explain this rule." }], schema: { type: "object" }, maxTokens: 200 };
function useSurplus() { vi.stubEnv("CUSTOM_AI_PROVIDER", "surplus");vi.stubEnv("SURPLUS_API_KEY", "inf_test-only-not-a-real-key"); }
afterEach(() => { vi.clearAllTimers();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks(); });
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
  it.each(["claude-sonnet-5.5","claude-opus-5.5"])("does not apply the Haiku seller pins to %s",async model=>{
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"reply":"OK"}'},finish_reason:"stop"}]}));
    vi.stubGlobal("fetch",fetcher);
    await callSurplus({...input,model});
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.model).toBe(model);expect(body.provider).toBeUndefined();expect(body.provider_order).toBeUndefined();
  });
  it("validates JSON-object transport locally without another provider request",async()=>{
    useSurplus();
    const schema={type:"object",properties:{count:{type:"integer"}},required:["count"],additionalProperties:false};
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({choices:[{message:{content:'{"count":2}'},finish_reason:"stop"}]}))
      .mockResolvedValueOnce(Response.json({choices:[{message:{content:'{"count":"2"}'},finish_reason:"stop"}]}));
    vi.stubGlobal("fetch",fetcher);
    expect(await callSurplus({...input,schema,structuredTransport:"json-object"})).toMatchObject({text:'{"count":2}'});
    const request=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(request.response_format).toEqual({type:"json_object"});
    expect(request.messages[0].content).toContain(JSON.stringify(schema));
    await expect(callSurplus({...input,schema,structuredTransport:"json-object"})).rejects.toMatchObject({code:"incomplete",failure:"invalid-schema"});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("unwraps only a complete JSON fence and still validates every field",()=>{
    const schema={type:"object",properties:{count:{type:"integer"}},required:["count"],additionalProperties:false};
    const format=prepareSurplusSchema(schema,true);
    expect(format.decode('```json\n{"count":2}\n```')).toBe('{"count":2}');
    expect(format.decode('Text first\n```json\n{"count":2}\n```\nDone')).toBe('{"count":2}');
    expect(format.decode('A prepared result follows.\n{"count":2}')).toBe('{"count":2}');
    expect(format.decode('A prepared result follows.\n{"count":2}\n```')).toBe('{"count":2}');
    expect(format.decode('<invoke name="emit"><parameter name="payload">{"count":2}</parameter></invoke>\n_rows')).toBe('{"count":2}');
    for(const text of ['{}\n```json\n{"count":2}\n```','```json\n{"count":"2"}\n```','```javascript\n{"count":2}\n```','```json\n{"count":2}',
      '<invoke>{"count":2}</invoke>{"count":3}','[]<invoke>{"count":2}</invoke>','<invoke>{"count":"2"}</invoke>'])expect(()=>format.decode(text)).toThrow();
  });
  it("records the rejected source field without retaining its response",async()=>{
    useSurplus();
    const schema={type:"object",properties:{reply:{type:"string"},sourceFiles:{type:"array",minItems:1,items:{type:"string"}}},required:["reply","sourceFiles"],additionalProperties:false};
    const body={reply:"private source description",sourceFiles:[]};
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:JSON.stringify(body)},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:20}}));
    vi.stubGlobal("fetch",fetcher);
    const failure=await callSurplus({...input,schema,structuredTransport:"json-object"}).catch(error=>error);
    expect(failure).toMatchObject({failure:"invalid-schema",schemaFailure:{kind:"schema",issues:[{path:"/sourceFiles",keyword:"minItems",expected:1}]},usage:{inputTokens:10,outputTokens:20}});
    expect(JSON.stringify(failure)).not.toContain("source description");
    expect(failure.partialDeclaration).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("decodes the seller's structured parameter envelope without another request",async()=>{
    useSurplus();
    const schema={type:"object",properties:{steps:{type:"string"},complete:{type:"boolean"}},required:["steps","complete"],additionalProperties:false};
    const steps=[["read-count","counter:count()","[]","trader-a",0,"0",true,[],{status:"success",returnsJson:"[0]"}]];
    const content=`\n<invoke name="structured_output">\n<parameter name="steps">${JSON.stringify(steps)}</parameter>\n<parameter name="complete">false</parameter>\n</invoke>`;
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content},finish_reason:"stop"}],usage:{prompt_tokens:10,completion_tokens:20}}));
    vi.stubGlobal("fetch",fetcher);
    const result=await callSurplus({...input,schema});
    expect(JSON.parse(result.text)).toEqual({steps:JSON.stringify(steps),complete:false});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects ambiguous parameter envelopes and validates their exact field types",()=>{
    const format=prepareSurplusSchema({type:"object",properties:{count:{type:"integer"}},required:["count"],additionalProperties:false});
    const wrap=(body:string)=>`<invoke name="structured_output">${body}</invoke>`;
    expect(format.decode(wrap('<parameter name="count">2</parameter>'))).toBe('{"count":2}');
    for(const text of [wrap('<parameter name="count">"2"</parameter>'),wrap('<parameter name="other">2</parameter>'),
      wrap('<parameter name="count">1</parameter><parameter name="count">2</parameter>'),wrap(''),
      wrap('<parameter name="count">2</parameter>')+'extra',wrap('<parameter name="count">2'),
      wrap('<parameter name="count"><invoke>2</invoke></parameter>'),
      wrap('<parameter name="count">2</parameter><parameter name="__proto__">{}</parameter>')])expect(()=>format.decode(text)).toThrow();
  });
  it("distinguishes malformed JSON and redacts model-chosen field names",()=>{
    const schema={type:"object",properties:{sourceFiles:{type:"object",additionalProperties:{type:"integer"}}},required:["sourceFiles"]};
    const format=prepareSurplusSchema(schema,true);
    let malformed:unknown;try{format.decode('{"sourceFiles":');}catch(error){malformed=error;}
    expect(malformed).toMatchObject({schemaFailure:{kind:"json",issues:[]}});
    let invalid:unknown;try{format.decode(JSON.stringify({sourceFiles:{private_api_key_example:"secret content"}}));}catch(error){invalid=error;}
    expect(invalid).toMatchObject({schemaFailure:{kind:"schema",issues:[{path:"/sourceFiles/*",keyword:"type"}]}});
    expect(JSON.stringify((invalid as {schemaFailure:unknown}).schemaFailure)).not.toMatch(/private_api_key_example|secret content/);
  });
  it("identifies a missing known envelope field without response values",()=>{
    const format=prepareSurplusSchema({type:"object",properties:{action:{type:"string"}},required:["action"],additionalProperties:false},true);
    let failure:unknown;try{format.decode('{}');}catch(error){failure=error;}
    expect(failure).toMatchObject({schemaFailure:{kind:"schema",issues:[{path:"/action",keyword:"required"}]}});
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
  it("streams internal contract declarations even without a visible text callback",async()=>{
    useSurplus();
    const events=[{choices:[{index:0,delta:{content:'{"reply":"Complete checks"}'},finish_reason:null}]},
      {choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:12,completion_tokens:6}}];
    const fetcher=vi.fn(async()=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}}));
    vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus({...input,responseProfile:"contract"})).resolves.toEqual({text:'{"reply":"Complete checks"}',inputTokens:12,outputTokens:6});
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body).toMatchObject({stream:true,stream_options:{include_usage:true},max_tokens:200,
      tool_choice:"none",provider:["openrouter","venice"],provider_order:["openrouter","venice"]});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not attach Claude seller preferences to another model or accept a seller tool call",async()=>{
    useSurplus();
    const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:null,tool_calls:[{type:"function",function:{name:"bash",arguments:'{"command":"echo no-op"}'}}]},finish_reason:"tool_calls"}]}));
    vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus({...input,model:"another-model"})).rejects.toMatchObject({failure:"refused"});
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.tool_choice).toBe("none");expect(body.provider).toBeUndefined();expect(body.provider_order).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps reading split empty transport tags before a complete checked source reply",async()=>{
    useSurplus();
    const schema={type:"object",properties:{reply:{type:"string"},sourceFiles:{type:"array",minItems:1,items:{type:"string"}}},required:["reply","sourceFiles"],additionalProperties:false};
    const value={reply:"Source saved",sourceFiles:["pragma solidity 0.8.26;"]};
    const pieces=['\n<invoke name="bash_tool_placeholder">\n<','/invoke>\n<invoke name="x"></inv','oke>\nSorry, here is the actual response:\n',JSON.stringify(value)];
    const events=[...pieces.map(content=>({choices:[{index:0,delta:{content}}]})),
      {choices:[{index:0,delta:{content:""},finish_reason:"stop"}]}];
    const fetcher=vi.fn(async()=>new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join("")+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}}));
    vi.stubGlobal("fetch",fetcher);
    expect(JSON.parse((await callSurplus({...input,schema,structuredTransport:"json-object",responseProfile:"contract"})).text)).toEqual(value);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("still requires complete data after empty tags and keeps the structured data envelope",async()=>{
    const format=prepareSurplusSchema({type:"object",properties:{count:{type:"integer"}},required:["count"],additionalProperties:false},true);
    const empty='<invoke name="sourceFiles"> </invoke>\n';
    expect(format.decode(empty+'<invoke name="structured_output"><parameter name="count">2</parameter></invoke>')).toBe('{"count":2}');
    expect(()=>format.decode(empty)).toThrow();
    expect(()=>format.decode(empty+'{"count":"2"}')).toThrow();
  });
  it("cancels an unexpected textual tool envelope before reading the rest of a paid stream",async()=>{
    useSurplus();const cancel=vi.fn();
    const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:'\n<invoke name="bash">echo forbidden'}}]})+'\n\n'));
    },cancel}),{headers:{"content-type":"text/event-stream"}}));
    vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus({...input,responseProfile:"contract"})).rejects.toMatchObject({failure:"refused"});
    expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([8000,1500])("uses supported adaptive effort without changing the %s-token source limit",async maxTokens=>{
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:"{}"},finish_reason:"stop"}]}));
    vi.stubGlobal("fetch",fetcher);
    await callSurplus({...input,model:"claude-sonnet-5.5",task:"source-implementation",effort:"low",maxTokens});
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.max_tokens).toBe(maxTokens);
    expect(body.reasoning).toEqual({effort:"low"});
    expect(body.reasoning_effort).toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not spend the discussion budget on hidden Haiku planning while preserving build reasoning",async()=>{
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'{"reply":"Ready."}'},finish_reason:"stop"}]}));
    vi.stubGlobal("fetch",fetcher);
    await callSurplus({...input,model:"claude-haiku-5.5",task:"planning",effort:"low",maxTokens:8000});
    const body=JSON.parse(String((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(body.reasoning).toEqual({effort:"low",enabled:false});expect(body.max_tokens).toBe(8000);
    await callSurplus({...input,model:"claude-haiku-5.5",task:"planning",effort:"medium",maxTokens:8000});
    expect(JSON.parse(String((fetcher.mock.calls[1] as unknown as [string,RequestInit])[1].body)).reasoning).toEqual({effort:"medium"});
  });
  it("accepts a complete contract reply after the old two-minute cutoff without a second request",async()=>{
    useSurplus();vi.useFakeTimers();
    vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{
      const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException("Deadline elapsed","TimeoutError")),ms);return controller.signal;
    });
    const fetcher=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((resolve,reject)=>{
      const abort=()=>reject(options.signal?.reason);options.signal?.addEventListener("abort",abort,{once:true});
      setTimeout(()=>{options.signal?.removeEventListener("abort",abort);resolve(new Response('data: {"choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{"content-type":"text/event-stream"}}));},130_000);
    }));
    vi.stubGlobal("fetch",fetcher);
    const result=callSurplus({...input,responseProfile:"contract"});
    await vi.advanceTimersByTimeAsync(130_001);
    await expect(result).resolves.toMatchObject({text:"{}"});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("records a real contract deadline with known partial usage and cancels the stream without retrying",async()=>{
    useSurplus();const deadline=new AbortController(),cancel=vi.fn(),onText=vi.fn();
    vi.spyOn(AbortSignal,"timeout").mockReturnValue(deadline.signal);
    const fetcher=vi.fn(async()=>new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n'));
    },cancel}),{headers:{"content-type":"text/event-stream"}}));
    vi.stubGlobal("fetch",fetcher);
    const result=callSurplus({...input,responseProfile:"contract",onText});
    const rejected=expect(result).rejects.toMatchObject({code:"incomplete",failure:"timeout",usage:{inputTokens:12,outputTokens:3}});
    await vi.waitFor(()=>expect(onText).toHaveBeenCalledWith("partial"));
    deadline.abort(new DOMException("Deadline elapsed","TimeoutError"));
    await rejected;expect(cancel).toHaveBeenCalledTimes(1);expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a truncated or refused response without repeating the paid request", async () => {
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:"partial"},finish_reason:"length"}]}));vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus(input)).rejects.toMatchObject({code:"incomplete"});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains known token counts and the output-limit reason for a failed paid call", async () => {
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:"partial"},finish_reason:"length"}],usage:{prompt_tokens:14900,completion_tokens:8000}}));
    vi.stubGlobal("fetch",fetcher);
    await expect(callSurplus(input)).rejects.toMatchObject({code:"incomplete",failure:"output-limit",usage:{inputTokens:14900,outputTokens:8000}});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("captures incomplete declaration output only on explicit opt-in and never enumerates it",async()=>{
    useSurplus();const text='{"generalChecks":"unfinished-private-declaration';
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content:text},finish_reason:"length"}]})));
    const ordinary=await callSurplus(input).catch(error=>error);
    expect(ordinary.partialDeclaration).toBeUndefined();
    const captured=await callSurplus({...input,captureIncompleteDeclaration:true}).catch(error=>error);
    expect(captured.partialDeclaration).toBe(text);
    expect(JSON.stringify(captured)).not.toContain("unfinished-private-declaration");
    expect(captured.message).not.toContain("unfinished-private-declaration");
  });
  it("reports absent or invalid usage as unknown instead of a zero-cost completed record",async()=>{
    useSurplus();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content:'{"reply":"OK"}'},finish_reason:"stop"}],usage:{prompt_tokens:-1,completion_tokens:"unknown"}})));
    await expect(callSurplus(input)).resolves.toEqual({text:'{"reply":"OK"}',inputTokens:null,outputTokens:null});
  });
  it("accepts a complete contract declaration beyond the ordinary answer limit only in its bounded profile",async()=>{
    useSurplus();const content=JSON.stringify({reply:"x".repeat(60_000)});
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content},finish_reason:"stop"}]})));
    await expect(callSurplus(input)).rejects.toMatchObject({failure:"response-too-large"});
    await expect(callSurplus({...input,responseProfile:"contract"})).resolves.toMatchObject({text:content});
    const oversized=JSON.stringify({reply:"x".repeat(128_000)});
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({choices:[{message:{content:oversized},finish_reason:"stop"}]})));
    await expect(callSurplus({...input,responseProfile:"contract"})).rejects.toMatchObject({failure:"response-too-large"});
  });
  it("does not confuse a missing stream terminator with an exhausted token budget",async()=>{
    useSurplus();const data='data: {"choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n';
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(data,{headers:{"content-type":"text/event-stream"}})));
    await expect(callSurplus({...input,onText:vi.fn()})).rejects.toMatchObject({failure:"missing-end",usage:{inputTokens:3,outputTokens:4}});
  });
  it("cancels a silent provider stream when its request is aborted",async()=>{
    useSurplus();const cancel=vi.fn(),controller=new AbortController();
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(new ReadableStream({cancel}),{headers:{"content-type":"text/event-stream"}})));
    const call=callSurplus({...input,signal:controller.signal,onText:vi.fn()});
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));controller.abort();
    await expect(call).rejects.toMatchObject({code:"connection"});expect(cancel).toHaveBeenCalledTimes(1);
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
  it("replays the actual optional-null answer through the adapter without another request",async()=>{
    useSurplus();const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:capturedAnswer.text},finish_reason:"stop"}],usage:{prompt_tokens:12992,completion_tokens:934}}));vi.stubGlobal("fetch",fetcher);
    const reply=await callSurplus({...input,schema:capturedAnswer.schema});
    expect(JSON.parse(reply.text)).toEqual(JSON.parse(capturedAnswer.text));expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(reply.text)).toMatchObject({action:"answer",program:null,eventRule:null});
  });
  it("accepts mixed canonical and encoded tool values only when the original schema allows them",()=>{
    const first={kind:"catalog",input:{query:"fees"}},second={kind:"search_hooks",input:{chain:"current"}},format=prepareSurplusSchema(toolSchema);
    expect(JSON.parse(format.decode(JSON.stringify({reply:"Search",lookups:[first,JSON.stringify(second)]})))).toEqual({reply:"Search",lookups:[first,second]});
    for(const value of [null,{kind:"unknown",input:{}},{kind:"catalog",input:{query:"fees",hidden:true}}])expect(()=>format.decode(JSON.stringify({reply:"Search",lookups:[value]}))).toThrow();
  });
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
    expect(JSON.parse(format.decode('{"program":null}'))).toEqual({program:null});
    expect(JSON.parse(format.decode('{"program":""}'))).toEqual({program:null});
    expect(JSON.parse(format.decode('{"program":{"interval":600}}'))).toEqual({program:{interval:600}});
    for(const value of [{},{interval:"600"},{interval:600,hidden:true}])expect(()=>format.decode(JSON.stringify({program:value}))).toThrow();
    expect(JSON.parse(format.decode(JSON.stringify({ program: '{"interval":600}' })))).toEqual({ program: { interval: 600 } });
    expect(() => format.decode(JSON.stringify({ program: '{}' }))).toThrow();
  });

  it("does not turn blank required objects or malformed optional configuration into null", () => {
    const required = { type: ["object"], properties: { interval: { type: "integer" } }, required: ["interval"], additionalProperties: false };
    const optional = { ...required, type: ["object", "null"] };
    for (const schema of [required, optional]) {
      const format=prepareSurplusSchema({type:"object",properties:{program:schema},required:["program"],additionalProperties:false});
      for (const program of [" ","{}",'{"interval":"600"}','{"interval":600,"hidden":true}'])
        expect(()=>format.decode(JSON.stringify({program}))).toThrow();
      expect(()=>format.decode('{}')).toThrow();
    }
    const format=prepareSurplusSchema({type:"object",properties:{program:required},required:["program"],additionalProperties:false});
    expect(()=>format.decode('{"program":""}')).toThrow();
  });

  it("keeps unsupported length and number constraints enforced locally", () => {
    const format = prepareSurplusSchema({ type: "object", properties: { count: { type: "integer", maximum: 2 }, name: { type: "string", maxLength: 3 } }, required: ["count", "name"], additionalProperties: false });
    expect(format.schema.properties?.count.maximum).toBeUndefined();
    expect(format.schema.properties?.name.maxLength).toBeUndefined();
    expect(JSON.parse(format.decode('{"count":2,"name":"ok"}'))).toEqual({ count: 2, name: "ok" });
    expect(() => format.decode('{"count":3,"name":"ok"}')).toThrow();
    expect(() => format.decode('{"count":2,"name":"long"}')).toThrow();
  });

  it("accepts canonical strings in a string/null union while retaining the original constraints", () => {
    const format=prepareSurplusSchema({type:"object",properties:{group:{anyOf:[{type:"string",pattern:"^[a-z-]+$"},{type:"null"}]}},required:["group"],additionalProperties:false});
    expect(JSON.parse(format.decode('{"group":"fee-budget"}'))).toEqual({group:"fee-budget"});
    expect(JSON.parse(format.decode('{"group":"null"}'))).toEqual({group:null});
    for(const group of ["", "bad group", "{}", "[]"])expect(()=>format.decode(JSON.stringify({group}))).toThrow();
  });
});
